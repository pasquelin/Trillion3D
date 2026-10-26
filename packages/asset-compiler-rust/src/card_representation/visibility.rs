//! Whether a surfel is seen from outside the mesh: rays cast over the hemisphere around its normal,
//! the share that escapes its visibility, and a surfel inside geometry — most rays hit, many of them
//! back faces — is dropped.
use super::surfels::{Cast, Sample};
use trillion3d_math::vector::vecn::{dot, scale};

/// How far a ray starts off the surface it leaves, centimetres.
const SURFACE_RAY_BIAS: f64 = 0.1;
/// A surfel is inside geometry when more than this share of its rays hit...
const INSIDE_HIT_SHARE: f32 = 0.8;
/// ... and more than this share of them hit a back face.
const INSIDE_BACK_SHARE: f32 = 0.2;
/// Below this, the normal's `z` is too near `-1` for the frame's formula, which divides by `1 + z`.
const FRAME_LIMIT: f32 = -0.999_999_9;

/// The two tangents of the unit `normal`, built without normalising (Frisvad, 2012).
fn frame(normal: [f32; 3]) -> ([f32; 3], [f32; 3]) {
    if normal[2] < FRAME_LIMIT {
        return ([0.0, -1.0, 0.0], [-1.0, 0.0, 0.0]);
    }
    let a = 1.0 / (1.0 + normal[2]);
    let b = -normal[0] * normal[1] * a;
    (
        [1.0 - normal[0] * normal[0] * a, b, -normal[0]],
        [b, 1.0 - normal[1] * normal[1] * a, -normal[1]],
    )
}

/// The share of the rays over the hemisphere around a surfel's normal that leave the mesh, and
/// whether the surfel is valid, outside geometry. The rays leave the samples `span` of the surfel
/// one after the other, round and round.
pub(super) fn visibility(cast: &Cast<'_>, span: &[Sample]) -> (f32, bool) {
    let reach = cast.volume.reach;
    let (mut hits, mut backs, mut open) = (0u32, 0u32, 0u32);
    for (index, ray) in cast.rays.iter().enumerate() {
        let sample = &span[index % span.len()];
        let normal = sample.normal.map(|c| c as f32);
        let (tangent, bitangent) = frame(normal);
        let direction = [0, 1, 2].map(|k| {
            f64::from(
                ray[0] as f32 * tangent[k]
                    + ray[1] as f32 * bitangent[k]
                    + ray[2] as f32 * normal[k],
            )
        });
        let line = (sample.position, scale(direction, reach));
        match cast.scene.hit(line, (SURFACE_RAY_BIAS / reach, None)) {
            Some(hit) => {
                hits += 1;
                if dot(direction, hit.normal) > 0.0 && !hit.two_sided {
                    backs += 1;
                }
            }
            None => open += 1,
        }
    }
    let total = cast.rays.len() as f32;
    let inside = hits as f32 > INSIDE_HIT_SHARE * total && backs as f32 > INSIDE_BACK_SHARE * total;
    (open as f32 / total, !inside)
}
