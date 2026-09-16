//! Les attributs nommés d'un maillage.
//!
//! Depuis Blender 5, un maillage ne porte plus ses tableaux dans des champs dédiés : il porte un
//! magasin d'attributs — un nom, un domaine (sommet, arête, face, coin), un type et des valeurs.
//! `position`, `.corner_vert`, `material_index`, `sharp_face` et les couches d'UV y vivent côte à
//! côte. Un attribut peut être **unique** — une seule valeur pour tout le domaine — plutôt qu'un
//! tableau ; le lecteur le dit, et l'appelant répète la valeur.
//!
//! Les identifiants de type et de domaine sont ceux que le format écrit ; ce lecteur les croise avec
//! le pas réel des valeurs, et laisse tomber l'attribut quand les deux ne s'accordent pas.
use super::*;

/// Types d'attribut retenus par ce pilote, avec le nombre d'octets que chacun occupe.
pub(super) const BOOLEAN: i64 = 0;
pub(super) const INT32: i64 = 3;
pub(super) const FLOAT2: i64 = 6;
pub(super) const FLOAT3: i64 = 7;
/// Domaines : sommet, arête, face, coin de face.
pub(super) const POINT: i64 = 0;
pub(super) const FACE: i64 = 2;
pub(super) const CORNER: i64 = 3;
/// Plafond du nombre d'attributs lus dans un maillage : au-delà, le magasin n'en est pas un.
const MAX_ATTRIBUTES: usize = 4096;

/// Un attribut du maillage, tel qu'il se lit.
pub(super) struct Attr<'a> {
    pub(super) domain: i64,
    pub(super) kind: i64,
    pub(super) values: &'a [u8],
    /// Le nombre d'éléments : un pour un attribut unique, que l'appelant répète.
    pub(super) count: usize,
    pub(super) single: bool,
}

impl Attr<'_> {
    /// Le nombre d'octets d'un élément de ce type, ou rien si ce pilote ne lit pas ce type.
    pub(super) fn width(kind: i64) -> Option<usize> {
        match kind {
            BOOLEAN => Some(1),
            INT32 => Some(4),
            FLOAT2 => Some(8),
            FLOAT3 => Some(12),
            _ => None,
        }
    }
    /// Les valeurs flottantes de l'attribut, répétées quand il est unique.
    pub(super) fn floats(&self, repeat: usize, stride: usize) -> Vec<f32> {
        if self.single {
            return bytes::floats(self.values, stride).repeat(repeat);
        }
        bytes::floats(self.values, self.count * stride)
    }
    /// Les entiers de l'attribut, répétés de la même façon.
    pub(super) fn ints(&self, repeat: usize) -> Vec<i32> {
        if !self.single {
            return bytes::ints(self.values, self.count);
        }
        vec![bytes::ints(self.values, 1).first().copied().unwrap_or(0); repeat]
    }
    /// Les booléens de l'attribut, un octet chacun.
    pub(super) fn bools(&self, repeat: usize) -> Vec<bool> {
        if self.single {
            return vec![self.values.first().is_some_and(|byte| *byte != 0); repeat];
        }
        self.values
            .iter()
            .take(self.count)
            .map(|byte| *byte != 0)
            .collect()
    }
}

/// Les attributs d'un maillage, par nom, dans l'ordre où le magasin les déclare. Un magasin absent
/// rend une table vide : c'est l'appelant qui décide que le maillage est alors illisible.
pub(super) fn attributes<'a>(mesh: &At<'a>) -> Vec<(String, Attr<'a>)> {
    let mut out = Vec::new();
    let Some(storage) = mesh.inner("attribute_storage") else {
        return out;
    };
    let announced = storage.int("dna_attributes_num", 0).max(0) as usize;
    let pointer = storage.pointer("dna_attributes");
    let Some(held) = mesh.file.at(pointer).map(|block| block.count) else {
        return out;
    };
    let Some(head) = storage.follow("dna_attributes") else {
        return out;
    };
    for rank in 0..announced.min(held).min(MAX_ATTRIBUTES) {
        let Some(entry) = head.item(rank) else {
            break;
        };
        let name = entry
            .file
            .text_at(entry.pointer("name"))
            .unwrap_or_default();
        let kind = entry.int("data_type", -1);
        let Some(width) = Attr::width(kind) else {
            continue;
        };
        let Some(data) = entry.follow("data") else {
            continue;
        };
        let single = data.layout.name == "AttributeSingle";
        let count = if single {
            1
        } else {
            data.int("size", 0).max(0) as usize
        };
        let Some(values) = data
            .block("data")
            .filter(|bytes| count.checked_mul(width).is_some_and(|span| bytes.len() >= span))
        else {
            continue;
        };
        out.push((
            name,
            Attr {
                domain: entry.int("domain", -1),
                kind,
                values,
                count,
                single,
            },
        ));
    }
    out
}
