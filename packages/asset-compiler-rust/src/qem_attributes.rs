//! Region simplification with attribute quadrics and vertex update: meshoptimizer's
//! `simplifyWithUpdate`, which collapses edges on an error that includes the weighed attributes,
//! then solves every surviving vertex — position and attributes — to the minimum of its
//! accumulated quadric. A locked vertex is neither moved nor rewritten; a vertex on an attribute
//! seam or a mesh border keeps its position and only its attributes are solved.
//!
//! The simplifier runs permissive: a copied position — a hard edge, a vertex colour step — may
//! collapse across its seam, all copies moving together and their attributes solved afterwards,
//! except where a copy is flagged `PROTECT`: there the seam is kept and only slid along.
use crate::qem::compact_region;
use crate::{invalid, Result};
use meshopt::{SimplifyOptions, VertexDataAdapter};

/// Per-vertex flag: the vertex is neither moved nor rewritten.
pub const LOCK: u8 = 1;
/// Per-vertex flag: the attribute seam at this vertex is kept; the position may still slide
/// along it.
pub const PROTECT: u8 = 2;

/// A region after simplification, in its own local vertex space: `positions` and `attributes`
/// are the region's vertices as solved, `remap` names in the source buffer the vertex each local
/// one started from, and `indices` reference the local vertices.
pub struct UpdatedRegion {
    pub indices: Vec<u32>,
    pub positions: Vec<f32>,
    /// Interleaved, `stride` floats per local vertex.
    pub attributes: Vec<f32>,
    pub remap: Vec<u32>,
    /// Object-space error of the collapses: distance to the surface and weighed attribute
    /// deviation, in the units of `positions`. The solve that follows the collapses is not in
    /// it: `displacement` measures how far it moved a vertex.
    pub error_object: f64,
}
impl UpdatedRegion {
    /// Object-space distance between a local vertex as solved and the source position it
    /// started from. What the solve did to the attributes is not a distance: the collapse
    /// error carries the attribute terms, as the simplifier weighs them.
    pub fn displacement(&self, local: usize, source: &[f32]) -> f64 {
        self.positions[local * 3..local * 3 + 3]
            .iter()
            .zip(source)
            .map(|(solved, from)| (*solved as f64 - *from as f64).powi(2))
            .sum::<f64>()
            .sqrt()
    }
}

/// Simplifies a region to `target_triangles`, with `flags` — `LOCK`, `PROTECT` — queried on
/// source vertex indices and `gather` producing the interleaved attributes of the region's
/// vertices, `weights.len()` per vertex. `None` when the simplifier removed no triangle: the
/// region is then what it was.
pub fn simplify_region_with_attributes(
    positions: &[f32],
    indices: &[u32],
    gather: &dyn Fn(&[u32]) -> Vec<f32>,
    weights: &[f32],
    target_triangles: usize,
    target_error: f32,
    flags: &dyn Fn(u32) -> u8,
) -> Result<Option<UpdatedRegion>> {
    if indices.len() < 3 || !indices.len().is_multiple_of(3) {
        return Err(invalid("Index count must be a positive multiple of three"));
    }
    if !positions.len().is_multiple_of(3) {
        return Err(invalid("POSITION count must be a multiple of three"));
    }
    let current = indices.len() / 3;
    if current <= target_triangles.max(1) || weights.len() > 32 {
        return Ok(None);
    }
    let (mut compact_pos, mut compact_idx, remap) = compact_region(positions, indices);
    let mut attributes = gather(&remap);
    let stride = weights.len();
    if attributes.len() != remap.len() * stride {
        return Err(invalid(
            "Attribute count differs from the region's vertices",
        ));
    }
    let locks: Vec<u8> = remap.iter().map(|&s| flags(s)).collect();
    let scale = {
        let bytes = unsafe {
            std::slice::from_raw_parts(compact_pos.as_ptr() as *const u8, compact_pos.len() * 4)
        };
        let vertices =
            VertexDataAdapter::new(bytes, 12, 0).map_err(|_| invalid("POSITION adapter"))?;
        meshopt::simplify::simplify_scale(&vertices) as f64
    };
    let mut result_error = 0.0_f32;
    // Every pointer names a buffer sized as the call requires: `compact_idx` holds
    // `index_count` indices below `vertex_count`, positions and attributes hold one row per
    // vertex at the declared strides, `locks` one byte per vertex, `weights` one per attribute.
    let count = unsafe {
        meshopt::ffi::meshopt_simplifyWithUpdate(
            compact_idx.as_mut_ptr(),
            compact_idx.len(),
            compact_pos.as_mut_ptr(),
            remap.len(),
            12,
            attributes.as_mut_ptr(),
            stride * 4,
            weights.as_ptr(),
            stride,
            locks.as_ptr(),
            target_triangles.max(1) * 3,
            target_error,
            SimplifyOptions::Permissive.bits(),
            &mut result_error,
        )
    };
    let triangles = count / 3;
    if count == 0 || triangles >= current {
        return Ok(None);
    }
    compact_idx.truncate(count);
    Ok(Some(UpdatedRegion {
        indices: compact_idx,
        positions: compact_pos,
        attributes,
        remap,
        error_object: (result_error as f64) * scale,
    }))
}

#[cfg(test)]
#[path = "qem_attributes_tests.rs"]
mod tests;
