//! Le SDNA : la description que chaque fichier Blender porte de ses propres structures.
//!
//! Le bloc `DNA1` est l'auto-description publique du format. Il enchaîne quatre sections repérées
//! par une étiquette de quatre octets et alignées sur quatre : `NAME` les noms de champs,
//! `TYPE` les noms de types, `TLEN` la taille de chaque type, `STRC` les structures — pour chacune,
//! son type puis ses champs, donnés par un index de type et un index de nom.
//!
//! C'est de là que ce pilote tire tous ses décalages : **aucun décalage n'est écrit en dur**. Un
//! champ se demande par son nom, et une structure qui perd, gagne ou déplace un champ d'une version
//! de Blender à l'autre reste lisible tant que les noms utilisés ici existent.
use super::*;

mod read;

use read::{count, layout, strings, tag, word};

/// La taille d'un pointeur, celle des seuls fichiers que ce lecteur ouvre.
pub(super) const POINTER: usize = 8;

/// Un champ d'une structure : où il commence, ce qu'il porte, combien de fois.
pub(super) struct Field {
    pub(super) offset: usize,
    pub(super) kind: String,
    pub(super) unit: usize,
    pub(super) count: usize,
    pub(super) pointer: bool,
}

/// Une structure du fichier : son nom de type, sa taille et ses champs par nom.
pub(super) struct Layout {
    pub(super) name: String,
    pub(super) size: usize,
    pub(super) fields: HashMap<String, Field>,
}

/// Toutes les structures décrites par le fichier, et de quoi les retrouver par leur nom.
pub(super) struct Dna {
    pub(super) structs: Vec<Layout>,
    by_name: HashMap<String, usize>,
}

impl Dna {
    pub(super) fn read(bytes: &[u8]) -> Result<Dna> {
        let mut at = 0;
        tag(bytes, &mut at, b"SDNA")?;
        let names = strings(bytes, &mut at, b"NAME")?;
        let types = strings(bytes, &mut at, b"TYPE")?;
        tag(bytes, &mut at, b"TLEN")?;
        let mut lengths = Vec::with_capacity(types.len());
        for _ in 0..types.len() {
            lengths.push(u16::from_le_bytes(word(bytes, &mut at)?) as usize);
        }
        at = (at + 3) & !3;
        tag(bytes, &mut at, b"STRC")?;
        // Une structure pèse au moins son type et son nombre de champs : le compte est borné par ce
        // que le bloc porte encore, et rien n'est réservé avant de l'avoir cru.
        let total = count(bytes, &mut at, 4)?;
        let mut structs = Vec::with_capacity(total);
        for _ in 0..total {
            structs.push(layout(bytes, &mut at, &names, &types, &lengths)?);
        }
        let by_name = structs
            .iter()
            .enumerate()
            .map(|(rank, entry)| (entry.name.clone(), rank))
            .collect();
        Ok(Dna { structs, by_name })
    }
    /// Le rang d'une structure nommée, quand ce fichier la décrit.
    pub(super) fn index(&self, name: &str) -> Option<usize> {
        self.by_name.get(name).copied()
    }
    pub(super) fn layout(&self, kind: usize) -> Option<&Layout> {
        self.structs.get(kind)
    }
}

impl Layout {
    pub(super) fn field(&self, name: &str) -> Option<&Field> {
        self.fields.get(name)
    }
}
