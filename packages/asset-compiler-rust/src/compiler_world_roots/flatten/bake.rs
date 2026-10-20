//! The flattened material: per texel of the atlas, the sources' material properties, each in its
//! own channel as the material holds it — base colour, shading normal, roughness and metallic —,
//! read where the texel lies on them, filtered over the texel's footprint there; the normal written
//! in the atlas mesh's own tangent frame — the frame the engine rebuilds from a triangle without
//! tangents (`cluster/cotangentFrameWgsl.ts`) —, so the map bends the atlas mesh's normal onto the
//! sources'. The flattened material draws opaque: its opacity is the constant one the base image's
//! alpha holds, never folded into the colour. The roughness and metallic vary across the surface
//! as the colour does, and what a surface reflects is much of its colour seen from far: a glass
//! curtain wall shows the sky because it is smooth, its frames and roof do not. One constant over
//! the actor would dull the glass to the roof's roughness and grey it; so a metal-roughness map
//! (glTF's: roughness in G, metallic in B, the factors 1) holds each texel's own, read in the same
//! pass as the colour. No specular nor emission map.
//!
//! Both bakes read a source's properties as its material holds them (`appearance`), a
//! transmissive surface's too: what the flattened material bakes is what each surface is made of,
//! not how it looks once lit over what lies behind it. The shell's rays pass through what the
//! engine draws alpha-blended alone (`appearance::seen`). Each sample is written straight into the
//! images' bytes.
use super::appearance::{self, Tally};
use super::raster::{fill_empty, gutter_source, infill, rasterize, HOLE, SAMPLED};
use super::tree::{triangle_of, Tree};
use crate::surface_trace::mesh::{mix, Footprint};
use crate::surface_trace::Traceable;
use crate::texture_preview::linear_to_srgb;
use std::sync::OnceLock;
use trillion3d_math::color::srgb_byte_to_linear;
use trillion3d_math::scalar::unit_to_byte_f32;
use trillion3d_math::triangle::{barycentric_weights, closest_point, face_normal};
use trillion3d_math::vec3::{cross, normalized_or};
use trillion3d_math::vecn::{dot, scale, sub, weighted_sum};

/// A mesh whose material is flattened: per vertex its position, normal and atlas coordinates in
/// `[0, 1]`, and its triangles.
pub(crate) struct Flat {
    pub positions: Vec<f32>,
    pub normals: Vec<f32>,
    pub uvs: Vec<f32>,
    pub indices: Vec<u32>,
}

/// The flattened material's images, RGBA8, `size` texels square: base colour (sRGB), the normal
/// map and the metal-roughness map; and the mean linear colour the bake read and the one the base image holds (`appearance::tone_gap`).
#[derive(Clone)]
pub(crate) struct Atlas {
    pub size: usize,
    pub base: Vec<u8>,
    pub normal: Vec<u8>,
    pub metal_rough: Vec<u8>,
    pub tone: [[f64; 3]; 2],
}

/// What the sources hold at a hit: linear base colour, the shading normal, and roughness and
/// metallic.
type Shade = ([f64; 3], [f64; 3], [f64; 2]);

impl Flat {
    fn corner(&self, t: usize, k: usize) -> usize {
        self.indices[t * 3 + k] as usize
    }
    fn uv(&self, v: usize) -> [f64; 2] {
        [f64::from(self.uvs[v * 2]), f64::from(self.uvs[v * 2 + 1])]
    }
    /// Triangle `t`'s corner normals.
    fn normals(&self, t: usize) -> [[f64; 3]; 3] {
        [0, 1, 2].map(|k| {
            let v = self.corner(t, k);
            [0, 1, 2].map(|a| f64::from(self.normals[v * 3 + a]))
        })
    }
}

