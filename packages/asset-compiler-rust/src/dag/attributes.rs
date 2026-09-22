//! Attributes in the simplification error, and the vertices a reduction creates.
//!
//! Under `QemAttributes` the quadric of a collapse adds, to the distance to the surface, the
//! deviation of each attribute weighed by `weight_of`. meshoptimizer scales positions to the
//! unit extent of the region before it adds the attribute terms, so a weight reads as "one unit
//! of this attribute is worth that fraction of the region's extent". A page carries no tangent —
//! the shader rebuilds it — so none enters the error. The weights are part of the strategy:
//! changing one changes every coarse level, hence the cache key through the implementation
//! fingerprint.
use super::*;
use crate::geometry_page::{FLAG_COLOR, FLAG_NORMAL, FLAG_UV, FLAG_UV1};

/// A cluster corner naming a vertex the reduction created rather than one of the buffer: the low
/// bits rank it in the group's `NewVertices`. Resolved to a buffer index once the level is
/// appended (`build.rs`), so a cluster never leaves the builder with this bit set.
pub(super) const NEW_VERTEX: u32 = 1 << 31;

/// Weight of a unit of normal or texture coordinate against the region's extent; a colour, whose
/// unit is a whole channel rather than a wrap or a flip, is worth half of it.
///
/// Measured on Emerald (1280x720, 1 px threshold, 60 frames, `qem-endpoints` as the reference),
/// scaling the declared 0.5 / 0.5 / 0.25 uniformly: 0.5 drew +6.6 / +34.7 / +26.7 % triangles on
/// the `generale`, `sol` and `rue` views, 0.25 +0.2 / +17.4 / +12.1 %, 0.125 -2.7 / +8.6 / +6.7 %,
/// 0.0625 -5.9 / +4.6 / +3.8 %, 0 -7.9 / -0.8 / -0.6 % — and at 0 meshoptimizer stops solving the
/// attributes at all, which is the strategy itself. The normal carries nearly the whole cost: at
/// 0.5 on the normal alone the views drew +3.9 / +34.0 / +26.1 %, at 0.5 on the texture
/// coordinates and 0.25 on the colour alone -4.9 / +10.8 / +8.1 %. The roots stayed between 1 870
/// and 1 875 against 1 883 at every point, so nothing here is bought from the seams.
const ATTRIBUTE_WEIGHT: f32 = 0.0625;

/// Weight of every component of an attribute in the quadric; zero keeps it out of the error and
/// out of the solve, so the survivor's value is copied as is.
pub(super) fn weight_of(flag: u32) -> f32 {
    match flag {
        FLAG_NORMAL | FLAG_UV | FLAG_UV1 => ATTRIBUTE_WEIGHT,
        FLAG_COLOR => ATTRIBUTE_WEIGHT / 2.0,
        _ => 0.0,
    }
}

/// Floats per vertex once every attribute is interleaved.
pub(super) fn stride(attributes: &[Attribute]) -> usize {
    attributes.iter().map(|a| a.width).sum()
}
/// One weight per interleaved component, in buffer order.
pub(super) fn component_weights(attributes: &[Attribute]) -> Vec<f32> {
    attributes
        .iter()
        .flat_map(|a| std::iter::repeat_n(weight_of(a.flag), a.width))
        .collect()
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

/// Vertices a reduction created: positions and interleaved attributes, as `gather` lays them
/// out, and whether each one sits on a texture seam — inherited from the source vertex it was
/// solved from, since a seam vertex never moves and its solved copies stay a seam.
#[derive(Default)]
pub(super) struct NewVertices {
    pub positions: Vec<f32>,
    pub attributes: Vec<f32>,
    pub protected: Vec<bool>,
}
impl NewVertices {
    pub fn count(&self) -> usize {
        self.positions.len() / 3
    }
}

/// Appends the created vertices to the buffer and returns the index of the first one. A unit
/// vector attribute the solve interpolated is brought back to length one; a colour is clamped
/// to its range; anything else is copied as solved.
pub(super) fn append(vertices: &mut DagVertices<'_>, new: &NewVertices) -> u32 {
    let first = vertices.count() as u32;
    vertices.positions.extend_from_slice(&new.positions);
    let stride = stride(vertices.attributes);
    let mut offset = 0usize;
    for attribute in vertices.attributes.iter_mut() {
        let width = attribute.width;
        for vertex in 0..new.count() {
            let at = vertex * stride + offset;
            let mut values = [0.0f32; 4];
            values[..width].copy_from_slice(&new.attributes[at..at + width]);
            match attribute.flag {
                FLAG_NORMAL => unit_in_place(&mut values),
                FLAG_COLOR => values.iter_mut().for_each(|v| *v = v.clamp(0.0, 1.0)),
                _ => {}
            }
            attribute.values.extend_from_slice(&values[..width]);
        }
        offset += width;
    }
    first
}

/// The first three components brought back to length one; a null vector becomes the up axis.
fn unit_in_place(values: &mut [f32; 4]) {
    let unit = crate::shared_math::normalized_or(
        [values[0] as f64, values[1] as f64, values[2] as f64],
        [0.0, 1.0, 0.0],
    );
    for (slot, value) in values.iter_mut().zip(unit) {
        *slot = value as f32;
    }
}
