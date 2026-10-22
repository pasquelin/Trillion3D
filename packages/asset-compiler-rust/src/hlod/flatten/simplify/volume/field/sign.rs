//! The sign of the voxels the surface crosses (step 3 of `field`): an active voxel within
//! `BOUNDARY`, not yet negative, is made negative — outside — when it lies on the side of a
//! neighbour outside past `BOUNDARY` (below `−BOUNDARY`), seen from that neighbour's closest
//! point: the unit direction from the point to the voxel and the one from the point to the
//! neighbour make an acute angle. The neighbours of its leaf within one voxel are tried first,
//! `x`, then `y`, then `z` rising, their points kept for the rest of the leaf; then, if none
//! decides, its 26 neighbours outside that box, active ones only, in `NEIGHBOURS` order. A unit
//! direction is the vector times the reciprocal of its length, or the vector itself for a length
//! of `10⁻⁷` or less.
//!
//! A voxel this makes negative stays within `BOUNDARY` of zero, so it never passes for a
//! neighbour below `−BOUNDARY`: each leaf's voxels are decided from the field as it was, in
//! parallel, then turned.
use super::super::tree::{offset, shift, Coord, Leaf, Tree, LEAF_SIDE, LEAF_SIZE};
use super::closest::on_polygon;
use super::{Polygons, BOUNDARY, NEIGHBOURS, NO_POLYGON};
use rayon::prelude::*;
use trillion3d_math::scalar::not_below;
use trillion3d_math::vector::vec3::unit_where;
use trillion3d_math::vector::vecn::{dot, sub};

type V3 = [f64; 3];

/// A neighbour's closest point and the unit direction from it to the neighbour, once computed.
type Seen = Option<(V3, V3)>;

/// What the sign of a crossing voxel reads: the squared distances, their closest polygons and
/// the polygons.
struct Reads<'a, P> {
    field: &'a Tree<f32>,
    closest: &'a Tree<i32>,
    polygons: &'a P,
}

/// The crossing voxels of `distance` on the outside made negative.
pub(super) fn cross<P: Polygons>(distance: &mut Tree<f32>, closest: &Tree<i32>, polygons: &P) {
    let turned: Vec<Vec<usize>> = {
        let reads = Reads {
            field: &*distance,
            closest,
            polygons,
        };
        let leaves: Vec<&Leaf<f32>> = reads.field.leaves().collect();
        leaves
            .par_iter()
            .map_init(
                || vec![Seen::None; LEAF_SIZE],
                |seen, leaf| reads.turned(leaf, seen),
            )
            .collect()
    };
    for (leaf, turned) in distance.leaves_mut().into_iter().zip(turned) {
        for pos in turned {
            leaf.values[pos] = -leaf.values[pos];
        }
    }
}

impl<P: Polygons> Reads<'_, P> {
    /// The ranks of `leaf`'s voxels to make negative, `seen` holding its neighbours' points.
    fn turned(&self, leaf: &Leaf<f32>, seen: &mut [Seen]) -> Vec<usize> {
        let Some(indices) = self.closest.leaf(leaf.origin) else {
            return Vec::new();
        };
        seen.fill(None);
        leaf.active()
            .filter(|&pos| {
                let value = leaf.values[pos];
                !(value < 0.0 || value > BOUNDARY) && self.beyond(leaf, indices, pos, seen)
            })
            .collect()
    }

    /// Whether voxel `pos` of `leaf` lies on an outside neighbour's side of its closest point:
    /// the neighbours in its leaf within one voxel (`indices` their polygons), then the others.
    fn beyond(&self, leaf: &Leaf<f32>, indices: &Leaf<i32>, pos: usize, seen: &mut [Seen]) -> bool {
        let voxel = leaf.coord(pos);
        let centre = voxel.map(f64::from);
        let low: Coord = [0, 1, 2].map(|k| (voxel[k] - 1).max(leaf.origin[k]));
        let high: Coord = [0, 1, 2].map(|k| (voxel[k] + 1).min(leaf.origin[k] + LEAF_SIDE - 1));
        for x in low[0]..=high[0] {
            for y in low[1]..=high[1] {
                for z in low[2]..=high[2] {
                    let near = offset([x, y, z]);
                    let polygon = indices.values[near];
                    if polygon == NO_POLYGON || not_below(leaf.values[near], -BOUNDARY) {
                        continue;
                    }
                    let (point, away) =
                        *seen[near].get_or_insert_with(|| self.point_of([x, y, z], polygon));
                    if dot(away, direction(sub(centre, point))) > 0.0 {
                        return true;
                    }
                }
            }
        }
        NEIGHBOURS.iter().any(|&step| {
            let other = shift(voxel, step);
            let boxed = (0..3).all(|k| (low[k]..=high[k]).contains(&other[k]));
            let (value, active) = self.field.probe(other);
            if boxed || !active || not_below(value, -BOUNDARY) {
                return false;
            }
            let (point, away) = self.point_of(other, self.closest.get(other));
            dot(away, direction(sub(centre, point))) > 0.0
        })
    }

    /// The point of polygon `polygon` closest to voxel `at`, and the unit direction from it to
    /// the voxel.
    fn point_of(&self, at: Coord, polygon: i32) -> (V3, V3) {
        let centre = at.map(f64::from);
        let point = on_polygon(self.polygons, polygon as usize, centre);
        (point, direction(sub(centre, point)))
    }
}

/// `v` times the reciprocal of its length, or `v` itself for a length of `10⁻⁷` or less, or NaN.
fn direction(v: V3) -> V3 {
    unit_where(v, |length| length > 1e-7).unwrap_or(v)
}
