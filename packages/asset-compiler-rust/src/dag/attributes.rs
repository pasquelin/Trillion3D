//! The attributes of a region's vertices, and the weight each one carries in the simplification
//! error — every weight measured on the region, none of them chosen.
//!
//! Under `QemAttributes` the quadric of a collapse adds, to the distance to the surface, the
//! deviation of each attribute: Garland & Heckbert, *Simplifying Surfaces with Color and Texture
//! using Quadric Error Metrics* (1998), in the per-wedge form of Hoppe, *New Quadric Metric for
//! Simplifying Meshes with Appearance Attributes* (1999), which is what lets a seam carry two
//! values at one position. A weight says what one unit of an attribute is worth in **object
//! units of surface displacement**, so both halves of the error are one length, reach the screen
//! through the same f/z, and a level certifies a single number. For a texture coordinate that
//! length is the world displacement of the pattern — the texture deviation of Cohen, Olano &
//! Manocha, *Appearance-Preserving Simplification* (1998). The texel count of the material does
//! not enter it: a pattern sliding by a millimetre slides by a millimetre at every resolution.
//!
//! meshoptimizer scales positions to the unit extent of the region before it adds the attribute
//! terms (`rescalePositions`) and multiplies each attribute by its weight without touching that
//! extent (`rescaleAttributes`), so what it must be handed is the object-unit weight divided by
//! the extent. `qem_attributes.rs` does that division: it is the one that knows the extent.
//!
//! **Sensitivity.** Each weight is a root mean square over the region's triangles, weighed by
//! world area as Garland's plane quadrics are. A region that mixes texel densities is therefore
//! weighed at its RMS density: its dense triangles are under-counted by the ratio of their own
//! density to that mean, its sparse ones over-counted by the inverse. Nothing corrects it here —
//! one quadric carries one weight per component — and it is bounded by the region, which is one
//! group of at most 32 clusters of one primitive.
use super::*;
use crate::geometry_page::{FLAG_COLOR, FLAG_NORMAL, FLAG_UV, FLAG_UV1};
use crate::shared_math::{cross, dot, length, sub};

/// The texture coordinate sets, in the order `measure_region` reports them.
pub(super) const TEXTURE_FLAGS: [u32; 2] = [FLAG_UV, FLAG_UV1];

/// The texture coordinate set carrying `flag`, when the region has one.
pub(super) fn texture_set(attributes: &[Attribute], flag: u32) -> Option<&Attribute> {
    attributes.iter().find(|a| a.flag == flag && a.width == 2)
}

/// One pass over a region's triangles: the world area it covers, the area-weighted sum of its
/// squared edge lengths, and, per texture set, the area-weighted sum of its squared
/// parameterisation Jacobian.
#[derive(Default)]
struct RegionMeasure {
    area: f64,
    edge_squares: f64,
    texture: [TextureMeasure; 2],
}
#[derive(Clone, Copy, Default)]
struct TextureMeasure {
    area: f64,
    u: f64,
    v: f64,
}

/// Floats per vertex once every attribute is interleaved.
pub(super) fn stride(attributes: &[Attribute]) -> usize {
    attributes.iter().map(|a| a.width).sum()
}

/// Attributes of the region's vertices, interleaved, `remap` naming each one in the buffer.
pub(super) fn gather(attributes: &[Attribute], remap: &[u32]) -> Vec<f32> {
    let stride = stride(attributes);
    let mut out = Vec::with_capacity(remap.len() * stride);
    for &source in remap {
        let source = source as usize;
        for a in attributes {
            let width = a.width;
            out.extend_from_slice(&a.values[source * width..source * width + width]);
        }
    }
    out
}

/// Object units per unit of each interleaved component, in buffer order, derived from the
/// triangles `indices` names. A component whose attribute the region cannot measure — a texture
/// set no triangle parameterises, a region of no area — weighs zero, which keeps it out of the
/// error and leaves the survivor's value as it was.
pub(super) fn component_weights(
    positions: &[f32],
    indices: &[u32],
    attributes: &[Attribute],
) -> Vec<f32> {
    let measure = measure_region(positions, indices, attributes);
    let edge = root_mean_square(measure.edge_squares, measure.area);
    let texture = measure
        .texture
        .map(|t| [root_mean_square(t.u, t.area), root_mean_square(t.v, t.area)]);
    attributes
        .iter()
        .flat_map(|a| {
            let per_component = match a.flag {
                FLAG_NORMAL | FLAG_COLOR => [edge, edge],
                FLAG_UV => texture[0],
                FLAG_UV1 => texture[1],
                _ => [0.0, 0.0],
            };
            // A texture set weighs its `u` and its `v` apart, the parameterisation being free to
            // stretch one and not the other; every other attribute weighs each component alike.
            (0..a.width).map(move |c| per_component[usize::from(c == 1)] as f32)
        })
        .collect()
}

