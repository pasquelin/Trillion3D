//! Socle des pilotes de conteneur : un format qui ne porte pas une scène mais l'emballage d'une
//! source. Un conteneur ne lit aucune géométrie. Il extrait sous le cache, puis rend le dossier
//! extrait au routeur : c'est un pilote de scène ordinaire qui produit la scène intermédiaire, et
//! le conteneur ne rend rien d'autre que ce que ce pilote rend.
//!
//! Ce module tient les protections et l'identité, qui ne dépendent d'aucun format : plafonds, refus
//! nommés, refus de sortie de dossier, clé d'extraction. Son sous-module `container` tient le
//! déroulé commun — extraire, marquer, router. Un second conteneur n'ajoute donc que sa lecture.
use super::*;
use crate::{hash, is_safe_source_name, CompilerError};
use std::sync::atomic::Ordering;

mod container;

pub(super) use container::container;

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


/// Le refus d'une archive que son lecteur n'ouvre pas : tronquée, corrompue, ou compressée par une
/// méthode que ce binaire n'embarque pas. La raison du lecteur voyage telle quelle.
pub(super) fn unreadable(source: &Path, error: impl std::fmt::Display) -> CompilerError {
    CompilerError::new(UNREADABLE, format!("{}: {error}", source.to_string_lossy()))
}

/// Le refus d'une archive bien formée qui ne porte aucune entrée.
pub(super) fn empty(source: &Path) -> CompilerError {
    CompilerError::new(
        EMPTY,
        format!("{}: archive is empty", source.to_string_lossy()),
    )
}

/// Le plafond d'entrées, dès que le lecteur sait combien l'archive en porte.
pub(super) fn under_entry_limit(entries: usize) -> Result<()> {
    if entries > LIMITS.entries {
        return Err(CompilerError::new(
            TOO_MANY_ENTRIES,
            format!(
                "archive holds {entries} entries, over the {} allowed",
                LIMITS.entries
            ),
        ));
    }
    Ok(())
}

/// Le plafond d'octets décompressés, sur le total annoncé par l'index puis sur le total écrit : une
/// archive qui ment sur la taille de ses entrées est arrêtée par le même compte.
pub(super) fn under_byte_limit(bytes: u64) -> Result<()> {
    if bytes > LIMITS.bytes {
        return Err(CompilerError::new(
            TOO_LARGE,
            format!(
                "archive expands past the {} uncompressed bytes allowed",
                LIMITS.bytes
            ),
        ));
    }
    Ok(())
}
