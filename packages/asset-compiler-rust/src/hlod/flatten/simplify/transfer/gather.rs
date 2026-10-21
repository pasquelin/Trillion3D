//! A texel of the grid gathered from its block of fine texels, row after row, as the method
//! down samples them, each skipping the fine texels no triangle maps to (`read::UNREAD`):
//!
//! - the base colour (`base`): their mean, scaled back to their mean luminance when its own passes
//!   a thousandth; nothing read, transparent black;
//! - any other value — a coverage, the specular, roughness and metallic, the emission (`mean`):
//!   their mean; nothing read, zero;
//! - the normal (`normal`), where a triangle of the grid maps to the texel: each world normal read
//!   weighed by the inverse of a tenth plus its squared cosine to the texel's blended vertex
//!   normal — a normal across the surface counts most —, their mean written in the texel's
//!   tangent frame (`in_frame`), shifted by one and halved, opaque; nothing read, its
//!   tangent-space value zero, so a half in each channel; no triangle, transparent black.
//!
//! The texel's tangent frame is the one a mesh's own tangents give at the point (`tangents`): its
//! corners' tangents blended, its normals blended; its bitangent the blended normal across the
//! blended tangent, its tangent that bitangent across the normal again, both turned by the
//! handedness the corners' frames blend to — each corner's the sign of the determinant of its
//! tangent, its bitangent (its normal across its tangent, unit, times its sign) and its normal;
//! the blend read as plus one where positive, else minus one. The map's value is the vector in
//! that frame — the vector times the frame's inverse, or its transpose where the frame's
//! determinant is a thousandth or less —, left as it is within the unit cube, else made unit: not
//! normalised as a rule, so a mean of normals that disagree stays shorter than one.
use super::colour::{luminance, Linear};
use super::raster::Texel;
use super::read::UNREAD;
use super::Frames;
use crate::hlod::flatten::simplify::nearest::{blend, normalize, SMALL};
use crate::hlod::flatten::simplify::proxy::Proxy;
use crate::hlod::flatten::units::swap_axes;
use trillion3d_math::vector::vec3::cross;
use trillion3d_math::vector::vecn::{add, dot, scale};

/// The luminance a mean colour must pass for its luminance to be set back.
const DARK: f64 = 1e-3;

/// A normal's weight's floor: a tenth.
const FLOOR: f64 = 0.1;

/// The determinant of a texel's frame past which it is inverted, else transposed.
const INVERTIBLE: f64 = 0.001;

/// A texel's base colour from its fine texels' `samples` (module doc).
pub(super) fn base(samples: impl Iterator<Item = Linear>) -> Linear {
    let (mut sum, mut luma, mut count) = ([0.0; 4], 0.0f32, 0u32);
    for sample in samples.filter(|s| s[0] != UNREAD) {
        sum = add(sum, sample);
        luma += luminance(sample);
        count += 1;
    }
    if count == 0 {
        return [0.0; 4];
    }
    let colour = scale(sum, 1.0 / count as f32);
    let luma = luma / count as f32;
    match f64::from(luminance(colour)) > DARK {
        true => scale(colour, luma / luminance(colour)),
        false => colour,
    }
}

/// A texel's coverage, specular with roughness and metallic, or emission — `N` channels — from its
/// fine texels' `samples` (module doc).
pub(super) fn mean<const N: usize>(samples: impl Iterator<Item = [f32; N]>) -> [f32; N] {
    let (mut sum, mut count) = ([0.0; N], 0u32);
    for sample in samples.filter(|s| s[0] != UNREAD) {
        sum = add(sum, sample);
        count += 1;
    }
    match count {
        0 => [0.0; N],
        _ => scale(sum, 1.0 / count as f32),
    }
}

/// A corner of the simplified mesh's triangle: its normal, and its tangent with its bitangent's
/// sign, in our frame.
type Corner = ([f32; 3], [f32; 4]);

/// The handedness the frames of `corners` blend to at weights `w` (module doc): plus one or minus
/// one.
fn handedness(w: [f64; 3], corners: [Corner; 3]) -> f32 {
    let signs = corners.map(|(n, [x, y, z, sign])| -> f64 {
        let tangent = [x, y, z];
        let mut bitangent = cross(n, tangent);
        if !normalize(&mut bitangent, SMALL) {
            bitangent = [0.0; 3];
        }
        let bitangent = scale(bitangent, sign);
        let determinant = dot(
            tangent.map(f64::from),
            cross(bitangent.map(f64::from), n.map(f64::from)),
        );
        match determinant < 0.0 {
            true => -1.0,
            false => 1.0,
        }
    });
    match w[0] * signs[0] + w[1] * signs[1] + w[2] * signs[2] > 0.0 {
        true => 1.0,
        false => -1.0,
    }
}

/// The tangent-space value of world vector `v` at the point of weights `w` of a triangle of
/// `corners`, `up` the blend of their normals (module doc).
fn in_frame(w: [f64; 3], corners: [Corner; 3], up: [f32; 3], v: [f32; 3]) -> [f32; 3] {
    let tangent = blend(w, corners.map(|(_, [x, y, z, _])| [x, y, z]));
    let hand = handedness(w, corners);
    let bitangent = scale(cross(up, tangent), hand);
    let tangent = scale(cross(bitangent, up), hand);
    let [t, b, n] = [tangent, bitangent, up].map(|c| c.map(f64::from));
    let v = v.map(f64::from);
    let determinant = dot(t, cross(b, n));
    let at = match determinant.abs() > INVERTIBLE {
        true => [
            dot(v, cross(b, n)),
            dot(v, cross(n, t)),
            dot(v, cross(t, b)),
        ]
        .map(|x| x / determinant),
        false => [dot(t, v), dot(b, v), dot(n, v)],
    };
    let at = at.map(|x| x as f32);
    let length = dot(at, at).sqrt();
    match at.iter().any(|&x| x < -1.0 || x > 1.0) {
        true => at.map(|x| x / length),
        false => at,
    }
}

/// A texel's normal map value, `texel` its place on the grid, from its fine texels' world normals
/// `samples`, in the method's frame, none where nothing was read; `frames` the simplified mesh's
/// (module doc).
pub(super) fn normal(
    texel: &Texel,
    (proxy, frames): (&Proxy, &Frames),
    samples: impl Iterator<Item = Option<[f32; 3]>>,
) -> Linear {
    if texel.triangle < 0 {
        return [0.0; 4];
    }
    let t = texel.triangle as usize;
    let ends = [0, 1, 2].map(|k| proxy.indices[3 * t + k] as usize);
    let corners = ends.map(|v| (frames.normals[v], frames.tangents[v]));
    let up = blend(texel.weights, corners.map(|(n, _)| n));
    let (mut sum, mut count) = ([0.0f32; 3], 0u32);
    for sample in samples.flatten().map(swap_axes) {
        let cosine = dot(up, sample);
        let weight = (1.0 / (f64::from(cosine * cosine) + FLOOR)) as f32;
        sum = add(sum, scale(sample, weight));
        count += 1;
    }
    let mean = match count {
        0 => [0.0; 3],
        _ => scale(sum, 1.0 / count as f32),
    };
    let [x, y, z] = in_frame(texel.weights, corners, up, mean).map(|v| (v + 1.0) * 0.5);
    [x, y, z, 1.0]
}
