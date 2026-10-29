//! The attributes a hit shades its material with: each corner of a cut triangle keeps the texture
//! coordinate, the shading normal and the vertex colour of the DAG's vertex it names
//! (`RAY_TRACING_CORNER_BYTES`), read from the arrays the cut's indices lie in (`carried`, beside the
//! positions). They are written after the triangles (`encode.rs`), in the order of the tree's
//! triangles, so that a triangle's rank in the file is also the rank of its three corners.
use super::abi::RAY_TRACING_CORNER_BYTES;
use trillion3d_page_codec::encode::Attribute;
use trillion3d_page_codec::{FLAG_COLOR, FLAG_NORMAL, FLAG_UV};

/// The bytes of the three corners of a triangle.
pub(super) const TRIANGLE_ATTRIBUTE_BYTES: usize = 3 * RAY_TRACING_CORNER_BYTES;

/// A triangle's three corners' attributes, as the file lays them.
pub(super) type TriangleAttributes = [u8; TRIANGLE_ATTRIBUTE_BYTES];

/// The vertex colour of a corner whose mesh has none: white, which multiplies nothing.
const NO_COLOUR: [u8; 4] = [255; 4];

/// The attribute of presence bit `flag` among `carried`, none if the mesh does not carry it.
fn find<'a>(carried: &[&'a Attribute], flag: u32) -> Option<&'a Attribute> {
    carried.iter().copied().find(|a| a.flag == flag)
}

/// The `width` floats of vertex `vertex` of `attribute`, none past the end of its values.
fn values_of(attribute: &Attribute, vertex: usize, least: usize) -> Option<&[f32]> {
    if attribute.width < least {
        return None;
    }
    let from = vertex.checked_mul(attribute.width)?;
    attribute
        .values
        .get(from..from.checked_add(attribute.width)?)
}

/// Whether `carried` holds an attribute a hit reads: a normal, a texture coordinate or a colour.
pub(super) fn carries_any(carried: &[&Attribute]) -> bool {
    carried
        .iter()
        .any(|a| matches!(a.flag, FLAG_NORMAL | FLAG_UV | FLAG_COLOR))
}

/// Whether `carried` holds a shading normal.
pub(super) fn carries_normal(carried: &[&Attribute]) -> bool {
    find(carried, FLAG_NORMAL).is_some()
}

/// The octahedral map of the unit vector `n`, each coordinate in `snorm16`; a vector that is zero
/// or not finite takes the code of the pole; a record whose corners carry no normal says so by its
/// flags (`RAY_TRACING_FLAG_NORMALS`), not by a code.
fn octahedral(n: [f32; 3]) -> [i16; 2] {
    let sum = n[0].abs() + n[1].abs() + n[2].abs();
    if !sum.is_finite() || sum <= 0.0 {
        return [0, 0];
    }
    let side = |v: f32| if v >= 0.0 { 1.0 } else { -1.0 };
    let mut e = [n[0] / sum, n[1] / sum];
    if n[2] < 0.0 {
        e = [
            (1.0 - e[1].abs()) * side(e[0]),
            (1.0 - e[0].abs()) * side(e[1]),
        ];
    }
    e.map(|c| (c.clamp(-1.0, 1.0) * 32767.0).round() as i16)
}

/// The attributes of vertex `vertex`: its texture coordinate (zero without one), its normal (the pole's
/// code without one) and its colour (white without one).
fn corner(carried: &[&Attribute], vertex: u32) -> [u8; RAY_TRACING_CORNER_BYTES] {
    let vertex = vertex as usize;
    let uv = find(carried, FLAG_UV)
        .and_then(|a| values_of(a, vertex, 2))
        .map_or([0.0; 2], |v| [v[0], v[1]]);
    let normal = find(carried, FLAG_NORMAL)
        .and_then(|a| values_of(a, vertex, 3))
        .map_or([0; 2], |v| octahedral([v[0], v[1], v[2]]));
    let colour = find(carried, FLAG_COLOR)
        .and_then(|a| values_of(a, vertex, 3))
        .map_or(NO_COLOUR, |v| {
            let alpha = v.get(3).copied().unwrap_or(1.0);
            [v[0], v[1], v[2], alpha].map(|c| (c.clamp(0.0, 1.0) * 255.0).round() as u8)
        });
    let mut out = [0; RAY_TRACING_CORNER_BYTES];
    out[0..4].copy_from_slice(&uv[0].to_le_bytes());
    out[4..8].copy_from_slice(&uv[1].to_le_bytes());
    out[8..10].copy_from_slice(&normal[0].to_le_bytes());
    out[10..12].copy_from_slice(&normal[1].to_le_bytes());
    out[12..16].copy_from_slice(&colour);
    out
}

/// The attributes of the three corners `corners` of a triangle, in `carried`.
pub(super) fn triangle_attributes(carried: &[&Attribute], corners: &[u32]) -> TriangleAttributes {
    let mut out = [0; TRIANGLE_ATTRIBUTE_BYTES];
    for (k, &vertex) in corners.iter().enumerate() {
        out[k * RAY_TRACING_CORNER_BYTES..(k + 1) * RAY_TRACING_CORNER_BYTES]
            .copy_from_slice(&corner(carried, vertex));
    }
    out
}
