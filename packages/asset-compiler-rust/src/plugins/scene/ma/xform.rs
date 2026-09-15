//! La matrice locale d'un `transform`, dans la convention de glTF : seize nombres par colonnes, un
//! point transformé par `M · p`.
//!
//! Maya compose la sienne à partir de la translation, des pivots et de la rotation dans l'ordre que
//! `rotateOrder` déclare. En colonnes, cela donne
//! `T · Tr(rpt) · Tr(rp) · R · Tr(−rp) · Tr(spt) · Tr(sp) · S · Tr(−sp)` : un pivot déplace ce
//! qu'il précède puis le remet en place, et une pose sans pivot retombe exactement sur `T · R · S`.
//! Le cisaillement n'est pas composé : glTF ne le porte pas dans une matrice de nœud sans le mêler
//! à la rotation, donc il est compté par son nom.
use super::*;
use crate::compiler_world::{multiply, rotation_matrix, scaling, translation, Mat4, IDENTITY};

/// Les six ordres d'application des rotations d'Euler que `rotateOrder` numérote, chacun donnant les
/// axes **dans l'ordre où ils s'appliquent au point**.
const ORDERS: [[usize; 3]; 6] = [
    [0, 1, 2],
    [1, 2, 0],
    [2, 0, 1],
    [0, 2, 1],
    [1, 0, 2],
    [2, 1, 0],
];

/// La matrice locale de ce nœud, ou `None` quand elle est l'identité.
pub(super) fn local(node: &Node, degrees_per_unit: f64, report: &mut Report) -> Option<Mat4> {
    if triple(node, &["sh", "shear"]).is_some_and(|shear| shear.iter().any(|part| *part != 0.0)) {
        report.add(report::SHEAR_UNSUPPORTED);
    }
    let rotate_pivot = triple(node, &["rp", "rotatePivot"]).unwrap_or_default();
    let scale_pivot = triple(node, &["sp", "scalePivot"]).unwrap_or_default();
    let mut out = translation(triple(node, &["t", "translate"]).unwrap_or_default());
    for step in [
        translation(triple(node, &["rpt", "rotatePivotTranslate"]).unwrap_or_default()),
        translation(rotate_pivot),
        rotation(node, degrees_per_unit),
        translation(rotate_pivot.map(std::ops::Neg::neg)),
        translation(triple(node, &["spt", "scalePivotTranslate"]).unwrap_or_default()),
        translation(scale_pivot),
        scaling(triple(node, &["s", "scale"]).unwrap_or([1.0; 3])),
        translation(scale_pivot.map(std::ops::Neg::neg)),
    ] {
        out = multiply(&out, &step);
    }
    if !out.iter().all(|value| value.is_finite()) {
        report.add(report::TRANSFORM_INVALID);
        return None;
    }
    (out != IDENTITY).then_some(out)
}

/// La rotation du nœud, composée dans l'ordre que `rotateOrder` déclare. Les axes s'appliquent au
/// point du premier au dernier, donc la matrice compose le dernier en premier.
fn rotation(node: &Node, degrees_per_unit: f64) -> Mat4 {
    let Some(angles) = triple(node, &["r", "rotate"]) else {
        return IDENTITY;
    };
    let order = node
        .attr(&["ro", "rotateOrder"])
        .and_then(Attr::scalar)
        .and_then(|rank| ORDERS.get(rank as usize))
        .copied()
        .unwrap_or(ORDERS[0]);
    let mut out = IDENTITY;
    for axis in order.into_iter().rev() {
        out = multiply(&out, &turn(axis, angles[axis] * degrees_per_unit));
    }
    out
}

/// La rotation de `degrees` autour de l'axe `axis` (0 = X, 1 = Y, 2 = Z), par son quaternion : la
/// formule de rotation du compilateur est déjà écrite, et une seconde s'en écarterait.
fn turn(axis: usize, degrees: f64) -> Mat4 {
    let half = degrees.to_radians() / 2.0;
    let mut quaternion = [0.0, 0.0, 0.0, half.cos()];
    quaternion[axis] = half.sin();
    rotation_matrix(quaternion)
}

/// Les trois nombres de l'un de ces attributs.
fn triple(node: &Node, names: &[&str]) -> Option<[f64; 3]> {
    node.attr(names).and_then(Attr::triple)
}

/// La matrice de la racine de la scène : l'unité du fichier vers le mètre. Maya écrit ses scènes
/// l'axe `Y` en haut, comme glTF : il n'y a donc aucune rotation à y ajouter.
pub(super) fn root(meters_per_unit: f64) -> Mat4 {
    scaling([meters_per_unit; 3])
}
