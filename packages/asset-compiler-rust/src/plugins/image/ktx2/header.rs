//! L'entête KTX 2.0 et son index de niveaux, lus champ par champ depuis la spécification publique
//! de Khronos. Les décalages sont ceux de la structure du document : douze octets d'identifiant,
//! puis `vkFormat`, `typeSize`, les trois dimensions, `layerCount`, `faceCount`, `levelCount` et
//! `supercompressionScheme`, puis l'index des trois sections, puis l'index des niveaux.
//!
//! Ce module ne lit aucun pixel : il rend la surface — codec, dimensions, schéma de supercompression
//! et bornes du niveau 0 — ou un refus nommé. La chaîne annoncée est vérifiée entière : un KTX2 qui
//! promet neuf niveaux dont l'un sort du fichier est tronqué, pas à moitié bon.
use super::{
    DATA_TRUNCATED, HEADER_INVALID, HEADER_TRUNCATED, LAYOUT_UNSUPPORTED, MAGIC,
    SUPERCOMPRESSION_UNSUPPORTED,
};
use crate::plugins::image::MAX_LEVELS;

/// Fin de l'entête fixe : identifiant, quatorze champs et l'index des trois sections.
const HEADER_END: usize = 80;
/// Une entrée de l'index des niveaux : décalage, longueur, longueur une fois décompressée.
const LEVEL_ENTRY: usize = 24;
/// `typeSize` vaut un pour tout format compressé en blocs comme pour l'octet non compressé ; une
/// autre valeur annonce des mots de plusieurs octets à réordonner, hors de la liste déclarée.
const TYPE_SIZE: u32 = 1;

/// `supercompressionScheme` : les trois schémas que ce pilote déclare, sur les quatre numérotés.
/// ZLIB (3) n'entre pas — aucun encodeur courant ne l'écrit, et un lecteur non exercé ment.
const NONE: u32 = 0;
const BASIS_LZ: u32 = 1;
pub(super) const ZSTD: u32 = 2;

/// La surface que le pilote va lire : son codec, sa taille, sa supercompression et son niveau 0.
pub(super) struct Surface {
    pub(super) format: u32,
    pub(super) width: u32,
    pub(super) height: u32,
    pub(super) supercompression: u32,
    /// Les bornes du niveau 0 dans le fichier, telles que l'index les donne.
    pub(super) level: std::ops::Range<usize>,
    /// `uncompressedByteLength` du niveau 0 : ce que la supercompression doit rendre.
    pub(super) plain: usize,
}

/// Le mot de trente-deux bits à ce décalage, petit-boutien comme tout le format.
fn word(bytes: &[u8], at: usize) -> u32 {
    u32::from_le_bytes([bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]])
}

/// Le mot de soixante-quatre bits à ce décalage : l'index des niveaux ne compte qu'en 64 bits.
fn long(bytes: &[u8], at: usize) -> std::result::Result<usize, &'static str> {
    let long = u64::from_le_bytes(bytes[at..at + 8].try_into().map_err(|_| DATA_TRUNCATED)?);
    usize::try_from(long).map_err(|_| DATA_TRUNCATED)
}

pub(super) fn parse(bytes: &[u8]) -> std::result::Result<Surface, &'static str> {
    if bytes.len() < HEADER_END {
        return Err(HEADER_TRUNCATED);
    }
    if !bytes.starts_with(MAGIC) {
        return Err(HEADER_INVALID);
    }
    let format = word(bytes, 12);
    let (width, height, depth) = (word(bytes, 20), word(bytes, 24), word(bytes, 28));
    let (layers, faces, levels) = (word(bytes, 32), word(bytes, 36), word(bytes, 40));
    let supercompression = word(bytes, 44);
    if width == 0 || word(bytes, 16) != TYPE_SIZE || levels > MAX_LEVELS {
        return Err(HEADER_INVALID);
    }
    // Hauteur nulle (texture à une dimension), volume, tableau de couches et cube : le pilote ne
    // déclare que la surface plane unique.
    if height == 0 || depth > 0 || layers > 1 || faces != 1 {
        return Err(LAYOUT_UNSUPPORTED);
    }
    if !matches!(supercompression, NONE | BASIS_LZ | ZSTD) {
        return Err(SUPERCOMPRESSION_UNSUPPORTED);
    }
    // `levelCount` nul annonce une texture dont les niveaux se calculent au chargement : un seul
    // niveau est stocké, et c'est celui-là qu'on lit.
    let levels = levels.max(1) as usize;
    let (level, plain) = chain(bytes, levels)?;
    Ok(Surface {
        format,
        width,
        height,
        supercompression,
        level,
        plain,
    })
}

/// L'index des niveaux, entier. Chaque niveau annoncé doit tenir dans le fichier et commencer après
/// l'index lui-même ; on ne lit que le niveau 0, mais on refuse de le lire dans un fichier qui ment.
fn chain(
    bytes: &[u8],
    levels: usize,
) -> std::result::Result<(std::ops::Range<usize>, usize), &'static str> {
    let index = HEADER_END + levels * LEVEL_ENTRY;
    if bytes.len() < index {
        return Err(HEADER_TRUNCATED);
    }
    let mut base = (0..0, 0);
    for level in 0..levels {
        let at = HEADER_END + level * LEVEL_ENTRY;
        let offset = long(bytes, at)?;
        let end = offset
            .checked_add(long(bytes, at + 8)?)
            .ok_or(DATA_TRUNCATED)?;
        if offset < index {
            return Err(HEADER_INVALID);
        }
        if end > bytes.len() {
            return Err(DATA_TRUNCATED);
        }
        if level == 0 {
            base = (offset..end, long(bytes, at + 16)?);
        }
    }
    Ok(base)
}
