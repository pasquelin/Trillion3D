//! Les découpes déclarées en mélange : mesurer, proposer, obéir.
//!
//! La géométrie virtualisée de la référence n'accepte que l'opaque et le masqué. Un feuillage
//! déclaré en mélange ne passe donc pas par son chemin rapide — et chez elle, un humain ouvre le
//! matériau et coche « masqué » avant de livrer. Nous importons les fichiers des autres : personne
//! n'a coché la case. Le compilateur tient ce rôle, mais sans jamais deviner en silence.
//!
//! Le mécanisme est donc en deux temps. Le compilateur MESURE l'alpha de chaque texture candidate,
//! dans le décodage que les aperçus font déjà, et PROPOSE un verdict ; il écrit sa feuille de
//! réponses à côté du modèle compilé, à chaque compilation, qu'il y ait ou non quelque chose à
//! trancher. Il n'applique ensuite que ce que cette feuille lui répond, rangé par empreinte
//! d'image : une réponse vaut donc pour toute scène qui partage la texture. Sans réponse, rien ne
//! change, et le mélange reste du mélange.
use super::*;

mod apply;
pub(crate) mod measure;
mod page;
mod sheet;
#[cfg(test)]
mod tests;

pub(crate) use apply::{apply_decisions, CutoutApplied};
pub(crate) use measure::{measure, AlphaShape};
pub(crate) use page::write_page;
pub(crate) use sheet::{draw_weights, entries, write_sheet, Entry};

/// Le nom de la feuille de réponses et celui de la page qui sert à la remplir. Les deux vivent à la
/// racine du modèle compilé : un chemin stable, que la clé de compilation ne déplace pas et que la
/// purge du cache ne touche pas.
pub const DECISIONS_FILE: &str = "decoupes.json";
pub const PAGE_FILE: &str = "decoupes.html";
/// Version de la feuille. Un numéro inconnu est refusé plutôt que deviné : une réponse mal lue
/// changerait l'image sans que personne l'ait demandé.
const DECISIONS_VERSION: u64 = 1;
/// Le seuil auquel un matériau reclassé découpe, celui de glTF par défaut.
pub(crate) const CUTOUT_ALPHA: f64 = 0.5;

/// Les réponses lues, rangées par empreinte d'image. Aucune feuille, ou une feuille où personne ne
/// s'est prononcé, est un cas ordinaire : la scène reste telle qu'elle est déclarée.
pub(crate) struct Decisions {
    path: PathBuf,
    found: bool,
    by_image: BTreeMap<String, bool>,
}

impl Decisions {
    /// La réponse donnée pour cette image, ou `None` quand personne ne s'est prononcé.
    pub fn verdict(&self, sha256: &str) -> Option<bool> {
        self.by_image.get(sha256).copied()
    }
    pub fn answers(&self) -> impl Iterator<Item = (&String, bool)> {
        self.by_image
            .iter()
            .map(|(sha256, cutout)| (sha256, *cutout))
    }
    pub fn report(&self) -> Value {
        json!({"file":self.path.to_string_lossy(),"found":self.found,"answers":self.by_image.len()})
    }
}

/// Lit la feuille du modèle compilé. Quand il n'en a pas encore — première compilation, cache
/// effacé —, une feuille posée à côté de la source l'amorce : un fournisseur peut livrer ses
/// réponses avec son modèle. La source, elle, n'est jamais écrite.
pub(crate) fn load_decisions(cache: &Path, source: &Path) -> Result<Decisions> {
    let path = cache.join(DECISIONS_FILE);
    let seed = source_directory(source).join(DECISIONS_FILE);
    let (path, bytes) = match fs::read(&path) {
        Ok(bytes) => (path, Some(bytes)),
        Err(_) => match fs::read(&seed) {
            Ok(bytes) => (seed, Some(bytes)),
            Err(_) => (path, None),
        },
    };
    let Some(bytes) = bytes else {
        return Ok(Decisions {
            path,
            found: false,
            by_image: BTreeMap::new(),
        });
    };
    Ok(Decisions {
        by_image: read_answers(&path, &bytes)?,
        path,
        found: true,
    })
}

/// Le dossier où une feuille livrée avec la source se trouverait : celui de la scène préparée, ou
/// celui du fichier à importer.
fn source_directory(source: &Path) -> PathBuf {
    if source.is_dir() {
        return source.to_path_buf();
    }
    source.parent().unwrap_or(Path::new(".")).to_path_buf()
}

/// Les réponses d'une feuille. Une feuille illisible, d'une version inconnue ou dont une réponse
/// n'est ni vraie, ni fausse, ni `null` est une ERREUR : la réponse de l'utilisateur ne se perd
/// jamais en silence.
fn read_answers(path: &Path, bytes: &[u8]) -> Result<BTreeMap<String, bool>> {
    let refuse = |message: String| CompilerError::new("INVALID_CUTOUT_DECISIONS", message);
    let parsed: Value = serde_json::from_slice(bytes)
        .map_err(|error| refuse(format!("{} is not readable JSON: {error}", path.display())))?;
    if parsed.get("version").and_then(Value::as_u64) != Some(DECISIONS_VERSION) {
        return Err(refuse(format!(
            "{} declares an unknown version",
            path.display()
        )));
    }
    let mut answers = BTreeMap::new();
    let textures = parsed.get("textures").and_then(Value::as_object);
    for (sha256, entry) in textures.into_iter().flatten() {
        match entry.get("cutout").unwrap_or(&Value::Null) {
            Value::Null => continue,
            Value::Bool(cutout) => answers.insert(sha256.clone(), *cutout),
            _ => {
                return Err(refuse(format!(
                    "{}: texture {sha256} answers neither true, false nor null",
                    path.display()
                )))
            }
        };
    }
    Ok(answers)
}
