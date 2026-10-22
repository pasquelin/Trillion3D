//! Each texel of the fine grid paired with a point of the sources (`Rays::answer`), as the method
//! pairs them: from the point of the texel's triangle at its weights, along the normal its transfer
//! follows there — the triangle's corners' transfer normals blended and made unit past a squared
//! length of 1e-5, else the triangle's own normal —, a ray forward from a ten-thousandth behind the
//! point and one backward from a ten-thousandth before it, each as long as the transfer reaches,
//! through the tree over the sources (`kdop`). The nearer hit is kept (`HlodTransferRays::Nearest`,
//! the reverse one on a tie), or (`Facing`) the one whose source faces the ray's way — its corners'
//! normals summed, made unit, leaning along the forward ray —, the nearer of two such, the reverse
//! one when neither does; one hit alone is kept as it is.
//!
//! The point hit lies along the ray at the hit's fraction of the ray's length from its start, on
//! the source triangle itself, so a texel reads the source's textures where its ray met them. The
//! source triangle's weights there are those of the point projected on its plane
//! (`nearest::weights`).
use super::raster::Texel;
use crate::hlod::flatten::simplify::convert::clockwise_normal;
use crate::hlod::flatten::simplify::kdop::{Hit, Tree, Walk};
use crate::hlod::flatten::simplify::nearest::{blend, normalize, weights, SMALL};
use crate::hlod::flatten::simplify::proxy::Proxy;
use crate::hlod::flatten::simplify::sources::Sources;
use crate::hlod::options::HlodTransferRays;
use trillion3d_math::vector::vecn::{add, dot, scale, sub};

/// The squared length past which a blended transfer normal is made unit.
const UNIT: f32 = 1e-5;

/// How far behind and before the texel's point its rays start, centimetres.
const OFFSET: f64 = 0.0001;

/// What a texel of the fine grid pairs with: no triangle of the mesh (`Outside`), no source
/// (`Missed`), or a source triangle and its barycentric weights at the point hit.
#[derive(Clone, Copy)]
pub(super) enum Answer {
    Outside,
    Missed,
    Hit { source: u32, weights: [f64; 3] },
}

/// What the pairing reads: the simplified mesh and the normals its rays follow, the sources and the
/// tree over them, how far a ray reaches (centimetres) and which hit is kept.
pub(super) struct Rays<'a> {
    pub proxy: &'a Proxy,
    pub normals: &'a [[f32; 3]],
    pub sources: &'a Sources,
    pub tree: &'a Tree,
    pub reach: f32,
    pub rays: HlodTransferRays,
}

/// A ray: its start and its unit direction, single precision.
type Ray = ([f32; 3], [f32; 3]);

impl Rays<'_> {
    /// What texel `texel` pairs with (module doc), `walk` the tree's scratch.
    pub(super) fn answer(&self, texel: &Texel, walk: &mut Walk) -> Answer {
        if texel.triangle < 0 {
            return Answer::Outside;
        }
        let t = texel.triangle as usize;
        let corners = self.proxy.corners(t);
        let ends = [0, 1, 2].map(|k| self.proxy.indices[3 * t + k] as usize);
        let origin = blend(texel.weights, corners);
        let mut direction = blend(texel.weights, ends.map(|v| self.normals[v]));
        if !normalize(&mut direction, UNIT) {
            direction = clockwise_normal(corners);
        }
        let offset = scale(direction, OFFSET as f32);
        let forward_start = sub(origin, offset);
        let backward_start = add(origin, offset);
        let span = scale(direction, self.reach);
        let forward = self.cast((forward_start, add(forward_start, span)), walk);
        let backward = self.cast((backward_start, sub(backward_start, span)), walk);
        let ahead = (forward_start, direction);
        let behind = (backward_start, direction.map(|x| -x));
        let kept = match (forward, backward) {
            (Some(f), Some(b)) => match self.rays {
                HlodTransferRays::Nearest => match f.time < b.time {
                    true => (f, ahead),
                    false => (b, behind),
                },
                HlodTransferRays::Facing => {
                    match (self.facing(f, direction), self.facing(b, direction)) {
                        (true, true) if f.time < b.time => (f, ahead),
                        (true, false) => (f, ahead),
                        _ => (b, behind),
                    }
                }
            },
            (Some(f), None) => (f, ahead),
            (None, Some(b)) => (b, behind),
            (None, None) => return Answer::Missed,
        };
        self.evaluated(kept)
    }

    /// The nearest source the segment `(start, end)` meets.
    fn cast(&self, (start, end): ([f32; 3], [f32; 3]), walk: &mut Walk) -> Option<Hit> {
        self.tree
            .closest((start.map(f64::from), end.map(f64::from)), walk)
    }

    /// Whether the source `hit` meets faces the way of `direction`: its corners' normals summed,
    /// made unit, leaning along it.
    fn facing(&self, hit: Hit, direction: [f32; 3]) -> bool {
        let [a, b, c] = self.sources.corner_normals(hit.triangle as usize);
        let mut normal = add(add(a, b), c);
        normalize(&mut normal, SMALL);
        dot(normal, direction) > 0.0
    }

    /// The source `hit` along the ray `(start, direction)` meets, and its weights at the point hit:
    /// the hit's fraction (of the segment, `reach` long) times `reach` along the unit direction.
    fn evaluated(&self, (hit, (start, direction)): (Hit, Ray)) -> Answer {
        let source = hit.triangle as usize;
        let point = add(start, scale(direction, hit.time * self.reach));
        Answer::Hit {
            source: hit.triangle,
            weights: weights(self.sources.corners(source), point),
        }
    }
}
