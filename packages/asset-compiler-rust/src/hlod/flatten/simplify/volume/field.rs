//! The narrow-band signed distance field of a set of triangles and quads, and the union of two
//! fields. The field is OpenVDB's conversion of a mesh to a level set, run with a band of two
//! voxels on each side of the surface, the grid of each voxel's closest polygon kept, no interior
//! test and none of its flags, step for step:
//!
//! 1. every polygon voxelized (`voxelize`): each triangle — a quad as two, `(a, b, c)` then
//!    `(a, d, c)`, a triangle two leaves wide or more split in four while the polygons are fewer
//!    than a thousand — floods the voxels about it from its first corner's through their 26
//!    neighbours, and writes each voxel's squared distance to it, in voxels², where it is the
//!    least so far; the shares of the work merged by least distance, then least polygon;
//! 2. the outside traced (`sweep`, `spread`): the voxels reached from the ends of each line of
//!    leaves before the surface, then those joined to them inside a leaf or across its faces,
//!    made negative;
//! 3. the voxels the surface crosses signed by their neighbours' closest points (`sign`), those
//!    with no outside neighbour pushed past the surface and the voxels with no neighbour near it
//!    made inactive (`crossing`), the inactive leaves and nodes dropped (`collapse_tiles`);
//! 4. no active voxel left: an empty field, its background the band's width;
//! 5. the squared distances made world distances, negative inside (`values`), the background set
//!    to the band's width and the signs filled into the inactive voxels and the tiles (`fill`);
//! 6. the distances relaxed by one step of the eikonal equation, its gradient by Godunov's upwind
//!    scheme, never above their former value (`values`);
//! 7. the active voxels past the band made inactive at its width, and every inactive child
//!    turned into a tile of the band's width, signed as its first value (`prune_level_set`).
//!
//! Since the band is two voxels on each side, OpenVDB's widening of a band wider than that never
//! runs here, nor is ported; the trimming of step 7 always does. The voxel is positive.
//!
//! `union` is OpenVDB's union of two level sets, top-down, with its pruning: the second tree's
//! nodes and tiles taken where they lie inside, or where the first holds an outside tile, the
//! leaves both hold merged voxel by voxel to the lesser value (`unite`).
//!
//! The point of a triangle closest to a point (`closest`) is the one function ported from its
//! documentation rather than its source — Ericson, Real-Time Collision Detection, pp. 136–142,
//! with OpenVDB's handling of degenerate triangles as documented —, the library shipping it only
//! as a binary.
//!
//! A step runs its leaves in parallel only where no leaf reads a value another leaf changes in
//! the same step, or where the change cannot alter what it reads: the field is the same however
//! the threads share the work.
use super::tree::{Coord, Tree};
use crate::plugins::scene::cancel::check;
use std::sync::atomic::AtomicBool;
use trillion3d_math::scalar::not_above;

mod closest;
mod collapse_tiles;
mod crossing;
mod fill;
mod links;
mod sign;
mod spread;
mod sweep;
mod unite;
mod values;
mod voxelize;

/// The polygons a field is made of: triangles and quads, each corner in index space.
pub(crate) trait Polygons: Sync {
    /// How many polygons there are.
    fn count(&self) -> usize;
    /// 3 or 4.
    fn corners(&self, polygon: usize) -> usize;
    /// Corner `corner` of `polygon`, in index space (world over the voxel).
    fn point(&self, polygon: usize, corner: usize) -> [f64; 3];
}

/// The polygon index of a voxel no polygon reaches.
pub(crate) const NO_POLYGON: i32 = -1;

/// A signed distance field: world-unit distances, negative inside, and each active voxel's
/// closest polygon.
pub(crate) struct Field {
    /// The signed distances, in world units: active in the band, the band's width (signed) in
    /// every inactive voxel and tile, the band's width as background.
    pub distance: Tree<f32>,
    /// Each active voxel's closest polygon, `NO_POLYGON` as background.
    pub closest: Tree<i32>,
}

