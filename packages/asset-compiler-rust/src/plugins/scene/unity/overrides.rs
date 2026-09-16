//! Ce qu'une instance de prefab remplace : les valeurs d'une transformation locale, et les
//! emplacements de matériau d'un rendu.
//!
//! Chaque retouche nomme la propriété qu'elle vise par son chemin sérialisé — `m_LocalPosition.x`,
//! `m_LocalRotation.w`, `m_LocalScale.y`, `m_Materials.Array.data[2]` — et ne remplace que
//! celle-là : les autres gardent ce que le prefab source déclare. C'est donc la transformation
//! source, retouche par retouche, qui entre dans la conversion d'axes, jamais une transformation
//! reconstruite de zéro.
use super::*;

/// Emplacements de matériau au plus dans un rendu. Un indice au-delà ne décrit aucun rendu que
/// l'éditeur ait pu écrire : il est compté sous ce nom, jamais réservé.
pub(super) const MAX_SLOTS: usize = 1 << 16;
pub(super) const SLOT_INVALID: &str = "unity-prefab-material-slot-invalid";

/// Ce qu'une instance de prefab remplace, par chemin de propriété.
pub(super) type Overrides = HashMap<String, f64>;

/// La transformation locale, telle que Unity l'écrit, une fois les surcharges d'instance appliquées
/// puis la conversion d'axes faite.
pub(super) fn local_trs(body: &Yaml, overrides: &Overrides) -> Trs {
    let at = |path: &str, value: f64| overrides.get(path).copied().unwrap_or(value);
    let position = vec3(&body["m_LocalPosition"], [0.0, 0.0, 0.0]);
    let rotation = vec4(
        &body["m_LocalRotation"],
        ["x", "y", "z", "w"],
        [0., 0., 0., 1.],
    );
    let scale = vec3(&body["m_LocalScale"], [1.0, 1.0, 1.0]);
    Trs::from_unity(
        [
            at("m_LocalPosition.x", position[0]),
            at("m_LocalPosition.y", position[1]),
            at("m_LocalPosition.z", position[2]),
        ],
        [
            at("m_LocalRotation.x", rotation[0]),
            at("m_LocalRotation.y", rotation[1]),
            at("m_LocalRotation.z", rotation[2]),
            at("m_LocalRotation.w", rotation[3]),
        ],
        [
            at("m_LocalScale.x", scale[0]),
            at("m_LocalScale.y", scale[1]),
            at("m_LocalScale.z", scale[2]),
        ],
    )
}

/// Allonge la suite d'emplacements jusqu'à `len`, les nouveaux emplacements non nommés.
pub(super) fn cover(slots: &mut Vec<Option<Ref>>, len: usize) {
    if slots.len() < len {
        slots.resize(len, None);
    }
}

/// `m_Materials.Array.data[2]` désigne le troisième emplacement de matériau du rendu.
pub(super) fn material_slot(path: &str) -> Option<usize> {
    path.strip_prefix("m_Materials.Array.data[")?
        .strip_suffix(']')?
        .parse::<usize>()
        .ok()
}
