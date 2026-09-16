//! Les matrices 4 × 4 de ce pilote, dans la convention de glTF : seize nombres **par colonnes**, un
//! point transformé par `M · p`. USD écrit les siennes par lignes et transforme par `p · M`, ce qui
//! est la même matrice transposée deux fois : les seize nombres d'un `matrix4d` USD se recopient
//! donc tels quels, et la composition d'une liste d'opérations se fait de gauche à droite.

/// L'identité, la composition, la translation, l'échelle et la rotation d'un quaternion sont celles
/// que le compilateur applique déjà aux nœuds glTF : les reprendre ici les ferait diverger pour rien.
pub(super) use crate::compiler_world::{
    multiply as mul, rotation_matrix, scaling, translation, Mat4, IDENTITY,
};

/// L'échelle uniforme équivalente d'une matrice, celle qui porte une longueur locale vers le monde.
pub(super) use crate::shared_math::uniform_scale;

/// La rotation de `degrees` autour de l'axe `axis` (0 = X, 1 = Y, 2 = Z).
pub(super) fn rotation(axis: usize, degrees: f64) -> Mat4 {
    let (sin, cos) = degrees.to_radians().sin_cos();
    let (u, v) = ((axis + 1) % 3, (axis + 2) % 3);
    let mut out = IDENTITY;
    out[u * 4 + u] = cos;
    out[u * 4 + v] = sin;
    out[v * 4 + u] = -sin;
    out[v * 4 + v] = cos;
    out
}

/// La rotation d'un quaternion unitaire `(w, x, y, z)`, tel que USD l'écrit.
pub(super) fn orientation(q: [f64; 4]) -> Mat4 {
    let length = (q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]).sqrt();
    if length <= f64::EPSILON {
        return IDENTITY;
    }
    let [w, x, y, z] = q.map(|part| part / length);
    rotation_matrix([x, y, z, w])
}

/// La matrice de la racine de la scène : l'unité de la couche vers le mètre, puis l'axe haut de la
/// couche vers celui de glTF, qui est toujours `Y`. Une couche en `Z` haut tourne de −90° autour de
/// `X`, ce qui envoie `(x, y, z)` sur `(x, z, −y)` ; une couche en `Y` haut ne tourne pas.
pub(super) fn root(meters_per_unit: f64, z_up: bool) -> Mat4 {
    let scale = scaling([meters_per_unit; 3]);
    if !z_up {
        return scale;
    }
    mul(&scale, &rotation(0, -90.0))
}