/// A voxel's 26 neighbours: the six across its faces, the twelve across its edges, then the
/// eight across its corners, in OpenVDB's order.
const NEIGHBOURS: [Coord; 26] = [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1],
    [1, 0, -1],
    [-1, 0, -1],
    [1, 0, 1],
    [-1, 0, 1],
    [1, 1, 0],
    [-1, 1, 0],
    [1, -1, 0],
    [-1, -1, 0],
    [0, -1, 1],
    [0, -1, -1],
    [0, 1, 1],
    [0, 1, -1],
    [-1, -1, -1],
    [-1, -1, 1],
    [1, -1, 1],
    [1, -1, -1],
    [-1, 1, -1],
    [-1, 1, 1],
    [1, 1, 1],
    [1, 1, -1],
];

/// The squared distance, in voxels², up to which a voxel meets the surface: a flood goes on
/// through it, a sweep stops at it, and its sign is the one the surface's sides decide.
const BOUNDARY: f32 = 0.75;

/// The single-precision margin a value is moved by: past `BOUNDARY` for a crossing voxel with no
/// outside neighbour, short of the relaxation's offset when it is taken back.
const MARGIN: f32 = 1e-7;

/// The narrow-band signed distance field of `polygons` on a grid of `voxel` world units, by the
/// steps above: two voxels of band on each side of the surface. A voxel whose single precision
/// is not finite, or zero, gives an empty field of background `f32::MAX`.
pub(crate) fn field(
    polygons: &impl Polygons,
    voxel: f64,
    cancelled: &AtomicBool,
) -> crate::Result<Field> {
    let size = voxel as f32;
    if !size.is_finite() || size == 0.0 {
        return Ok(Field {
            distance: Tree::new(f32::MAX),
            closest: Tree::new(NO_POLYGON),
        });
    }
    let width = 2.0 * size;
    let (mut distance, mut closest) = voxelize::voxelize(polygons);
    check(cancelled)?;
    sweep::outside(&mut distance);
    sign::cross(&mut distance, &closest, polygons);
    check(cancelled)?;
    crossing::settle(&mut distance);
    crossing::drop_lonely(&mut distance, &mut closest);
    collapse_tiles::drop_inactive(&mut distance);
    collapse_tiles::drop_inactive(&mut closest);
    check(cancelled)?;
    if distance.leaves().all(|leaf| leaf.inactive()) {
        return Ok(Field {
            distance: Tree::new(width),
            closest,
        });
    }
    values::world_distances(&mut distance, size);
    distance.background = width;
    fill::fill_signs(&mut distance, width, -width);
    check(cancelled)?;
    values::relax(&mut distance, size);
    values::trim(&mut distance, width, width);
    prune_level_set(&mut distance, width, -width);
    Ok(Field { distance, closest })
}

/// Every inactive child replaced by a tile, `outside` or `inside` by the sign of its first value:
/// each lower node's leaves, then each upper node's lower nodes, then the root's upper nodes; the
/// root's tiles of the tree's background then erased.
pub(crate) fn prune_level_set(tree: &mut Tree<f32>, outside: f32, inside: f32) {
    collapse_tiles::inactive_children(tree, |first| if first < 0.0 { inside } else { outside });
    collapse_tiles::drop_background_tiles(tree);
}

/// `a` made the union of `a` and `b`, pruned, `b` consumed: the root's tiles
/// and children first, then — where the root's step met a child in both — each upper node, each
/// lower node and each leaf the two trees share, then the result pruned to tiles of `a`'s
/// background, signed.
pub(crate) fn union(a: &mut Tree<f32>, mut b: Tree<f32>) {
    if unite::roots(a, &mut b) {
        unite::below(a, &mut b);
    }
    let background = a.background;
    prune_level_set(a, background, -background);
}

/// Whether two single-precision values are equal within `10⁻⁸`, NaN included: what tells a tile
/// of a background, or of its negative, from another.
fn near(a: f32, b: f32) -> bool {
    not_above((a - b).abs(), 1e-8)
}
