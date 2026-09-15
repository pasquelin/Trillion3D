//! Pilote USDZ, conteneur. Un `.usdz` est un ZIP **non compressé** dont chaque charge commence sur
//! un multiple de soixante-quatre octets : l'emballage sert à lire une couche USD et ses images en
//! place, jamais à les réduire. Ce pilote l'extrait sous le cache, puis rend au routeur ce qu'il a
//! extrait ; il ne lit aucune géométrie et ne réencode rien.
//!
//! Provenance : *OpenUSD Core Specification* de l'AOUSD pour la disposition du paquet, APPNOTE
//! 6.3.10 de PKWARE pour le conteneur, lu par `archive/zip_reader.rs`, partagé avec le pilote `zip`.
//!
//! Le dossier extrait porte la couche et les images à côté d'elle : le routeur y reconnaît le pilote
//! `usd`, qui résout les URI d'images contre ce même dossier. Une archive sans couche USD est
//! refusée par `SOURCE_FORMAT_UNKNOWN`, une archive qui en porte plusieurs par
//! `SOURCE_FORMAT_AMBIGUOUS` : c'est au paquet de dire quelle couche il livre, pas au compilateur de
//! la deviner.
use super::*;
use crate::CompilerError;

pub(super) static USDZ: Usdz = Usdz;
pub(super) struct Usdz;

/// L'alignement que la spécification impose à la charge de chaque entrée.
const ALIGNMENT: u64 = 64;
/// La méthode de compression que la spécification impose : aucune.
const STORED: ::zip::CompressionMethod = ::zip::CompressionMethod::Stored;
/// Le paquet n'est pas disposé comme la spécification le demande : une entrée est compressée, ou sa
/// charge ne commence pas sur un multiple de soixante-quatre octets.
const LAYOUT: &str = "USDZ_LAYOUT_INVALID";

impl Plugin for Usdz {
    fn name(&self) -> &'static str {
        "usdz"
    }
    /// Le conteneur ne lit aucune géométrie : cette version nomme l'extracteur, pas un décodeur.
    fn version(&self) -> &'static str {
        "usdz-aousd-1.0-zip-8.6.0-extract-1"
    }
    fn extensions(&self) -> &'static [&'static str] {
        &["usdz"]
    }
}

impl ScenePlugin for Usdz {
    /// Un paquet USDZ est un ZIP : il commence par l'entête d'une entrée locale. Un paquet vide
    /// n'existe pas — il lui faut au moins sa couche —, mais l'entête d'index vide est reconnue
    /// quand même, pour que le paquet soit refusé en le disant plutôt qu'ignoré par le routeur.
    fn accepts_head(&self, head: &[u8]) -> bool {
        archive::zip_reader::accepts_head(head)
    }
    fn prepare(&self, request: &SceneRequest<'_>) -> Result<PreparedScene> {
        archive::container(request, self, |file, root| {
            layout(file)?;
            archive::zip_reader::extract(request, file, root)
        })
    }
}

/// Juge la disposition du paquet avant qu'un octet soit écrit : chaque entrée est stockée telle
/// quelle et sa charge est alignée. Une entrée dont la charge ne s'annonce pas est refusée aussi :
/// c'est un entête local que le lecteur n'a pas su placer.
fn layout(source: &Path) -> Result<()> {
    let mut archive = archive::zip_reader::open(source)?;
    for index in 0..archive.len() {
        let entry = archive
            .by_index(index)
            .map_err(|error| archive::unreadable(source, error))?;
        if entry.compression() != STORED {
            return Err(refused(entry.name(), "is compressed"));
        }
        if entry.is_dir() {
            continue;
        }
        match entry.data_start() {
            Some(start) if start % ALIGNMENT == 0 => {}
            _ => {
                return Err(refused(
                    entry.name(),
                    "does not start on a 64-byte boundary",
                ))
            }
        }
    }
    Ok(())
}

/// Le refus d'un paquet mal disposé, nommant l'entrée en cause.
fn refused(name: &str, why: &str) -> CompilerError {
    CompilerError::new(
        LAYOUT,
        format!(
            "usdz entry {name:?} {why}; a USDZ package stores every file uncompressed and aligned"
        ),
    )
}
