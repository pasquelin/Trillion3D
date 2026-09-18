//! La purge des niveaux de texture cuits : un dossier `textures/<sha>/` que plus aucun manifeste
//! survivant ne nomme s'en va, comme un objet de page. Sortie de `compiler_prune.rs` pour tenir la
//! limite de lignes du dépôt.
use super::*;

/// Supprime sous `native/textures/` chaque dossier d'empreinte que `keep` ne nomme pour aucun
/// scope, et tout dossier d'une autre version de la règle que celle de ce compilateur : les
/// manifestes survivants sont écrits par lui, donc rien ne lit plus ces niveaux-là. Rend les
/// dossiers retirés et les octets rendus.
pub(super) fn prune_textures(native: &Path, keep: &BTreeSet<String>) -> Result<(usize, u64)> {
    let mut removed = 0usize;
    let mut bytes = 0u64;
    let current = native.join(texture_preview::texture_version_dir());
    let Ok(versions) = fs::read_dir(native.join(texture_preview::TEXTURE_DIR)) else {
        return Ok((0, 0));
    };
    for version in versions {
        let version = version?;
        if !version.file_type()?.is_dir() {
            continue;
        }
        if version.path() != current {
            bytes += dir_bytes(&version.path());
            fs::remove_dir_all(version.path())?;
            removed += 1;
            continue;
        }
        for entry in fs::read_dir(version.path())? {
            let entry = entry?;
            let name = entry.file_name();
            let Some(name) = name.to_str() else { continue };
            if !entry.file_type()?.is_dir() || keep.contains(name) {
                continue;
            }
            bytes += dir_bytes(&entry.path());
            fs::remove_dir_all(entry.path())?;
            removed += 1;
        }
    }
    Ok((removed, bytes))
}

/// Les octets des fichiers d'un dossier, sous-dossiers compris ; zéro pour ce qui ne se lit pas.
fn dir_bytes(dir: &Path) -> u64 {
    let Ok(entries) = fs::read_dir(dir) else {
        return 0;
    };
    entries
        .flatten()
        .map(|entry| match entry.metadata() {
            Ok(meta) if meta.is_dir() => dir_bytes(&entry.path()),
            Ok(meta) => meta.len(),
            Err(_) => 0,
        })
        .sum()
}
