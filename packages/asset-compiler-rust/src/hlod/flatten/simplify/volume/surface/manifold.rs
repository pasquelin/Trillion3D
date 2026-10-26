//! Whether a block of cells could hide more than one sheet of surface, judged from the field at
//! the block's corners, the middles of its edges, the centres of its faces and its own centre: the
//! test that keeps a block from merging into one region.
use super::super::tree::{shift, Coord, Tree};
use super::cases::COLLAPSIBLE;
use super::cell::{sign_bits, CELL_EDGES};
use crate::hlod::flatten::approximate::marching::CELL_CORNERS;

/// A block's six faces by their corners, in the order they are tested: its lowest `z`, highest
/// `x`, highest `z`, lowest `x`, lowest `y` and highest `y`.
const CELL_FACES: [[usize; 4]; 6] = [
    [0, 1, 4, 5],
    [1, 2, 5, 6],
    [2, 3, 6, 7],
    [0, 3, 4, 7],
    [0, 1, 2, 3],
    [4, 5, 6, 7],
];

/// All eight corners, for the test at the block's centre.
const EVERY_CORNER: [usize; 8] = [0, 1, 2, 3, 4, 5, 6, 7];

/// Whether the block of `span` cells a side whose lowest voxel is `c` is tangled: its corners'
/// sign configuration is not one a merged block may show (`cases::COLLAPSIBLE`), or a sample
/// between corners — each edge's middle in edge order, each face's centre, the centre — lies on
/// the other side of `level` from every corner it lies between, so a sheet the corners do not
/// show passes there.
pub(super) fn tangled(field: &Tree<f32>, c: Coord, level: f32, span: i32) -> bool {
    let at = |d: Coord| field.get(shift(c, d));
    let signs = sign_bits(CELL_CORNERS.map(|k| at(k.map(|x| x * span))), level);
    if COLLAPSIBLE[usize::from(signs)] == 0 {
        return true;
    }
    let inside = |k: usize| signs >> k & 1 == 1;
    // The sample among `corners` sits at their mean, whole voxels since the span is even.
    let alone = |corners: &[usize]| {
        let count = corners.len() as i32;
        let mean = [0, 1, 2]
            .map(|axis| corners.iter().map(|&k| CELL_CORNERS[k][axis]).sum::<i32>() * span / count);
        let sample = at(mean) < level;
        corners.iter().all(|&k| inside(k) != sample)
    };
    CELL_EDGES.iter().any(|&[a, b, _]| alone(&[a, b]))
        || CELL_FACES.iter().any(|face| alone(face.as_slice()))
        || alone(EVERY_CORNER.as_slice())
}
