//! The atlas: the sRGB table, the source image read, the texels of every chart, the held tone.
use super::super::appearance::{self, Tally};
use super::super::raster::{fill_empty, gutter_source, infill, rasterize, HOLE, SAMPLED};
use super::texel::{cotangent, texel_bytes, Frame};
use super::{Atlas, Flat, Shade};
use crate::texture_preview::linear_to_srgb;
use std::sync::OnceLock;
use trillion3d_math::color::srgb_byte_to_linear;
use trillion3d_math::scalar::unit_to_byte_f32;
use trillion3d_math::triangle::{barycentric_weights, closest_point};
use trillion3d_math::vecn::{dot, scale, sub, weighted_sum};

/// The 256 sRGB bytes in linear, the base colour's curve.
fn srgb_table() -> &'static [f32; 256] {
    static TABLE: OnceLock<[f32; 256]> = OnceLock::new();
    TABLE.get_or_init(|| std::array::from_fn(|b| srgb_byte_to_linear(b as u8) as f32))
}

/// One RGBA8 image and the curve its colour channels are averaged in: the bytes read through
/// `decode`, written back by `encode`; alpha stays opaque (the infill averages colour only).
struct Image<'a> {
    pub(super) bytes: &'a mut [u8],
    pub(super) decode: &'static [f32; 256],
    pub(super) encode: fn(f32) -> u8,
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
    pub(super) base: &'a mut [u8],
    pub(super) normal: &'a mut [u8],
    pub(super) metal_rough: &'a mut [u8],
    pub(super) tally: &'a mut Tally,
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
pub(super) fn atlas<R>(flat: &Flat, size: usize, read: &R) -> Atlas
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
