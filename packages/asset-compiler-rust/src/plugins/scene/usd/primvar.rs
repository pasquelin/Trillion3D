//! Une primvar USD et la façon dont elle se lit à un coin de face.
//!
//! USD range une valeur par sommet, par coin, par face ou pour toute la surface, et peut en plus
//! indexer le tableau. Une primvar est donc toujours lue en deux temps : de quel rang du tableau ce
//! coin dépend, puis quelle valeur porte ce rang. C'est ce premier rang qui sert de clé de
//! déduplication des sommets du glTF — deux coins qui citent le même rang partagent un sommet.
use super::*;

/// Comment une primvar se répartit sur la surface.
#[derive(Clone, Copy, PartialEq)]
pub(super) enum Spread {
    /// Une seule valeur pour toute la surface.
    Constant,
    /// Une valeur par face.
    Uniform,
    /// Une valeur par point, citée par l'indice de sommet de la face.
    Point,
    /// Une valeur par coin de face.
    FaceVarying,
}

impl Spread {
    /// La répartition que la couche déclare, ou celle que la longueur du tableau désigne quand elle
    /// ne la déclare pas : une primvar aussi longue que les points suit les points, aussi longue que
    /// les coins suit les coins. C'est ce que fait un lecteur qui refuse de deviner au hasard.
    pub(super) fn read(
        declared: Option<&str>,
        values: usize,
        points: usize,
        corners: usize,
    ) -> Self {
        match declared {
            Some("constant") => Self::Constant,
            Some("uniform") => Self::Uniform,
            Some("vertex" | "varying") => Self::Point,
            Some("faceVarying") => Self::FaceVarying,
            _ if values == points => Self::Point,
            _ if values == corners => Self::FaceVarying,
            _ if values <= 1 => Self::Constant,
            _ => Self::FaceVarying,
        }
    }
}

/// Une primvar lue : ses valeurs, ses indices quand elle en a, et sa répartition.
pub(super) struct Primvar<T> {
    values: Vec<T>,
    indices: Option<Vec<i64>>,
    spread: Spread,
}

impl<T: Copy> Primvar<T> {
    pub(super) fn new(values: Vec<T>, indices: Option<Vec<i64>>, spread: Spread) -> Self {
        Self {
            values,
            indices,
            spread,
        }
    }
    /// Le rang du tableau dont ce coin dépend. `corner` est le rang du coin dans toute la surface,
    /// `face` celui de sa face, `point` l'indice de point que la face cite à ce coin. Un rang qui
    /// sort du tableau d'indices, ou un indice négatif, ne désigne rien : `None`, jamais le rang
    /// zéro, qui donnerait à ce coin la valeur d'un autre.
    pub(super) fn slot(&self, corner: usize, face: usize, point: usize) -> Option<u32> {
        let raw = match self.spread {
            Spread::Constant => 0,
            Spread::Uniform => face,
            Spread::Point => point,
            Spread::FaceVarying => corner,
        };
        let Some(indices) = &self.indices else {
            return u32::try_from(raw).ok();
        };
        u32::try_from(*indices.get(raw)?).ok()
    }
    /// La valeur d'un rang, ou `None` quand le tableau est plus court que ce que les indices disent.
    pub(super) fn get(&self, slot: u32) -> Option<T> {
        self.values.get(slot as usize).copied()
    }
}

/// Lit une primvar d'un prim : sa valeur, ses indices `<nom>:indices`, sa répartition déclarée.
/// Rend aussi `true` quand l'une des deux valeurs vient d'un échantillon temporel.
pub(super) fn read<T: Copy>(
    prim: &usd::Prim,
    name: &str,
    decode: impl Fn(&sdf::Value) -> Option<Vec<T>>,
    points: usize,
    corners: usize,
) -> Option<(Primvar<T>, bool)> {
    let attribute = prim.attribute(name);
    let (value, mut sampled) = read::first(&attribute)?;
    let values = decode(&value)?;
    let indices = match read::first(&prim.attribute(format!("{name}:indices"))) {
        Some((value, from_sample)) => {
            sampled |= from_sample;
            read::integers(&value)
        }
        None => None,
    };
    let declared = read::metadata(&attribute, "interpolation");
    let spread = Spread::read(declared.as_deref(), values.len(), points, corners);
    Some((Primvar::new(values, indices, spread), sampled))
}
