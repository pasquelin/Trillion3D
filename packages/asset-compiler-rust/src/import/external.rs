//! Les fichiers que le lecteur ouvre **en plus** du fichier de scène : la bibliothèque de matériaux
//! d'un OBJ, un cache de géométrie. Sans eux, la clé du cache ne couvrait que le fichier revendiqué,
//! et un `.mtl` modifié laissait servir la scène d'avant.
//!
//! Ils entrent donc dans la clé, absence comprise : un fichier qui apparaît la change autant qu'un
//! fichier dont le contenu change. Le relevé d'une conversion précédente sert d'avance — il donne la
//! clé sans relire la source —, et quand il se trompe la conversion qui suit écrit la vraie clé.
//!
//! Les textures liées y entrent aussi, sans être ouvertes. L'import ne lit pas leurs octets : il
//! constate quel candidat existe pour écrire une URI, et c'est ce constat — le chemin essayé, sa
//! présence, son empreinte quand il est là — qui décide du contenu du glTF intermédiaire. Laissé
//! hors de la clé, une image ajoutée à côté d'une source inchangée laissait servir la scène d'avant.
use super::*;
use std::{
    fs::File,
    io::{Read, Seek, SeekFrom},
    sync::Mutex,
};

/// Une bibliothèque de matériaux citée par la source — le `.mtl` d'un OBJ.
pub(super) const MATERIAL_LIBRARY: &str = "material-library";
/// Les natures de fichier externe qu'un lecteur peut demander, dans l'ordre du contrat ufbx.
const KINDS: [&str; 3] = [MATERIAL_LIBRARY, "geometry-cache", "model"];
/// Un chemin d'image essayé pendant la résolution d'une texture. Jamais ouvert par le lecteur : son
/// état seul — présent ou non, et alors son empreinte — décide de l'URI que la scène portera.
pub(super) const TEXTURE_CANDIDATE: &str = "texture-candidate";

/// Un fichier ouvert pendant l'import, et l'empreinte de ce qu'il contenait.
pub(super) struct External {
    /// Le chemin complet, tel que le lecteur l'a demandé : c'est lui qu'on rehache au passage
    /// suivant. Il ne sort jamais du cache — il nomme la machine qui a compilé, pas la scène.
    path: String,
    /// Le nom seul, celui qui entre dans la clé et dans le manifeste.
    name: String,
    kind: &'static str,
    /// `None` quand l'ouverture a échoué.
    digest: Option<String>,
    /// Une bibliothèque texte dont la dernière ligne n'est pas terminée : le fichier est coupé au
    /// milieu d'une déclaration, et le lecteur en retient une valeur incomplète sans se plaindre.
    truncated: bool,
}

fn kind_of(type_: ufbx::OpenFileType) -> &'static str {
    match type_ {
        ufbx::OpenFileType::ObjMtl => MATERIAL_LIBRARY,
        ufbx::OpenFileType::GeometryCache => KINDS[1],
        ufbx::OpenFileType::MainModel => KINDS[2],
    }
}

fn kind_named(name: &str) -> Option<&'static str> {
    KINDS
        .into_iter()
        .chain([TEXTURE_CANDIDATE])
        .find(|kind| *kind == name)
}

/// Le dernier octet d'un fichier : une bibliothèque texte qui ne finit pas par une fin de ligne a
/// été coupée. Seul cet octet est lu, jamais le fichier entier.
fn unterminated(path: &Path) -> bool {
    let Ok(mut file) = File::open(path) else {
        return false;
    };
    let Ok(end) = file.seek(SeekFrom::End(0)) else {
        return false;
    };
    if end == 0 || file.seek(SeekFrom::Start(end - 1)).is_err() {
        return false;
    }
    let mut last = [0u8; 1];
    file.read_exact(&mut last).is_ok() && last[0] != b'\n' && last[0] != b'\r'
}

/// Ce qu'on sait d'un fichier externe maintenant : son empreinte, ou son absence.
fn describe(path: &Path, kind: &'static str) -> External {
    let digest = crate::hash_file(path).ok();
    let truncated = kind == MATERIAL_LIBRARY && digest.is_some() && unterminated(path);
    External {
        path: path.to_string_lossy().into_owned(),
        name: path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("")
            .to_string(),
        kind,
        digest,
        truncated,
    }
}