/// The bytes a texel stores of `colour` (linear), the shading normal `bent` and `rough_metal`, the
/// texel's frame normal `n`, tangent and bitangent: sRGB colour, the normal in tangent space and
/// roughness and metallic, each a byte.
fn texel_bytes(
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
fn cotangent(
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
fn encode(target: [f64; 3], n: [f64; 3], t: [f64; 3], b: [f64; 3]) -> [f32; 3] {
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
fn shade(
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
struct Frame {
    corners: [[f64; 3]; 3],
    normals: [[f64; 3]; 3],
    edges: [[f64; 3]; 2],
    steps: [[f64; 2]; 2],
    quarter: Footprint,
    atlas_edges: [[f64; 2]; 2],
}

impl Frame {
    /// Triangle `t` of `flat`, `corners` its corners in texels.
    fn new(flat: &Flat, t: usize, corners: [[f64; 2]; 3]) -> Self {
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
    fn normal(&self, w: [f64; 3]) -> [f64; 3] {
        normalized_or(weighted_sum(self.normals, w), [0.0, 1.0, 0.0])
    }
}

/// The 256 sRGB bytes in linear, the base colour's curve.
fn srgb_table() -> &'static [f32; 256] {
    static TABLE: OnceLock<[f32; 256]> = OnceLock::new();
    TABLE.get_or_init(|| std::array::from_fn(|b| srgb_byte_to_linear(b as u8) as f32))
}

/// One RGBA8 image and the curve its colour channels are averaged in: the bytes read through
/// `decode`, written back by `encode`; alpha stays opaque (the infill averages colour only).
struct Image<'a> {
    bytes: &'a mut [u8],
    decode: &'static [f32; 256],
    encode: fn(f32) -> u8,
}

impl<'a> Image<'a> {
    /// A colour image, averaged in linear.
    fn srgb(bytes: &'a mut [u8]) -> Self {
        let encode = linear_to_srgb;
        let decode = srgb_table();
        Self {
            bytes,
            decode,
            encode,
        }
    }
    /// A data image, averaged as it is stored.
    fn unit(bytes: &'a mut [u8]) -> Self {
        let encode = unit_to_byte_f32;
        let decode = crate::texture_preview::linear_table();
        Self {
            bytes,
            decode,
            encode,
        }
    }
    /// Texel `at` set to the mean of texels `from`.
    fn mean(&mut self, at: usize, from: &[usize]) {
        for c in 0..3 {
            let sum: f32 = from
                .iter()
                .map(|&n| self.decode[self.bytes[n * 4 + c] as usize])
                .sum();
            self.bytes[at * 4 + c] = (self.encode)(sum / from.len() as f32);
        }
    }
    /// Texel `to` a copy of texel `from`.
    fn copy(&mut self, from: usize, to: usize) {
        self.bytes.copy_within(from * 4..from * 4 + 4, to * 4);
    }
}

/// One row of the images, each texel's bytes the sample writes.
struct Row<'a> {
    base: &'a mut [u8],
    normal: &'a mut [u8],
    metal_rough: &'a mut [u8],
    tally: &'a mut Tally,
}

/// The approximated shell's atlas (the `approximate` builder), `size` texels square: each texel
/// reads the sources at the hit nearest along its normal, ahead or behind within its triangle's
/// `reach` — the farthest that triangle lies from them —, filtered over the texel's footprint
/// carried onto the hit triangle (`shade`); then filled as every atlas is (`atlas`).
pub(super) fn project(
    flat: &Flat,
    sources: &Traceable,
    tree: &Tree<impl AsRef<[f32]> + Sync>,
    size: usize,
    reach: &[f64],
) -> Atlas {
    // A texel that meets no surface seen is a hole the infill fills.
    let keep = |triangle: usize, at: [f64; 2]| appearance::seen(sources, triangle, at);
    // One sample of a shell triangle at weights `w`: the sources' hit nearest along its normal,
    // seen from outside, along `−n`.
    let read = |frame: &Frame, t: usize, w: [f64; 3]| {
        let point = weighted_sum(frame.corners, w);
        let n = frame.normal(w);
        let (distance, triangle, at) = tree.nearest((point, n), reach[t], &keep)?;
        let ray = if distance > 0.0 { n } else { scale(n, -1.0) };
        let steps = sources.steps(triangle, (ray, frame.quarter));
        Some(shade(sources, triangle, at, steps, n))
    };
    atlas(flat, size, &read)
}

/// The merged mesh's atlas (a `merge` layer with `mergeMaterials`), `size` texels square, `flat`
/// the merged sources themselves given unique coordinates, triangle for triangle in the order of
/// `sources`: each texel reads its own triangle's material at its own point, filtered over the
/// texel's footprint there (`shade`) — every source's material rendered into its own charts, no
/// ray, so no neighbour's surface ever paints it. Then filled as every atlas is (`atlas`).
pub(super) fn own(flat: &Flat, sources: &Traceable, size: usize) -> Atlas {
    let read = |frame: &Frame, t: usize, w: [f64; 3]| {
        let n = frame.normal(w);
        let steps = sources.steps(t, (n, frame.quarter));
        Some(shade(sources, t, [w[1], w[2]], steps, n))
    };
    atlas(flat, size, &read)
}

/// The atlas of `flat`, `size` texels square, each texel's subsamples read by `read(frame,
/// triangle, weights)`. Then: the holes — interior texels that met nothing — filled from the valid
/// samples around them on the base colour and the metal-roughness map, not on the normal map (a
/// mean of neighbouring normals is no normal of the surface; the frame's own normal is the safe
/// value there); and each gutter texel a copy of its interior texel, filled or not, after the
/// infill so the gutter carries the filled values and bilinear filtering at a chart's edge reads
/// no black; then every empty texel of the base colour and the metal-roughness map given the
/// values of the charts nearest it (`raster::fill_empty`), so the far mip levels read no black
/// nor a stray roughness either. The normal map's empty texels keep the frame's up.
fn atlas<R>(flat: &Flat, size: usize, read: &R) -> Atlas
where
    R: Fn(&Frame, usize, [f64; 3]) -> Option<Shade> + Sync,
{
    let texels = size * size;
    let corners: Vec<[f64; 2]> = (flat.indices.iter())
        .map(|&v| scale(flat.uv(v as usize), size as f64))
        .collect();
    // The defaults where nothing writes: black, the frame's own normal (tangent-space up) and a
    // neutral dielectric (roughness one half, no metal; R unread).
    let mut base = [0, 0, 0, 255].repeat(texels);
    let mut normal = [128, 128, 255, 255].repeat(texels);
    let mut metal_rough = [255, 128, 0, 255].repeat(texels);
    let frames: Vec<Frame> = (0..flat.indices.len() / 3)
        .map(|t| Frame::new(flat, t, [0, 1, 2].map(|k| corners[t * 3 + k])))
        .collect();
    let sample = |row: &mut Row, x: usize, t: usize, w: [f64; 3]| {
        let frame = &frames[t];
        let steps = frame.steps;
        let n = frame.normal(w);
        let [e1, e2] = frame.edges;
        let [d1, d2] = frame.atlas_edges;
        let (tangent, bitangent) = cotangent(n, e1, e2, d1, d2);
        // Supersampled: the texel read at the points of its net (`surface_trace::SUBSAMPLES`),
        // each over its share of the footprint, and the hits averaged — four, sixteen where the
        // four's bytes part (`surface_trace::rays`, `parted`). A ray bake with one sample per
        // texel would alias a window's mullions into moiré, so each texel averages its footprint
        // instead.
        let trace = |k: usize| {
            let offset = crate::surface_trace::SUBSAMPLES[k];
            let (dx, dy) = (offset[0] - 0.5, offset[1] - 0.5);
            let v = w[1] + steps[0][0] * dx + steps[1][0] * dy;
            let u = w[2] + steps[0][1] * dx + steps[1][1] * dy;
            // Each point on the shell's triangle, as the texel's own sample is.
            read(
                frame,
                t,
                on_triangle(frame.corners, barycentric_weights(v, u)),
            )
        };
        // Each ray's texel alone, in the bytes the images store; a hit beside a miss parts them
        // too.
        let more = |samples: &[Option<Shade>]| {
            let hits = samples.iter().flatten().count();
            if hits != samples.len() {
                return hits != 0;
            }
            let alone: smallvec::SmallVec<[[u8; 8]; 16]> = (samples.iter().flatten())
                .map(|(colour, bent, rough_metal)| {
                    let shade = (
                        colour.map(|x| x as f32),
                        *bent,
                        rough_metal.map(|x| x as f32),
                    );
                    texel_bytes(shade, (n, tangent, bitangent))
                })
                .collect();
            crate::surface_trace::parted(&alone)
        };
        let samples = crate::surface_trace::rays(trace, more);
        let mut hits = 0.0f64;
        let mut sum: Shade = ([0.0; 3], [0.0; 3], [0.0; 2]);
        for (colour, bent, rough_metal) in samples.into_iter().flatten() {
            hits += 1.0;
            for c in 0..3 {
                sum.0[c] += colour[c];
                sum.1[c] += bent[c];
            }
            for c in 0..2 {
                sum.2[c] += rough_metal[c];
            }
        }
        if hits == 0.0 {
            return false;
        }
        let mean = |x: f64| (x / hits) as f32;
        let mean_shade = (sum.0.map(mean), sum.1, sum.2.map(mean));
        let bytes = texel_bytes(mean_shade, (n, tangent, bitangent));
        let at = x * 4;
        row.base[at..at + 3].copy_from_slice(&bytes[0..3]);
        row.normal[at..at + 3].copy_from_slice(&bytes[3..6]);
        // glTF's metal-roughness layout: roughness in G, metallic in B.
        row.metal_rough[at + 1..at + 3].copy_from_slice(&bytes[6..8]);
        appearance::count(row.tally, sum.0.map(|x| x / hits));
        true
    };
    let row_bytes = size * 4;
    let mut tallies: Vec<Tally> = vec![[0.0; 4]; size];
    let rows: Vec<Row> = (base.chunks_mut(row_bytes))
        .zip(normal.chunks_mut(row_bytes))
        .zip(metal_rough.chunks_mut(row_bytes))
        .zip(tallies.iter_mut())
        .map(|(((base, normal), metal_rough), tally)| Row {
            base,
            normal,
            metal_rough,
            tally,
        })
        .collect();
    let occupancy = rasterize(size, &corners, rows, &sample);
    let mut base_image = Image::srgb(&mut base);
    let mut normal_image = Image::unit(&mut normal);
    let mut metal_rough_image = Image::unit(&mut metal_rough);
    infill(size, &occupancy, |at, from| {
        base_image.mean(at, from);
        metal_rough_image.mean(at, from);
    });
    for (to, &code) in occupancy.iter().enumerate() {
        if let Some(from) = gutter_source(code) {
            base_image.copy(from, to);
            normal_image.copy(from, to);
            metal_rough_image.copy(from, to);
        }
    }
    fill_empty(size, &occupancy, &mut base, (srgb_table(), linear_to_srgb));
    let data = (
        crate::texture_preview::linear_table(),
        unit_to_byte_f32 as fn(f32) -> u8,
    );
    fill_empty(size, &occupancy, &mut metal_rough, data);
    Atlas {
        size,
        tone: [
            appearance::read_tone(&tallies),
            held_tone(&base, &occupancy),
        ],
        base,
        normal,
        metal_rough,
    }
}

/// The mean linear colour of the base image's interior texels, sampled or filled, in texel order.
fn held_tone(base: &[u8], occupancy: &[u32]) -> [f64; 3] {
    let decode = srgb_table();
    let (mut sum, mut count) = ([0.0f64; 3], 0.0f64);
    for (at, _) in
        (occupancy.iter().enumerate()).filter(|&(_, &code)| code == SAMPLED || code == HOLE)
    {
        for c in 0..3 {
            sum[c] += f64::from(decode[base[at * 4 + c] as usize]);
        }
        count += 1.0;
    }
    if count == 0.0 {
        return [0.0; 3];
    }
    sum.map(|x| x / count)
}

/// The weights `w` of triangle `p`, moved to the triangle's nearest point when they leave it.
fn on_triangle(p: [[f64; 3]; 3], w: [f64; 3]) -> [f64; 3] {
    if w.iter().all(|&x| x >= 0.0) {
        return w;
    }
    let q = closest_point(weighted_sum(p, w), p[0], p[1], p[2]);
    let (e1, e2, d) = (sub(p[1], p[0]), sub(p[2], p[0]), sub(q, p[0]));
    let (d00, d01, d11) = (dot(e1, e1), dot(e1, e2), dot(e2, e2));
    let (d20, d21) = (dot(d, e1), dot(d, e2));
    let denominator = d00 * d11 - d01 * d01;
    if denominator.abs() < 1e-300 {
        return [1.0, 0.0, 0.0];
    }
    let v = ((d11 * d20 - d01 * d21) / denominator).clamp(0.0, 1.0);
    let u = ((d00 * d21 - d01 * d20) / denominator).clamp(0.0, 1.0 - v);
    barycentric_weights(v, u)
}
