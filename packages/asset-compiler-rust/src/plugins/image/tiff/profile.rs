//! Le profil d'un TIFF, lu dans son premier IFD avant tout décodage.
//!
//! TIFF est un conteneur de champs plutôt qu'un format : deux fichiers de même extension peuvent
//! n'avoir en commun que leurs huit premiers octets. Le pilote lit donc l'IFD lui-même pour savoir,
//! avant de décoder, s'il est devant l'un des profils qu'il déclare. Sans cette lecture la
//! bibliothèque déciderait à sa place, et un 16 bits reviendrait rogné à huit sans que personne ne
//! l'ait dit — exactement la perte que la politique d'import interdit d'ajouter.
//!
//! Champs, types et valeurs par défaut suivent « TIFF Revision 6.0 » (Adobe Developers Association,
//! 3 juin 1992), spécification publique. BigTIFF se reconnaît à son nombre magique 43.
use super::{DEPTH, PROFILE, UNREADABLE};

/// Les huit octets d'entête : ordre des octets, nombre magique, adresse du premier IFD.
const HEADER: usize = 8;
/// Une entrée d'IFD : tag, type, nombre de valeurs, puis la valeur ou son adresse.
const ENTRY: usize = 12;
/// Le nombre magique du TIFF classique ; 43 est celui de BigTIFF, que ce pilote refuse.
const CLASSIC: u32 = 42;
const BIG: u32 = 43;

const BITS_PER_SAMPLE: u32 = 258;
const COMPRESSION: u32 = 259;
const PHOTOMETRIC: u32 = 262;
const SAMPLES_PER_PIXEL: u32 = 277;
const PLANAR: u32 = 284;
const EXTRA_SAMPLES: u32 = 338;
const SAMPLE_FORMAT: u32 = 339;

/// Les compressions déclarées : aucune, LZW, Deflate — les deux tags qui le désignent — et
/// PackBits. Toutes rendent les octets d'origine tels quels. JPEG (6 et 7) et les CCITT (2, 3, 4)
/// en sont absents : le premier ajouterait une perte au décodage d'une source déjà perdue, les
/// seconds ne décrivent que du bilevel, hors des profils annoncés.
const COMPRESSIONS: [u32; 5] = [1, 5, 8, 32773, 32946];

/// Ce qu'une entrée d'IFD porte : son nombre de valeurs, et les quatre premières. Au-delà de quatre
/// composantes on est hors des profils déclarés, il n'y a plus rien à lire pour décider.
struct Field {
    count: u32,
    values: [u32; 4],
}

struct Ifd<'a> {
    bytes: &'a [u8],
    big_endian: bool,
}

impl Ifd<'_> {
    /// Un entier non signé de `width` octets, dans l'ordre déclaré par l'entête.
    fn uint(&self, at: usize, width: usize) -> Option<u32> {
        let mut value = 0;
        for (index, byte) in self.bytes.get(at..at + width)?.iter().enumerate() {
            let rank = if self.big_endian {
                width - 1 - index
            } else {
                index
            };
            value |= u32::from(*byte) << (8 * rank);
        }
        Some(value)
    }

    /// Les valeurs d'une entrée. Elles logent dans les quatre octets du champ quand elles y tiennent
    /// — cadrées à gauche —, sinon le champ porte leur adresse. Les types qui ne peuvent pas décrire
    /// un profil, à commencer par les rationnels, ne sont pas lus.
    fn field(&self, entry: usize) -> Option<Field> {
        let width = match self.uint(entry + 2, 2)? {
            1 | 2 | 6 | 7 => 1,
            3 | 8 => 2,
            4 | 9 => 4,
            _ => return None,
        };
        let count = self.uint(entry + 4, 4)?;
        let base = if u64::from(count) * width as u64 <= 4 {
            entry + HEADER
        } else {
            self.uint(entry + HEADER, 4)? as usize
        };
        let mut values = [0; 4];
        for (index, slot) in values.iter_mut().enumerate().take(count.min(4) as usize) {
            *slot = self.uint(base + index * width, width)?;
        }
        Some(Field { count, values })
    }

    /// L'entrée qui porte ce tag dans l'IFD commençant à `first`, ou rien.
    fn find(&self, first: usize, entries: usize, tag: u32) -> Option<Field> {
        (0..entries)
            .map(|index| first + 2 + index * ENTRY)
            .find(|entry| self.uint(*entry, 2) == Some(tag))
            .and_then(|entry| self.field(entry))
    }

    /// La valeur unique de ce tag, ou celle que la spécification donne par défaut quand il manque.
    fn single(&self, first: usize, entries: usize, tag: u32, default: u32) -> Option<u32> {
        match self.find(first, entries, tag) {
            None => Some(default),
            Some(field) if field.count == 1 => Some(field.values[0]),
            Some(_) => None,
        }
    }
}

