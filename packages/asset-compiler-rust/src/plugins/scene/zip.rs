//! Pilote ZIP, conteneur. L'archive n'est pas une scène : elle est extraite sous le cache, puis son
//! contenu est routé comme n'importe quelle source, et ce pilote rend ce que le pilote de scène
//! retenu rend. Rien n'est réencodé — un ZIP est un emballage, l'extraction est sans perte.
//!
//! Provenance : format ouvert (APPNOTE 6.3.10, PKWARE), lu par la caisse `zip` 8.6.0 (MIT, dépôt
//! zip-rs/zip2), en décompression seule et sans son défaut de fonctionnalités : seul `deflate` par
//! `flate2` est compilé, aucun code d'éditeur n'entre ici. Une archive chiffrée est refusée, jamais
//! contournée.
use super::*;
use crate::CompilerError;
use ::zip::ZipArchive;
use std::{fs, io::Read};

pub(super) static ZIP: Zip = Zip;
pub(super) struct Zip;

/// Entête d'une entrée locale : toute archive qui porte au moins un fichier commence par là.
const LOCAL_FILE_HEADER: &[u8] = b"PK\x03\x04";
/// Fin de l'index central : c'est à lui seul toute une archive vide.
const END_OF_CENTRAL_DIRECTORY: &[u8] = b"PK\x05\x06";

impl Plugin for Zip {
    fn name(&self) -> &'static str {
        "zip"
    }
    /// Le conteneur ne lit aucune géométrie : cette version nomme l'extracteur, pas un décodeur.
    fn version(&self) -> &'static str {
        "zip-appnote-6.3.10-zip-8.6.0-extract-1"
    }
    fn extensions(&self) -> &'static [&'static str] {
        &["zip"]
    }
}

impl ScenePlugin for Zip {
    fn accepts_head(&self, head: &[u8]) -> bool {
        head.starts_with(LOCAL_FILE_HEADER) || head.starts_with(END_OF_CENTRAL_DIRECTORY)
    }
    fn prepare(&self, request: &SceneRequest<'_>) -> Result<PreparedScene> {
        archive::container(request, self, |file, root| extract(request, file, root))
    }
}

/// Extrait l'archive sous `root` et rend le nombre d'entrées et le total décompressé.
///
/// Deux passes : la première juge toute l'archive sur son index — sortie de dossier, lien
/// symbolique, chiffrement, plafonds — la seconde écrit. Une archive refusée ne laisse donc aucun
/// fichier derrière elle, et une archive qui ment sur la taille annoncée de ses entrées est arrêtée
/// à l'écriture par le même plafond.
fn extract(request: &SceneRequest<'_>, source: &Path, root: &Path) -> Result<(usize, u64)> {
    let mut archive = open(source)?;
    if archive.is_empty() {
        return Err(archive::empty(source));
    }
    archive::under_entry_limit(archive.len())?;
    let mut declared = 0u64;
    for index in 0..archive.len() {
        archive::check(request)?;
        let entry = archive
            .by_index_raw(index)
            .map_err(|error| archive::unreadable(source, error))?;
        if entry.encrypted() {
            return Err(CompilerError::new(
                archive::ENCRYPTED,
                format!("archive entry {:?} is encrypted", entry.name()),
            ));
        }
        if entry.is_symlink() {
            return Err(CompilerError::new(
                archive::SYMLINK,
                format!("archive entry {:?} is a symbolic link", entry.name()),
            ));
        }
        archive::safe_join(root, entry.name())?;
        declared = declared.saturating_add(entry.size());
        archive::under_byte_limit(declared)?;
    }
    let mut written = 0u64;
    for index in 0..archive.len() {
        archive::check(request)?;
        let mut entry = archive
            .by_index(index)
            .map_err(|error| archive::unreadable(source, error))?;
        let path = archive::safe_join(root, entry.name())?;
        if entry.is_dir() {
            fs::create_dir_all(&path)?;
            continue;
        }
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        let room = archive::LIMITS.bytes - written;
        let mut file = fs::File::create(&path)?;
        written += std::io::copy(&mut Read::take(&mut entry, room + 1), &mut file)?;
        archive::under_byte_limit(written)?;
    }
    Ok((archive.len(), written))
}

/// Ouvre l'index central. Une archive tronquée, corrompue ou compressée par une méthode que ce
/// binaire n'embarque pas s'arrête ici, nommée, sans rien avoir écrit.
fn open(source: &Path) -> Result<ZipArchive<std::io::BufReader<fs::File>>> {
    let file = std::io::BufReader::new(fs::File::open(source)?);
    ZipArchive::new(file).map_err(|error| archive::unreadable(source, error))
}
