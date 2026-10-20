//! One texel's bytes: the cotangent frame, the encoding, the shading.
use super::super::appearance;
use super::super::tree::triangle_of;
use super::{Flat, Shade};
use crate::surface_trace::mesh::{mix, Footprint};
use crate::surface_trace::Traceable;
use crate::texture_preview::linear_to_srgb;
use trillion3d_math::scalar::unit_to_byte_f32;
use trillion3d_math::triangle::face_normal;
use trillion3d_math::vec3::{cross, normalized_or};
use trillion3d_math::vecn::{dot, scale, sub, weighted_sum};

/// The bytes a texel stores of `colour` (linear), the shading normal `bent` and `rough_metal`, the
/// texel's frame normal `n`, tangent and bitangent: sRGB colour, the normal in tangent space and
/// roughness and metallic, each a byte.
pub(super) fn texel_bytes(
    (colour, bent, rough_metal): ([f32; 3], [f64; 3], [f32; 2]),
    (n, tangent, bitangent): ([f64; 3], [f64; 3], [f64; 3]),
) -> [u8; 8] {
    let c = colour.map(linear_to_srgb);
    let tangent_space = encode(normalized_or(bent, n), n, tangent, bitangent);
    let m = tangent_space.map(|x| unit_to_byte_f32(x * 0.5 + 0.5));
    let r = rough_metal.map(unit_to_byte_f32);
    [c[0], c[1], c[2], m[0], m[1], m[2], r[0], r[1]]
}

/// The cotangent frame (`cotangentFrame`, `cluster/cotangentFrameWgsl.ts`) of a triangle with
/// edges `e1`, `e2` and texture deltas `d1`, `d2`, about the normal `n`: `T` along `u`, `B` along
/// `v`, the longer unit.
pub(super) fn cotangent(
    n: [f64; 3],
    e1: [f64; 3],
    e2: [f64; 3],
    d1: [f64; 2],
    d2: [f64; 2],
) -> ([f64; 3], [f64; 3]) {
    let p = cross(e2, n);
    let q = cross(n, e1);
    let t = weighted_sum([p, q], [d1[0], d2[0]]);
    let b = weighted_sum([p, q], [d1[1], d2[1]]);
    let s = 1.0 / dot(t, t).max(dot(b, b)).max(1e-30).sqrt();
    (scale(t, s), scale(b, s))
}

/// The tangent-space value whose bend of `n` over `t`, `b` gives `target`
/// (`bendNormal(N, T, B, 1, (x, −y, z))`: a frame without vertex tangents turns the map's
/// second factor, `normalScaleY`, `compiler_tables/materials.rs`), unit.
pub(super) fn encode(target: [f64; 3], n: [f64; 3], t: [f64; 3], b: [f64; 3]) -> [f32; 3] {
    let z = dot(target, n);
    let plane = sub(target, scale(n, z));
    let (tt, tb, bb) = (dot(t, t), dot(t, b), dot(b, b));
    let (rt, rb) = (dot(plane, t), dot(plane, b));
    let det = tt * bb - tb * tb;
    let (x, y) = if det.abs() > 1e-20 {
        ((bb * rt - tb * rb) / det, (tt * rb - tb * rt) / det)
    } else {
        (0.0, 0.0)
    };
    normalized_or([x, -y, z], [0.0, 0.0, 1.0]).map(|c| c as f32)
}