/// Le relevé des ouvertures d'un import. Le lecteur appelle sa callback depuis son fil de lecture :
/// le verrou ne sert qu'à rendre le relevé partageable, il n'est jamais disputé.
#[derive(Default)]
pub(super) struct Externals(Mutex<Vec<External>>);

impl Externals {
    /// La callback d'ouverture du lecteur : elle note le fichier et son empreinte, puis rend le
    /// flux. Rien n'est mis en mémoire — le lecteur lit le fichier lui-même.
    pub(super) fn open(&self, path: &str, info: &ufbx::OpenFileInfo) -> Option<ufbx::Stream> {
        let path = Path::new(path);
        let mut entry = describe(path, kind_of(info.type_));
        let opened = entry.digest.as_ref().and_then(|_| File::open(path).ok());
        if opened.is_none() {
            entry.digest = None;
            entry.truncated = false;
        }
        self.0.lock().expect("fichiers externes").push(entry);
        opened.map(ufbx::Stream::File)
    }
    /// Note un chemin d'image essayé et ce qu'on y a trouvé. Rien n'est ouvert pour le lecteur :
    /// c'est la décision de résolution, et non des octets consommés, qui entre ainsi dans la clé.
    pub(super) fn note_texture(&self, path: &Path) {
        let entry = describe(path, TEXTURE_CANDIDATE);
        self.0.lock().expect("fichiers externes").push(entry);
    }
    /// Le nombre de fichiers déjà ouverts : une borne pour ne rapporter qu'un fichier de scène.
    pub(super) fn opened(&self) -> usize {
        self.0.lock().expect("fichiers externes").len()
    }
    /// Ce qu'une bibliothèque de matériaux n'a pas rendu, compté par son nom. `declared` dit que la
    /// source citait bien une bibliothèque : le lecteur cherche aussi un `.mtl` de son propre chef,
    /// et un fichier qu'il invente ne manque à personne quand il n'existe pas.
    pub(super) fn report_since(&self, from: usize, declared: bool, report: &mut Report) {
        let files = self.0.lock().expect("fichiers externes");
        let libraries: Vec<&External> = files[from.min(files.len())..]
            .iter()
            .filter(|file| file.kind == MATERIAL_LIBRARY)
            .collect();
        if declared && !libraries.is_empty() && !libraries.iter().any(|f| f.digest.is_some()) {
            report.add("material-library-missing");
        }
        let truncated = libraries.iter().filter(|file| file.truncated).count();
        report.add_count("material-library-truncated", truncated);
    }
    /// Retire le relevé pour en faire la clé et le manifeste.
    pub(super) fn drain(&self) -> Vec<External> {
        std::mem::take(&mut *self.0.lock().expect("fichiers externes"))
    }
}

/// La clé de cache : la base — pilote, version, entrées revendiquées — puis chaque fichier externe,
/// nom et empreinte. Un `.mtl` modifié, disparu ou apparu donne une autre clé, donc une autre scène.
pub(super) fn key(base: &str, files: &[External]) -> String {
    let mut material = base.to_string();
    for file in files {
        material.push('\n');
        material.push_str(file.kind);
        material.push(':');
        material.push_str(&file.name);
        material.push(':');
        material.push_str(file.digest.as_deref().unwrap_or("-"));
    }
    hash(material.as_bytes())
}

/// Ce que le manifeste publie de chaque fichier **ouvert** : jamais son chemin complet. Les chemins
/// d'image essayés restent dans la clé seule — ils se comptent par dizaines et ne sont la source de
/// rien : ce que la résolution a retenu se lit dans `images` du glTF.
pub(super) fn manifest(files: &[External]) -> Value {
    Value::Array(
        files
            .iter()
            .filter(|file| file.kind != TEXTURE_CANDIDATE)
            .map(|file| {
                json!({"file":file.name,"kind":file.kind,"sha256":file.digest,"truncated":file.truncated})
            })
            .collect(),
    )
}

mod probe;
pub(super) use probe::{expected, write_probe};