/// The area-weighted root mean square of a sum of squares, zero where there is no area to
/// average over.
fn root_mean_square(squares: f64, area: f64) -> f64 {
    if area > 0.0 {
        (squares / area).sqrt()
    } else {
        0.0
    }
}

fn measure_region(positions: &[f32], indices: &[u32], attributes: &[Attribute]) -> RegionMeasure {
    let sets = TEXTURE_FLAGS.map(|flag| texture_set(attributes, flag));
    let mut measure = RegionMeasure::default();
    for corners in indices.as_chunks::<3>().0 {
        let points = [0, 1, 2].map(|c| point(positions, corners[c]));
        let (d1, d2) = (sub(points[1], points[0]), sub(points[2], points[0]));
        let area = 0.5 * length(cross(d1, d2));
        if area <= 0.0 || !area.is_finite() {
            continue;
        }
        measure.area += area;
        // A unit tilt of the normal over one edge displaces the shading plane by that edge's
        // length, and a colour step over one edge is a slope over that edge: both are worth the
        // region's edge length, taken over the triangle's three edges and area-weighted.
        let d3 = sub(d2, d1);
        measure.edge_squares += area * (dot(d1, d1) + dot(d2, d2) + dot(d3, d3)) / 3.0;
        for (set, texture) in sets.iter().zip(measure.texture.iter_mut()) {
            let Some(set) = set else { continue };
            let uv = [0, 1, 2].map(|c| texel(&set.values, corners[c]));
            let Some([tangent_u, tangent_v]) = jacobian(&uv, d1, d2) else {
                continue;
            };
            texture.area += area;
            texture.u += area * dot(tangent_u, tangent_u);
            texture.v += area * dot(tangent_v, tangent_v);
        }
    }
    measure
}

/// The two texture edges of a triangle, from its first corner.
fn uv_edges(uv: &[[f64; 2]; 3]) -> [[f64; 2]; 2] {
    [1usize, 2].map(|c| [uv[c][0] - uv[0][0], uv[c][1] - uv[0][1]])
}

/// Twice the signed area of a triangle's texture coordinates — the determinant of the system
/// `jacobian` solves, and the orientation the parameterisation gives the triangle.
///
/// `None` when it has lost every significant bit to cancellation: the two products it subtracts
/// are formed from coordinates the file stores in single precision, so a determinant no larger
/// than their own rounding is a texture triangle degenerate against the world triangle it maps —
/// a triangle carrying no texture, which says nothing about density and nothing about sign.
pub(super) fn uv_determinant(uv: &[[f64; 2]; 3]) -> Option<f64> {
    let [e1, e2] = uv_edges(uv);
    let (positive, negative) = (e1[0] * e2[1], e1[1] * e2[0]);
    let determinant = positive - negative;
    (determinant.abs() > f32::EPSILON as f64 * (positive.abs() + negative.abs()))
        .then_some(determinant)
}

/// Tangent frame of the parameterisation, `Tu = dP/du` and `Tv = dP/dv`, solved from
/// `dP1 = du1*Tu + dv1*Tv` and `dP2 = du2*Tu + dv2*Tv`. Their lengths are the world distance one
/// unit of `u`, and one of `v`, spans on this triangle.
fn jacobian(uv: &[[f64; 2]; 3], d1: [f64; 3], d2: [f64; 3]) -> Option<[[f64; 3]; 2]> {
    let determinant = uv_determinant(uv)?;
    let [e1, e2] = uv_edges(uv);
    let combine = |k1: f64, k2: f64| [0, 1, 2].map(|a| (k1 * d1[a] + k2 * d2[a]) / determinant);
    Some([combine(e2[1], -e1[1]), combine(-e2[0], e1[0])])
}

fn point(values: &[f32], vertex: u32) -> [f64; 3] {
    let at = vertex as usize * 3;
    [0, 1, 2].map(|c| values[at + c] as f64)
}
pub(super) fn texel(values: &[f32], vertex: u32) -> [f64; 2] {
    let at = vertex as usize * 2;
    [0, 1].map(|c| values[at + c] as f64)
}

#[cfg(test)]
#[path = "attributes_tests.rs"]
mod tests;
