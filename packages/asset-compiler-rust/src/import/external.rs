//! Les fichiers que le lecteur ouvre **en plus** du fichier de scène : la bibliothèque de matériaux
//! d'un OBJ, un cache de géométrie. Sans eux, la clé du cache ne couvrait que le fichier revendiqué,
//! et un `.mtl` modifié laissait servir la scène d'avant.
//!
//! Ils entrent donc dans la clé, absence comprise : un fichier qui apparaît la change autant qu'un
//! fichier dont le contenu change. Le relevé d'une conversion précédente sert d'avance — il donne la
//! clé sans relire la source —, et quand il se trompe la conversion qui suit écrit la vraie clé.
//!
//! Les textures liées n'en sont pas : l'import ne les ouvre jamais, il ne fait que constater leur
//! présence pour en écrire l'URI. Leurs octets n'entrent dans la scène intermédiaire que lorsque le
//! fichier de scène les porte lui-même, et l'empreinte de ce fichier les couvre déjà.
use super::*;
use std::{fs::File, sync::Mutex};

/// Une bibliothèque de matériaux citée par la source — le `.mtl` d'un OBJ.
pub(super) const MATERIAL_LIBRARY: &str = "material-library";
/// Un cache de géométrie, que la source cite pour la déformation d'un maillage.
const GEOMETRY_CACHE: &str = "geometry-cache";
/// Le fichier de scène lui-même, celui que le lecteur ouvre le premier.
const MAIN_MODEL: &str = "model";
/// Les natures de fichier externe qu'un lecteur peut demander, dans l'ordre du contrat ufbx.
const KINDS: [&str; 3] = [MATERIAL_LIBRARY, GEOMETRY_CACHE, MAIN_MODEL];

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
        ufbx::OpenFileType::GeometryCache => GEOMETRY_CACHE,
        ufbx::OpenFileType::MainModel => MAIN_MODEL,
    }
}

fn kind_named(name: &str) -> Option<&'static str> {
    KINDS.into_iter().find(|kind| *kind == name)
}

/// Ce qu'on sait d'un fichier externe maintenant : son empreinte, ou son absence. La passe de
/// hachage rend aussi le dernier octet du fichier : une bibliothèque texte qui ne finit pas par une
/// fin de ligne a été coupée, et le fichier n'est pas rouvert pour le constater.
fn describe(path: &Path, kind: &'static str) -> External {
    let read = crate::hash_file_tail(path).ok();
    let truncated = kind == MATERIAL_LIBRARY
        && read
            .as_ref()
            .and_then(|(_, last)| *last)
            .is_some_and(|last| last != b'\n' && last != b'\r');
    let digest = read.map(|(digest, _)| digest);
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

/// Ce que le manifeste publie de chaque fichier externe : jamais son chemin complet.
pub(super) fn manifest(files: &[External]) -> Value {
    Value::Array(
        files
            .iter()
            .map(|file| {
                json!({"file":file.name,"kind":file.kind,"sha256":file.digest,"truncated":file.truncated})
            })
            .collect(),
    )
}

/// Le relevé d'une conversion précédente vit hors de `imports/`, qui ne porte que des scènes, et
/// appartient au dossier qui résout les dépendances autant qu'aux entrées : deux sources aux mêmes
/// octets posées ailleurs n'ouvrent pas les mêmes fichiers. La clé définitive reste par contenu.
fn probe_path(cache: &Path, base: &str, root: &Path) -> PathBuf {
    let stamp = hash(format!("{base}\n{}", root.to_string_lossy()).as_bytes());
    let folder = cache.join("native").join("imports-externes");
    folder.join(format!("{stamp}.json"))
}

/// Les fichiers qu'une conversion précédente des mêmes entrées, ici, avait ouverts, rehachés.
pub(super) fn expected(cache: &Path, base: &str, root: &Path) -> Vec<External> {
    let Ok(bytes) = fs::read(probe_path(cache, base, root)) else {
        return Vec::new();
    };
    let Ok(listed) = serde_json::from_slice::<Value>(&bytes) else {
        return Vec::new();
    };
    listed
        .as_array()
        .map(|files| files.iter().filter_map(reread).collect())
        .unwrap_or_default()
}

fn reread(entry: &Value) -> Option<External> {
    let path = entry.get("path")?.as_str()?;
    let kind = kind_named(entry.get("kind")?.as_str()?)?;
    Some(describe(Path::new(path), kind))
}

/// Écrit le relevé, ou l'efface quand l'import n'a rien ouvert d'autre que sa source.
pub(super) fn write_probe(cache: &Path, base: &str, root: &Path, files: &[External]) -> Result<()> {
    let path = probe_path(cache, base, root);
    if files.is_empty() {
        let _ = fs::remove_file(&path);
        return Ok(());
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let listed: Vec<Value> = files
        .iter()
        .map(|file| json!({"path":file.path,"kind":file.kind}))
        .collect();
    atomic(&path, &serde_json::to_vec(&Value::Array(listed))?)
}
