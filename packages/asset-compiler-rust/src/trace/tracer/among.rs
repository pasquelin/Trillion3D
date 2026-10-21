//! The nearest-first trace over a set known to hold every triangle a ray can hit (`Among`): the
//! voxels', each against the triangles that overlap its voxel (`voxel::sample` lists the set).
use super::{normal_of, triangle_hit, Hit, World};
use trillion3d_math::vector::vecn::dot;

/// A set known to hold every triangle a ray can hit, `ranks`, ordered by `near` — per rank in the
/// `World`, a distance its hit cannot come nearer than, counted from `from` behind the ray's
/// origin —, and `tie`, how far apart across their surfaces two hits are one surface: the rounding
/// of the triangles' corners, so two faces drawn in one plane tie wherever the ray meets them.
#[derive(Clone, Copy)]
pub struct Among<'a> {
    pub ranks: &'a [u32],
    pub near: &'a [f64],
    pub from: f64,
    pub tie: f64,
}

impl Among<'_> {
    /// The nearest hit within `limit` over the hits `keep` accepts from their triangle and
    /// barycentric `(u, v)` — a masked leaf lets the ray through where its texel is cut —, two
    /// hits within `tie` of each other across their surfaces — their distance apart along the ray
    /// times the larger cosine of the ray to either's normal — tied to the lower rank: two faces
    /// in one plane bake as the one of lower rank, not as a speckle of both. The ranks are tested
    /// in order until one's `near` is past the best hit so far by more than a tie with it reaches:
    /// no triangle after it can come nearer, nor tie.
    pub fn nearest(
        self,
        world: &World,
        (origin, ray): ([f64; 3], [f64; 3]),
        limit: f64,
        keep: &dyn Fn(usize, [f64; 2]) -> bool,
    ) -> Hit {
        // The farthest a later triangle's hit may lie and still win: past it, the loop ends.
        let (mut best, mut facing, mut reach) = (Hit::none(limit), 0.0f64, f64::INFINITY);
        for &rank in self.ranks {
            let rank = rank as usize;
            if self.near[rank] - self.from > reach {
                break;
            }
            let Some((distance, barycentric)) = triangle_hit(world, rank, origin, ray, limit)
            else {
                continue;
            };
            // Its cosine only where it decides: a tie, or a win.
            let cosine_of = || dot(normal_of(world, rank), ray).abs();
            let behind = distance - best.distance;
            let (wins, cosine) = if !best.found {
                (true, None)
            } else if behind.abs() * facing > self.tie {
                (behind < 0.0, None)
            } else {
                let cosine = cosine_of();
                let apart = behind * cosine.max(facing);
                let tied = apart.abs() <= self.tie;
                (
                    if tied {
                        rank < best.triangle
                    } else {
                        apart < 0.0
                    },
                    Some(cosine),
                )
            };
            if wins && keep(rank, barycentric) {
                best = Hit {
                    distance,
                    triangle: rank,
                    found: true,
                    barycentric,
                };
                facing = cosine.unwrap_or_else(cosine_of);
                reach = distance + self.tie / facing;
            }
        }
        best
    }
}