/// What the sources show at barycentric `at` of their triangle `t`, the footprint's barycentric
/// steps `steps`: linear base colour, the shading normal —
/// the vertex normal bent by the normal map over the triangle's cotangent frame, as the engine
/// bends it — facing `towards`, and roughness and metallic.
pub(super) fn shade(
    sources: &Traceable,
    t: usize,
    at: [f64; 2],
    steps: [[f64; 2]; 2],
    towards: [f64; 3],
) -> Shade {
    let surface = sources.surface(t);
    let colour = appearance::base_colour(sources, t, at, steps);
    let corners = [0, 1, 2].map(|k| crate::proxy::tracer::vertex(&sources.world, t, k));
    let facing = face_normal(corners[0], corners[1], corners[2]);
    let mut normal = match sources.corners[t].normals {
        Some(normals) => normalized_or(mix::<3>(&normals[..], at), facing),
        None => facing,
    };
    let (normal_uv, normal_across) =
        sources.uv(t, at, crate::surface_trace::surface::NORMAL_SLOT, steps);
    if let Some(map) = surface.tangent_normal(normal_uv, normal_across) {
        let set = (surface.sets[crate::surface_trace::surface::NORMAL_SLOT] as usize)
            .min(crate::surface_trace::mesh::SETS - 1);
        let uv = &sources.corners[t].uv[set];
        let d = |k: usize| {
            [
                f64::from(uv[k * 2]) - f64::from(uv[0]),
                f64::from(uv[k * 2 + 1]) - f64::from(uv[1]),
            ]
        };
        let (tangent, bitangent) = cotangent(
            normal,
            sub(corners[1], corners[0]),
            sub(corners[2], corners[0]),
            d(1),
            d(2),
        );
        // The engine's second factor on a frame without vertex tangents (`normalScaleY`).
        let bent = weighted_sum([tangent, bitangent, normal], [map[0], -map[1], map[2]]);
        normal = normalized_or(bent, normal);
    }
    if dot(normal, towards) < 0.0 {
        normal = scale(normal, -1.0);
    }
    (
        colour,
        normal,
        appearance::rough_metal(sources, t, at, steps),
    )
}

/// The barycentric weights' steps per atlas texel of triangle `t`, `corners` in texels: how the
/// weights of the second and third corners change along `x`, then along `y`.
fn texel_steps(corners: [[f64; 2]; 3]) -> [[f64; 2]; 2] {
    let (e1, e2) = (sub(corners[1], corners[0]), sub(corners[2], corners[0]));
    let det = trillion3d_math::vec2::cross(e1, e2);
    if det.abs() < 1e-30 {
        return [[0.0; 2]; 2];
    }
    // The inverse of the columns `e1`, `e2`, applied to the unit steps.
    [[e2[1] / det, -e1[1] / det], [-e2[0] / det, e1[0] / det]]
}

/// What every texel of a shell triangle shares: its corners, corner normals and edges, the
/// barycentric steps per atlas texel, the quarter of a texel's footprint each subsample reads
/// over, and its atlas edges.
pub(super) struct Frame {
    pub(super) corners: [[f64; 3]; 3],
    pub(super) normals: [[f64; 3]; 3],
    pub(super) edges: [[f64; 3]; 2],
    pub(super) steps: [[f64; 2]; 2],
    pub(super) quarter: Footprint,
    pub(super) atlas_edges: [[f64; 2]; 2],
}

impl Frame {
    /// Triangle `t` of `flat`, `corners` its corners in texels.
    pub(super) fn new(flat: &Flat, t: usize, corners: [[f64; 2]; 3]) -> Self {
        let steps = texel_steps(corners);
        let p = triangle_of(&flat.positions, &flat.indices, t);
        let edges = [sub(p[1], p[0]), sub(p[2], p[0])];
        let quarter = steps.map(|[s, u]| scale(weighted_sum(edges, [s, u]), 0.25));
        let uv = [0, 1, 2].map(|k| flat.uv(flat.corner(t, k)));
        Self {
            corners: p,
            normals: flat.normals(t),
            edges,
            steps,
            quarter,
            atlas_edges: [sub(uv[1], uv[0]), sub(uv[2], uv[0])],
        }
    }

    /// The interpolated unit normal at weights `w`.
    pub(super) fn normal(&self, w: [f64; 3]) -> [f64; 3] {
        normalized_or(weighted_sum(self.normals, w), [0.0, 1.0, 0.0])
    }
}
