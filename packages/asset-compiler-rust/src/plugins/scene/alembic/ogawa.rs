//! Le conteneur Ogawa, lu ici depuis la spécification publique d'Alembic et ses sources de
//! référence (BSD-3-Clause, `lib/Alembic/Ogawa`) : aucune bibliothèque tierce, aucun SDK d'éditeur.
//!
//! Un fichier Ogawa est un arbre de deux sortes de blocs, qu'un entier de soixante-quatre bits
//! désigne et dont le bit de poids fort dit la sorte : un **groupe** — un nombre d'enfants, puis
//! autant de pointeurs — et une **donnée** — une longueur, puis ses octets. L'entête tient en seize
//! octets : `Ogawa`, un drapeau de gel, la version du format, la position du groupe racine.
//!
//! Tout ce qui est lu ici est borné deux fois : par la taille du fichier, et par un plafond nommé.
//! Un pointeur corrompu ne fait donc ni paniquer ni allouer un gigaoctet — il rend un refus nommé.
use super::{FILE_INVALID, HDF5_UNSUPPORTED, SIZE_UNSUPPORTED};
use crate::{CompilerError, Result};
use memmap2::Mmap;
use std::{fs::File, path::Path};

/// Les cinq octets qui ouvrent tout fichier Ogawa.
pub(super) const MAGIC: &[u8] = b"Ogawa";
/// L'entête du conteneur HDF5, l'emballage historique d'Alembic, que ce pilote ne lit pas.
const HDF5_MAGIC: &[u8] = b"\x89HDF";
/// Le bit qui distingue une donnée d'un groupe dans un pointeur d'enfant.
const DATA_BIT: u64 = 0x8000_0000_0000_0000;
/// Le reste du pointeur : l'adresse du bloc dans le fichier.
const ADDRESS: u64 = 0x7fff_ffff_ffff_ffff;
/// Enfants au plus dans un groupe. Un fichier sain en compte quelques dizaines par objet ; au-delà,
/// c'est une adresse corrompue lue comme un compte, et la lire allouerait des mégaoctets pour rien.
const MAX_CHILDREN: u64 = 1 << 22;
/// Octets au plus dans un bloc de données lu d'un coup — un échantillon de géométrie, pas une scène.
const MAX_DATA_BYTES: u64 = 1 << 30;

/// Un fichier Ogawa ouvert en lecture seule, projeté en mémoire.
pub(super) struct Ogawa {
    map: Mmap,
    /// La version du format Alembic que l'entête déclare.
    pub(super) version: u16,
    /// Le groupe racine : les six blocs que toute archive Alembic porte.
    pub(super) root: Vec<u64>,
}

/// Le refus d'un fichier dont la structure ne tient pas : tronqué, corrompu, ou pas un Ogawa.
pub(super) fn invalid(what: impl Into<String>) -> CompilerError {
    CompilerError::new(FILE_INVALID, what.into())
}

/// Ce pointeur désigne-t-il une donnée plutôt qu'un groupe ?
pub(super) fn is_data(child: u64) -> bool {
    child & DATA_BIT != 0
}

fn read_u64(bytes: &[u8], at: u64) -> Option<u64> {
    let at = usize::try_from(at).ok()?;
    let slice = bytes.get(at..at.checked_add(8)?)?;
    Some(u64::from_le_bytes(slice.try_into().ok()?))
}

impl Ogawa {
    /// Ouvre le fichier et lit son entête. La source n'est jamais modifiée.
    pub(super) fn open(path: &Path) -> Result<Ogawa> {
        let file = File::open(path)?;
        // SÛRETÉ : projection en lecture seule d'un fichier que le compilateur n'écrit jamais, comme
        // pour toute autre source ; les lectures qui suivent sont bornées par `map.len()`.
        let map = unsafe { memmap2::MmapOptions::new().map(&file)? };
        let name = path.display();
        if map.starts_with(HDF5_MAGIC) {
            return Err(CompilerError::new(
                HDF5_UNSUPPORTED,
                format!("{name}: this Alembic file uses the HDF5 container, which this build does not read; re-export it as Ogawa"),
            ));
        }
        if !map.starts_with(MAGIC) {
            return Err(invalid(format!("{name}: no Ogawa header")));
        }
        let version = match map.get(6..8) {
            Some(&[low, high]) => u16::from_le_bytes([low, high]),
            _ => return Err(invalid(format!("{name}: header is truncated"))),
        };
        let root_at =
            read_u64(&map, 8).ok_or_else(|| invalid(format!("{name}: header is truncated")))?;
        let mut archive = Ogawa {
            map,
            version,
            root: Vec::new(),
        };
        archive.root = archive.read_group(root_at)?;
        Ok(archive)
    }

    /// Les enfants du groupe à cette adresse. Un groupe vide se note par l'adresse zéro.
    fn read_group(&self, at: u64) -> Result<Vec<u64>> {
        let at = at & ADDRESS;
        if at == 0 {
            return Ok(Vec::new());
        }
        let count = read_u64(&self.map, at)
            .ok_or_else(|| invalid("a group pointer falls outside the file"))?;
        if count > MAX_CHILDREN {
            return Err(CompilerError::new(
                SIZE_UNSUPPORTED,
                format!(
                    "an Ogawa group declares {count} children, above the {MAX_CHILDREN} ceiling"
                ),
            ));
        }
        (0..count)
            .map(|index| {
                read_u64(&self.map, at + 8 + 8 * index)
                    .ok_or_else(|| invalid("a group is truncated by the end of the file"))
            })
            .collect()
    }

    /// Les enfants du groupe que ce pointeur désigne. Une donnée lue comme un groupe est un refus.
    pub(super) fn group(&self, child: u64) -> Result<Vec<u64>> {
        if is_data(child) {
            return Err(invalid(
                "a data block is referenced where a group is expected",
            ));
        }
        self.read_group(child)
    }

    /// Les octets du bloc de données que ce pointeur désigne, sans sa longueur.
    pub(super) fn data(&self, child: u64) -> Result<&[u8]> {
        if !is_data(child) {
            return Err(invalid(
                "a group is referenced where a data block is expected",
            ));
        }
        let at = child & ADDRESS;
        if at == 0 {
            return Ok(&[]);
        }
        let size = read_u64(&self.map, at)
            .ok_or_else(|| invalid("a data pointer falls outside the file"))?;
        if size > MAX_DATA_BYTES {
            return Err(CompilerError::new(
                SIZE_UNSUPPORTED,
                format!(
                    "an Ogawa data block declares {size} bytes, above the {MAX_DATA_BYTES} ceiling"
                ),
            ));
        }
        let start = usize::try_from(at + 8).map_err(|_| invalid("data address out of range"))?;
        let length = usize::try_from(size).map_err(|_| invalid("data length out of range"))?;
        self.map
            .get(start..start.saturating_add(length))
            .ok_or_else(|| invalid("a data block is truncated by the end of the file"))
    }

    /// La taille du fichier, publiée dans le rapport de provenance.
    pub(super) fn bytes(&self) -> usize {
        self.map.len()
    }
}
