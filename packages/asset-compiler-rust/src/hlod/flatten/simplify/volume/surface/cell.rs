//! A cell of the field — the cube from a voxel to its seven neighbours towards `+x`, `+y`, `+z`
//! — read at its corners: the values there and which of them lie inside, an ambiguous face settled
//! with the neighbour across it, the field's gradient at a voxel, and the point where a sheet of
//! surface crosses the cell.
use super::super::tree::{local, offset, shift, Coord, Leaf, Tree, LEAF_SIDE};
use super::cases::SADDLE_FACE;
use super::sheets::SHEETS;
use crate::hlod::flatten::approximate::marching::CELL_CORNERS;
use trillion3d_math::vector::vec3::unit_where;
use trillion3d_math::vector::vecn::{add, scale};

/// A cell's twelve edges in the tables' order, each its two corners — the lower first along the
/// axis it runs — and that axis.
pub(super) const CELL_EDGES: [[usize; 3]; 12] = [
    [0, 1, 0],
    [1, 2, 2],
    [3, 2, 0],
    [0, 3, 2],
    [4, 5, 0],
    [5, 6, 2],
    [7, 6, 0],
    [4, 7, 2],
    [0, 4, 1],
    [1, 5, 1],
    [2, 6, 1],
    [3, 7, 1],
];

/// Per axis, the other three cells around a voxel's edge towards `+` along it, as steps from the
/// voxel, in the order the edge's quad walks them.
pub(super) const AROUND: [[Coord; 3]; 3] = [
    [[0, -1, 0], [0, -1, -1], [0, 0, -1]],
    [[0, 0, -1], [-1, 0, -1], [-1, 0, 0]],
    [[0, -1, 0], [-1, -1, 0], [-1, 0, 0]],
];

/// The ranks of a cell's corners from its voxel's own, when the cell lies within one leaf.
const CORNER_STEPS: [usize; 8] = [0, 64, 65, 1, 8, 72, 73, 9];

/// Per ambiguous face (`cases::SADDLE_FACE`, from `1`), the step to the neighbour sharing it and
/// the number that neighbour gives the same face.
const ACROSS: [(Coord, u8); 6] = [
    ([0, 0, -1], 3),
    ([1, 0, 0], 4),
    ([0, 0, 1], 1),
    ([-1, 0, 0], 2),
    ([0, -1, 0], 6),
    ([0, 1, 0], 5),
];

/// The field's values at the corners of the cell at `c`, in corner order: from `leaf` — the
/// field's leaf holding `c`, if any — when the whole cell lies in it, else read through the tree,
/// tiles and background past the leaves. Both read the same values; the leaf only spares the
/// walks.
pub(super) fn corner_values(field: &Tree<f32>, leaf: Option<&Leaf<f32>>, c: Coord) -> [f32; 8] {
    let pos = offset(c);
    match leaf {
        Some(leaf) if local(pos).iter().all(|&x| x < LEAF_SIDE - 1) => {
            CORNER_STEPS.map(|s| leaf.values[pos + s])
        }
        _ => CELL_CORNERS.map(|d| field.get(shift(c, d))),
    }
}

/// The cell's sign configuration: bit `k` set when corner `k`'s value lies below `level`, inside.
pub(super) fn sign_bits(values: [f32; 8], level: f32) -> u8 {
    (0..8).fold(0, |bits, k| bits | (u8::from(values[k] < level) << k))
}

/// The sign configuration `signs` of the cell at `c`, settled across its ambiguous face: every sign
/// flipped when the neighbour sharing that face finds the same face ambiguous, so that the two
/// cells join their sheets through it the same way.
pub(super) fn disambiguate(signs: u8, field: &Tree<f32>, c: Coord, level: f32) -> u8 {
    let face = SADDLE_FACE[usize::from(signs)];
    if face == 0 {
        return signs;
    }
    let (d, seen) = ACROSS[usize::from(face) - 1];
    let theirs = sign_bits(corner_values(field, None, shift(c, d)), level);
    match SADDLE_FACE[usize::from(theirs)] == seen {
        true => !signs,
        false => signs,
    }
}

/// The field's gradient at the voxel `c` by central differences, in single precision: per axis
/// half the difference of the two neighbours along it.
pub(super) fn gradient(field: &Tree<f32>, c: Coord) -> [f32; 3] {
    [0, 1, 2].map(|axis| {
        let (mut up, mut down) = (c, c);
        up[axis] += 1;
        down[axis] -= 1;
        (field.get(up) - field.get(down)) * 0.5
    })
}

/// `v` times the reciprocal of its length when that length passes `10⁻⁷`, else `v` itself: a
/// normalization that leaves a shorter vector, or one of NaN length, as it is.
pub(super) fn direction(v: [f32; 3]) -> [f32; 3] {
    unit_where(v, |length| length > 1.0e-7).unwrap_or(v)
}

/// The point of sheet `sheet` (from `1`) in a cell of sign configuration `signs` and corner
/// `values`, in the cell's own coordinates: the mean, in edge order, of the points where the
/// sheet's edges cross `level` by linear interpolation. An edge's point is its lower corner with
/// the crossing put on its axis; the sums start at `+0` and so never reach `−0`, and adding the
/// zero of an axis an edge does not run along changes nothing.
pub(super) fn sheet_point(values: [f64; 8], signs: u8, sheet: u8, level: f64) -> [f64; 3] {
    let row = &SHEETS[usize::from(signs)];
    let mut sum = [0.0; 3];
    let mut samples = 0u32;
    for (&[a, b, axis], &crossed) in CELL_EDGES.iter().zip(&row[1..]) {
        if crossed != sheet {
            continue;
        }
        let mut at = CELL_CORNERS[a].map(f64::from);
        at[axis] = (level - values[a]) / (values[b] - values[a]);
        sum = add(sum, at);
        samples += 1;
    }
    match samples > 1 {
        true => scale(sum, 1.0 / f64::from(samples)),
        false => sum,
    }
}
