//! Socle des pilotes de conteneur : un format qui ne porte pas une scène mais l'emballage d'une
//! source. Un conteneur ne lit aucune géométrie. Il extrait sous le cache, puis rend le dossier
//! extrait au routeur : c'est un pilote de scène ordinaire qui produit la scène intermédiaire, et
//! le conteneur ne rend rien d'autre que ce que ce pilote rend.
//!
//! Ce module tient ce qui ne dépend pas du format d'archive — plafonds, refus de sortie de dossier,
//! clé d'extraction, composition avec le routeur — pour qu'un second conteneur soit un module de
//! plus et non une reprise de celui-ci.
use super::*;
use crate::{atomic, hash, is_safe_source_name, CompilerError};
use serde_json::json;
use std::sync::atomic::Ordering;

/// Plafonds d'une extraction. Au-delà, l'archive est refusée par son nom : une archive n'est jamais
/// extraite à moitié, sans quoi le routeur verrait un dossier incomplet comme une scène.
pub(super) struct Limits {
    /// Nombre maximal d'entrées lues dans une archive.
    pub(super) entries: usize,
    /// Total maximal des octets décompressés écrits dans le cache.
    pub(super) bytes: u64,
}

/// Les plafonds des conteneurs. Une place de marché livre des kits de plusieurs gigaoctets ; au-delà
/// de ceux-ci, ce n'est plus un asset mais une archive piégée — cent octets qui en écrivent mille
/// milliards, ou un million d'entrées qui saturent le cache.
pub(super) const LIMITS: Limits = Limits {
    entries: 20_000,
    bytes: 8 * 1024 * 1024 * 1024,
};

/// Une entrée sort du dossier d'extraction : chemin absolu, remontée, volume nommé.
pub(super) const PATH_ESCAPE: &str = "ARCHIVE_PATH_ESCAPE";
/// L'archive ne se lit pas : tronquée, corrompue, ou un format de compression que ce binaire n'a pas.
pub(super) const UNREADABLE: &str = "ARCHIVE_UNREADABLE";
/// L'archive est bien formée mais ne porte aucune entrée.
pub(super) const EMPTY: &str = "ARCHIVE_EMPTY";
/// L'archive est chiffrée : la contourner est interdit, le compilateur refuse et le dit.
pub(super) const ENCRYPTED: &str = "ARCHIVE_ENCRYPTED";
/// Une entrée est un lien symbolique : il n'est jamais suivi, il désigne hors de l'extraction.
pub(super) const SYMLINK: &str = "ARCHIVE_SYMLINK";
/// Le total décompressé dépasse `LIMITS.bytes`.
pub(super) const TOO_LARGE: &str = "ARCHIVE_TOO_LARGE";
/// Le nombre d'entrées dépasse `LIMITS.entries`.
pub(super) const TOO_MANY_ENTRIES: &str = "ARCHIVE_TOO_MANY_ENTRIES";

/// Le dossier d'extraction d'une archive, sous le cache du compilateur. La clé tient le nom et la
/// version du conteneur et l'empreinte de l'archive : une archive inchangée se réextrait jamais, une
/// archive modifiée n'hérite jamais des fichiers de la précédente.
pub(super) fn extraction_dir(
    request: &SceneRequest<'_>,
    container: &dyn ScenePlugin,
    digest: &str,
) -> PathBuf {
    let key = hash(format!("{}:{}:{digest}", container.name(), container.version()).as_bytes());
    request.cache.join("native").join("archives").join(key)
}

/// Le chemin d'une entrée sous la racine d'extraction. Une entrée absolue, qui remonte, qui nomme un
/// volume ou qui porte un séparateur inversé désigne un fichier hors de la racine : c'est la sortie
/// de dossier par l'archive, refusée avant que le moindre octet soit écrit.
pub(super) fn safe_join(root: &Path, name: &str) -> Result<PathBuf> {
    let refused = || {
        CompilerError::new(
            PATH_ESCAPE,
            format!("archive entry {name:?} escapes the extraction directory"),
        )
    };
    if name.starts_with('/') || name.contains('\\') || name.contains(':') {
        return Err(refused());
    }
    let mut out = root.to_path_buf();
    for part in name.split('/').filter(|part| !part.is_empty()) {
        if !is_safe_source_name(part) {
            return Err(refused());
        }
        out.push(part);
    }
    if out == root {
        return Err(refused());
    }
    Ok(out)
}

/// Annulation, à vérifier à chaque entrée : une archive de dix mille fichiers s'arrête sur demande.
pub(super) fn check(request: &SceneRequest<'_>) -> Result<()> {
    if request.cancelled.load(Ordering::Relaxed) {
        return Err(CompilerError::new("CANCELLED", "Compilation cancelled"));
    }
    Ok(())
}

/// Route le dossier extrait et lui fait produire la scène intermédiaire. Rend le pilote interne
/// retenu, `None` quand le dossier portait déjà son manifeste — une extraction réutilisée.
pub(super) fn compose(
    request: &SceneRequest<'_>,
    extracted: &Path,
) -> Result<(PreparedScene, Option<&'static dyn ScenePlugin>)> {
    let root = single_root(extracted);
    match route(&root)? {
        Routed::Manifest => Ok((PreparedScene::Converted(root), None)),
        Routed::Driver(inner, inputs) => {
            let inner_request = SceneRequest {
                source: &root,
                inputs: &inputs,
                cache: request.cache,
                cancelled: request.cancelled,
                progress: request.progress,
            };
            let scene = match inner.prepare(&inner_request)? {
                PreparedScene::InPlace(name) => stage_in_place(&root, &name)?,
                converted => converted,
            };
            Ok((scene, Some(inner)))
        }
    }
}

/// La chaîne du conteneur et de son pilote interne, telle qu'elle voyage dans le rapport et dans la
/// marque d'extraction : deux pilotes sont intervenus, les deux se nomment et se versionnent.
pub(super) fn chain(container: &dyn ScenePlugin, inner: Option<&dyn ScenePlugin>) -> Value {
    json!([
        crate::plugins::provenance(container),
        inner.map(crate::plugins::provenance)
    ])
}

/// Un glTF laissé en place par son pilote se lit à côté de la source ; dans une archive, la source
/// est l'archive et non le dossier extrait. Le conteneur pose donc dans ce dossier le manifeste que
/// le compilateur calculerait lui-même pour cette scène — les mêmes octets, donc la même identité de
/// cache qu'hors archive — et rend le dossier comme scène intermédiaire.
fn stage_in_place(root: &Path, name: &str) -> Result<PreparedScene> {
    let loaded = crate::load_model_file(root, name, None)?;
    atomic(&root.join("manifest.json"), &loaded.manifest_bytes)?;
    Ok(PreparedScene::Converted(root.to_path_buf()))
}

/// Un unique dossier racine — `kit/` dans `kit.zip` — est traversé : l'archive livre l'arbre du
/// projet, pas un dossier qui n'existe que pour l'emballage. Un dossier qui porte autre chose qu'un
/// seul sous-dossier est la racine cherchée.
fn single_root(extracted: &Path) -> PathBuf {
    let mut root = extracted.to_path_buf();
    while let Some(only) = only_child(&root) {
        root = only;
    }
    root
}

/// L'unique enfant d'un dossier quand c'en est un dossier, sinon rien.
fn only_child(dir: &Path) -> Option<PathBuf> {
    let mut entries = std::fs::read_dir(dir).ok()?;
    let first = entries.next()?.ok()?.path();
    if entries.next().is_some() || !first.is_dir() {
        return None;
    }
    Some(first)
}
