//! Region simplification on attribute quadrics, placed on the region's own vertices.
//!
//! meshoptimizer's `simplifyWithAttributes`: the collapse error carries the distance to the
//! surface **and** the deviation of every weighed attribute (Garland & Heckbert 1998; Hoppe
//! 1999), and the surviving endpoint of each collapse is one of the two it started from —
//! subset placement, as Garland & Heckbert 1997 describes it and as `qem-endpoints` already
//! works. The quadric ranks the collapses; it never invents a vertex.
//!
//! That is what keeps a texture where it was painted. A drawn vertex is a source vertex with
//! its own texture coordinate, so the parameterisation of the coarse surface is a restriction
//! of the source's and the pattern cannot slide — the texture deviation of Cohen, Olano &
//! Manocha 1998 is zero at every vertex by construction. Solving each survivor to the joint
//! minimum of position and attributes would place it off the source vertices, and a surface
//! drawn there with the source attributes slides the pattern by the in-surface part of the
//! move; storing the solved attributes instead would cost a vertex per survivor.
//!
//! The simplifier runs permissive: a copied position — a hard edge, a vertex colour step — may
//! collapse across its seam, all copies moving together, except where a copy is flagged
//! `PROTECT`: there the seam is kept and only slid along.
use crate::qem::{compact_region, SimplifiedMesh};
use crate::{invalid, Result};
use meshopt::{SimplifyOptions, VertexDataAdapter};

/// Per-vertex flag: the vertex is never collapsed away.
pub const LOCK: u8 = 1;
/// Per-vertex flag: the attribute seam at this vertex is kept; the position may still slide
/// along it.
pub const PROTECT: u8 = 2;
/// Weighed components one call may carry, as `kMaxAttributes` sets it.
const MAX_COMPONENTS: usize = 32;

/// Simplifies a region to `target_triangles`, with `flags` — `LOCK`, `PROTECT` — queried on
/// source vertex indices and `gather` producing the interleaved attributes of the region's
/// vertices, `weights.len()` per vertex.
///
/// `weights` are object units per unit of their component (`dag/attributes.rs`); they are
/// divided here by the region's extent, which is what the simplifier rescales positions by
/// before the two terms are added. `target_error` is read against that same extent. What comes
/// back is absolute — `ErrorAbsolute` multiplies the simplifier's own error by the extent
/// again — so the errors of two regions of one primitive are in the same units and the DAG may
/// compare them, exactly as `qem-endpoints` does. A region the simplifier did not reduce comes
/// back as it went in, at error zero.
pub fn simplify_region_with_attributes(
    positions: &[f32],
    indices: &[u32],
    gather: &dyn Fn(&[u32]) -> Vec<f32>,
    weights: &[f32],
    target_triangles: usize,
    target_error: f32,
    flags: &dyn Fn(u32) -> u8,
) -> Result<SimplifiedMesh> {
    if indices.len() < 3 || !indices.len().is_multiple_of(3) {
        return Err(invalid("Index count must be a positive multiple of three"));
    }
    if !positions.len().is_multiple_of(3) {
        return Err(invalid("POSITION count must be a multiple of three"));
    }
    let current = indices.len() / 3;
    let unchanged = || SimplifiedMesh {
        indices: indices.to_vec(),
        error_object: 0.0,
        triangles: current,
    };
    if current <= target_triangles.max(1) || weights.len() > MAX_COMPONENTS {
        return Ok(unchanged());
    }
    let (compact_pos, compact_idx, remap) = compact_region(positions, indices);
    let attributes = gather(&remap);
    let stride = weights.len();
    if attributes.len() != remap.len() * stride {
        return Err(invalid(
            "Attribute count differs from the region's vertices",
        ));
    }
    let locks: Vec<u8> = remap.iter().map(|&s| flags(s)).collect();
    let bytes = unsafe {
        std::slice::from_raw_parts(compact_pos.as_ptr() as *const u8, compact_pos.len() * 4)
    };
    let vertices = VertexDataAdapter::new(bytes, 12, 0).map_err(|_| invalid("POSITION adapter"))?;
    let scale = meshopt::simplify::simplify_scale(&vertices) as f64;
    let scaled: Vec<f32> = weights
        .iter()
        .map(|w| if scale > 0.0 { w / scale as f32 } else { 0.0 })
        .collect();
    let mut result_error = 0.0_f32;
    let mut out = vec![0u32; compact_idx.len()];
    // Every pointer names a buffer sized as the call requires: `out` holds room for every input
    // index, `compact_idx` holds `index_count` indices below `vertex_count`, positions and
    // attributes hold one row per vertex at the declared strides, `locks` one byte per vertex,
    // `scaled` one weight per attribute component.
    let count = unsafe {
        meshopt::ffi::meshopt_simplifyWithAttributes(
            out.as_mut_ptr(),
            compact_idx.as_ptr(),
            compact_idx.len(),
            compact_pos.as_ptr(),
            remap.len(),
            12,
            attributes.as_ptr(),
            stride * 4,
            scaled.as_ptr(),
            stride,
            locks.as_ptr(),
            target_triangles.max(1) * 3,
            target_error * scale as f32,
            (SimplifyOptions::Permissive | SimplifyOptions::ErrorAbsolute).bits(),
            &mut result_error,
        )
    };
    let triangles = count / 3;
    if count == 0 || triangles >= current {
        return Ok(unchanged());
    }
    out.truncate(count);
    Ok(SimplifiedMesh {
        indices: out.into_iter().map(|local| remap[local as usize]).collect(),
        error_object: result_error as f64,
        triangles,
    })
}

#[cfg(test)]
#[path = "qem_attributes_sheet_tests.rs"]
mod sheet_tests;
#[cfg(test)]
#[path = "qem_attributes_tests.rs"]
mod tests;
