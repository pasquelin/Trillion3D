//! Local matrix of a `transform`, in glTF's convention: sixteen numbers column-major, a point
//! transformed by `M · p`.
//!
//! Maya documents its own in the order a point walks it, row-vector on the left:
//! `SP⁻¹ · S · SH · SP · ST · RP⁻¹ · RA · R · RP · RT · T`, then the offset parent matrix
//! `offsetParentMatrix`. Transposed for a column vector, it reads left to right
//! `OPM · T · RT · RP · R · RA · RP⁻¹ · ST · SP · SH · S · SP⁻¹`: each pivot moves what
//! precedes it then puts it back, `rotateAxis` orients the local axis **before** the rotation,
//! and a pose with no pivot or shear falls exactly on `T · R · S`.
//!
//! Maya writes each of these vectors as a block — `.t` — or component by component — `.tx` —,
//! often both in the same file: both writings are read, the component winning.
use super::*;
use crate::compiler_world::{multiply, rotation_matrix, scaling, translation, Mat4, IDENTITY};

/// The six Euler rotation application orders that `rotateOrder` numbers, each giving the axes
/// **in the order they apply to the point**.
const ORDERS: [[usize; 3]; 6] = [
    [0, 1, 2],
    [1, 2, 0],
    [2, 0, 1],
    [0, 2, 1],
    [1, 0, 2],
    [2, 1, 0],
];

/// Suffixes of the components of an axis vector, `.tx` for `.t`.
const AXES: [&str; 3] = ["x", "y", "z"];
/// Those of a shear, which names planes not axes: `.shxy` for `.sh`.
const PLANES: [&str; 3] = ["xy", "xz", "yz"];

/// Local matrix of this node, or `None` when it is identity.
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

/// Does this node inherit its parent's pose? `inheritsTransform` at zero cuts inheritance: the
/// node sits in the scene frame, and its parent's pose does not follow it.
pub(super) fn inherits(node: &Node) -> bool {
    node.attr(&["it", "inheritsTransform"]).and_then(Attr::flag) != Some(false)
}

/// Rotation application order that `rotateOrder` declares, `xyz` by default.
fn order(node: &Node) -> [usize; 3] {
    node.attr(&["ro", "rotateOrder"])
        .and_then(Attr::scalar)
        .and_then(|rank| ORDERS.get(rank as usize))
        .copied()
        .unwrap_or(ORDERS[0])
}

/// An Euler rotation of the node, composed in the given order. Axes apply to the point from
/// first to last, so the matrix composes the last first.
fn rotation(node: &Node, names: [&str; 2], order: [usize; 3], degrees_per_unit: f64) -> Mat4 {
    let angles = triple(node, names, AXES, [0.0; 3]);
    let mut out = IDENTITY;
    for axis in order.into_iter().rev() {
        out = multiply(&out, &turn(axis, angles[axis] * degrees_per_unit));
    }
    out
}

/// Rotation of `degrees` around axis `axis` (0 = X, 1 = Y, 2 = Z), by its quaternion: the
/// compiler's rotation formula is already written, and a second one would drift from it.
fn turn(axis: usize, degrees: f64) -> Mat4 {
    let half = degrees.to_radians() / 2.0;
    let mut quaternion = [0.0, 0.0, 0.0, half.cos()];
    quaternion[axis] = half.sin();
    rotation_matrix(quaternion)
}

/// Matrix of a Maya shear `(XY, XZ, YZ)`: axis `Y` leans toward `X`, axis `Z` toward `X` and
/// toward `Y`. A glTF node matrix carries it as-is, without mixing it into the rotation.
fn shear([xy, xz, yz]: [f64; 3]) -> Mat4 {
    let mut out = IDENTITY;
    out[4] = xy;
    out[8] = xz;
    out[9] = yz;
    out
}

/// Offset parent matrix, `offsetParentMatrix`, which applies after the local pose. Maya writes
/// its sixteen numbers row by row for a row-vector, which is exactly glTF's column-by-column
/// writing: the transpose of one is the other, and the numbers do not move. Written otherwise —
/// the long `xform` form — it is not guessed but counted.
fn offset(node: &Node, report: &mut Report) -> Mat4 {
    let Some(written) = node.attr(&["opm", "offsetParentMatrix"]) else {
        return IDENTITY;
    };
    Mat4::try_from(written.numbers()).unwrap_or_else(|_| {
        report.add(report::MATRIX_UNSUPPORTED);
        IDENTITY
    })
}

/// Three numbers of a node vector: the compound attribute when it is written, then each
/// component a `setAttr` wrote alone, which wins over it.
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

/// Scene-root matrix: the file's unit into metres. Maya writes its scenes with axis `Y` up, like
/// glTF: there is therefore no rotation to add.
pub(super) fn root(meters_per_unit: f64) -> Mat4 {
    scaling([meters_per_unit; 3])
}
