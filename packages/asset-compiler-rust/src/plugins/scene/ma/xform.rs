//! La matrice locale d'un `transform`, dans la convention de glTF : seize nombres par colonnes, un
//! point transformé par `M · p`.
//!
//! Maya documente la sienne dans l'ordre où un point la traverse, vecteur-ligne à gauche :
//! `SP⁻¹ · S · SH · SP · ST · RP⁻¹ · RA · R · RP · RT · T`, puis la matrice du père décalé
//! `offsetParentMatrix`. Transposée pour un vecteur-colonne, elle se lit de gauche à droite
//! `OPM · T · RT · RP · R · RA · RP⁻¹ · ST · SP · SH · S · SP⁻¹` : chaque pivot déplace ce qu'il
//! précède puis le remet en place, `rotateAxis` oriente l'axe local **avant** la rotation, et une
//! pose sans pivot ni cisaillement retombe exactement sur `T · R · S`.
//!
//! Maya écrit chacun de ces vecteurs d'un bloc — `.t` — ou composante par composante — `.tx` —,
//! souvent les deux dans le même fichier : les deux écritures sont lues, la composante l'emportant.
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

/// Les suffixes des composantes d'un vecteur d'axes, `.tx` pour `.t`.
const AXES: [&str; 3] = ["x", "y", "z"];
/// Ceux d'un cisaillement, qui nomme des plans et non des axes : `.shxy` pour `.sh`.
const PLANES: [&str; 3] = ["xy", "xz", "yz"];

/// La matrice locale de ce nœud, ou `None` quand elle est l'identité.
pub(super) fn local(node: &Node, degrees_per_unit: f64, report: &mut Report) -> Option<Mat4> {
    let rotate_pivot = triple(node, ["rp", "rotatePivot"], AXES, [0.0; 3]);
    let scale_pivot = triple(node, ["sp", "scalePivot"], AXES, [0.0; 3]);
    let mut out = offset(node, report);
    for step in [
        translation(triple(node, ["t", "translate"], AXES, [0.0; 3])),
        translation(triple(
            node,
            ["rpt", "rotatePivotTranslate"],
            AXES,
            [0.0; 3],
        )),
        translation(rotate_pivot),
        rotation(node, ["r", "rotate"], order(node), degrees_per_unit),
        rotation(node, ["ra", "rotateAxis"], ORDERS[0], degrees_per_unit),
        translation(rotate_pivot.map(std::ops::Neg::neg)),
        translation(triple(node, ["spt", "scalePivotTranslate"], AXES, [0.0; 3])),
        translation(scale_pivot),
        shear(triple(node, ["sh", "shear"], PLANES, [0.0; 3])),
        scaling(triple(node, ["s", "scale"], AXES, [1.0; 3])),
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

/// Ce nœud hérite-t-il de la pose de son père ? `inheritsTransform` à zéro coupe l'héritage : le
/// nœud se pose dans le repère de la scène, et la pose de son père ne le suit pas.
pub(super) fn inherits(node: &Node) -> bool {
    node.attr(&["it", "inheritsTransform"]).and_then(Attr::flag) != Some(false)
}

/// L'ordre d'application des rotations que `rotateOrder` déclare, `xyz` par défaut.
fn order(node: &Node) -> [usize; 3] {
    node.attr(&["ro", "rotateOrder"])
        .and_then(Attr::scalar)
        .and_then(|rank| ORDERS.get(rank as usize))
        .copied()
        .unwrap_or(ORDERS[0])
}

/// Une rotation d'Euler du nœud, composée dans l'ordre donné. Les axes s'appliquent au point du
/// premier au dernier, donc la matrice compose le dernier en premier.
fn rotation(node: &Node, names: [&str; 2], order: [usize; 3], degrees_per_unit: f64) -> Mat4 {
    let angles = triple(node, names, AXES, [0.0; 3]);
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

/// La matrice d'un cisaillement `(XY, XZ, YZ)` de Maya : l'axe `Y` penche vers `X`, l'axe `Z` vers
/// `X` et vers `Y`. Une matrice de nœud glTF le porte tel quel, sans le mêler à la rotation.
fn shear([xy, xz, yz]: [f64; 3]) -> Mat4 {
    let mut out = IDENTITY;
    out[4] = xy;
    out[8] = xz;
    out[9] = yz;
    out
}

/// La matrice du père décalé, `offsetParentMatrix`, qui s'applique après la pose locale. Maya écrit
/// ses seize nombres ligne par ligne pour un vecteur-ligne, ce qui est exactement l'écriture
/// colonne par colonne de glTF : la transposée de l'une est l'autre, et les nombres ne bougent pas.
/// Écrite autrement — la forme longue `xform` —, elle n'est pas devinée mais comptée.
fn offset(node: &Node, report: &mut Report) -> Mat4 {
    let Some(written) = node.attr(&["opm", "offsetParentMatrix"]) else {
        return IDENTITY;
    };
    Mat4::try_from(written.numbers()).unwrap_or_else(|_| {
        report.add(report::MATRIX_UNSUPPORTED);
        IDENTITY
    })
}

/// Les trois nombres d'un vecteur du nœud : l'attribut composé quand il est écrit, puis chaque
/// composante qu'un `setAttr` a écrite seule, qui l'emporte sur lui.
fn triple(node: &Node, names: [&str; 2], parts: [&str; 3], default: [f64; 3]) -> [f64; 3] {
    let mut out = node.attr(&names).and_then(Attr::triple).unwrap_or(default);
    for (axis, part) in parts.iter().enumerate() {
        let short = format!("{}{part}", names[0]);
        let long = format!("{}{}", names[1], part.to_uppercase());
        if let Some(value) = node
            .attr(&[short.as_str(), long.as_str()])
            .and_then(Attr::scalar)
        {
            out[axis] = value;
        }
    }
    out
}

/// La matrice de la racine de la scène : l'unité du fichier vers le mètre. Maya écrit ses scènes
/// l'axe `Y` en haut, comme glTF : il n'y a donc aucune rotation à y ajouter.
pub(super) fn root(meters_per_unit: f64) -> Mat4 {
    scaling([meters_per_unit; 3])
}