/// Le profil de ce fichier, ou la raison de le refuser. Rien n'est décodé ici : on lit des champs.
pub(super) fn check(bytes: &[u8]) -> std::result::Result<(), &'static str> {
    let big_endian = match bytes.get(..2) {
        Some(b"II") => false,
        Some(b"MM") => true,
        _ => return Err(UNREADABLE),
    };
    let ifd = Ifd { bytes, big_endian };
    match ifd.uint(2, 2) {
        Some(CLASSIC) => {}
        // BigTIFF partage l'extension et presque l'entête, mais ses adresses tiennent sur huit
        // octets : c'est un autre format, sans lecteur ici, et il se nomme plutôt qu'il ne casse.
        Some(BIG) => return Err(PROFILE),
        _ => return Err(UNREADABLE),
    }
    let first = ifd.uint(4, 4).ok_or(UNREADABLE)? as usize;
    let entries = ifd.uint(first, 2).ok_or(UNREADABLE)? as usize;
    // Une page et une seule : d'un TIFF multi-pages la bibliothèque rendrait la première, et les
    // autres disparaîtraient sans rapport.
    if ifd.uint(first + 2 + entries * ENTRY, 4).ok_or(UNREADABLE)? != 0 {
        return Err(PROFILE);
    }
    let samples = ifd
        .single(first, entries, SAMPLES_PER_PIXEL, 1)
        .ok_or(PROFILE)?;
    depth(&ifd, first, entries, samples)?;
    colors(&ifd, first, entries, samples)?;
    if !COMPRESSIONS.contains(&ifd.single(first, entries, COMPRESSION, 1).ok_or(PROFILE)?) {
        return Err(PROFILE);
    }
    // Entrelacé seulement : en configuration séparée les composantes vivent dans des bandes
    // distinctes, c'est une autre organisation des données que ce pilote n'annonce pas lire.
    if ifd.single(first, entries, PLANAR, 1) != Some(1) {
        return Err(PROFILE);
    }
    Ok(())
}

/// Huit bits par composante, entiers non signés, et rien d'autre. Le 16 bits a sa propre raison :
/// ce n'est pas un profil exotique, c'est de la précision que la sortie du contrat ne sait pas
/// encore porter — la rogner en silence serait ajouter une perte.
fn depth(
    ifd: &Ifd<'_>,
    first: usize,
    entries: usize,
    samples: u32,
) -> std::result::Result<(), &'static str> {
    if samples == 0 || samples > 4 {
        return Err(PROFILE);
    }
    let bits = ifd.find(first, entries, BITS_PER_SAMPLE).ok_or(PROFILE)?;
    if bits.count != samples {
        return Err(PROFILE);
    }
    let read = &bits.values[..samples as usize];
    if read.contains(&16) {
        return Err(DEPTH);
    }
    let entiers = ifd
        .find(first, entries, SAMPLE_FORMAT)
        .is_none_or(|format| {
            format.values[..samples.min(format.count) as usize]
                .iter()
                .all(|value| *value == 1)
        });
    if read.iter().any(|value| *value != 8) || !entiers {
        return Err(PROFILE);
    }
    Ok(())
}

/// Les trois interprétations déclarées : gris 8 bits noir à zéro, RGB8 et RGBA8 à alpha droit. La
/// palette, le CMJN, le YCbCr et le CIELab n'ont pas de lecteur ici — la bibliothèque n'étend
/// d'ailleurs pas les palettes TIFF, et rien ne serait rendu plutôt que mal rendu.
fn colors(
    ifd: &Ifd<'_>,
    first: usize,
    entries: usize,
    samples: u32,
) -> std::result::Result<(), &'static str> {
    let photometric = ifd
        .single(first, entries, PHOTOMETRIC, u32::MAX)
        .ok_or(PROFILE)?;
    let extra = ifd.find(first, entries, EXTRA_SAMPLES);
    match (photometric, samples) {
        (1, 1) | (2, 3) if extra.is_none() => Ok(()),
        // Le quatrième canal d'un RGB n'est un alpha qu'une fois déclaré tel, et seul l'alpha non
        // associé (2) est droit : l'alpha associé (1) est prémultiplié, le rendre tel quel
        // changerait les couleurs.
        (2, 4) => match extra {
            Some(field) if field.count == 1 && field.values[0] == 2 => Ok(()),
            _ => Err(PROFILE),
        },
        _ => Err(PROFILE),
    }
}
