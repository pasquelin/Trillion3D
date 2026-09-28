//! Region simplification that solves what it keeps: meshoptimizer's `simplifyWithUpdate`
//! (Hoppe 1999). The collapses are ranked as `qem::simplify_with_locked_vertices` ranks them —
//! absolute error, the weighed attributes counted, permissive across unprotected seams — then
//! every surviving vertex that is neither locked nor on a protected seam or an open border is
//! moved to the minimum of its accumulated quadric, and each of its copies' attributes solved at
//! that point. A seam corner written under several texture coordinates can then collapse, all
//! its copies moving together, each keeping a coordinate of its own.
use crate::qem::{compact_attributes, compact_region, region_extent, Attribute};
use crate::{invalid, Result};
use meshopt::SimplifyOptions;

/// A region the solve reduced, in its own compact vertex space.
pub struct SolvedRegion {
    /// Triangles over the compact vertices.
    pub indices: Vec<u32>,
    /// Per compact vertex, the source vertex it started from.
    pub remap: Vec<u32>,
    /// Three floats per compact vertex, before the solve and after it.
    pub source: Vec<f32>,
    pub positions: Vec<f32>,
    /// The weighed attributes, interleaved in the order of `attributes`, before and after.
    pub source_values: Vec<f32>,
    pub values: Vec<f32>,
    /// Object-space error of the collapses, clamped to the region's extent.
    pub error_object: f64,
}
impl SolvedRegion {
    /// Floats of the weighed attributes per compact vertex.
    pub fn stride(&self) -> usize {
        self.values.len() / self.remap.len().max(1)
    }
    /// Whether the solve rewrote compact vertex `local`: its position or a weighed attribute
    /// differs, bit for bit, from the source vertex it started from.
    pub fn moved(&self, local: usize) -> bool {
        let (p, s) = (local * 3, self.stride());
        let differs =
            |a: &[f32], b: &[f32]| a.iter().zip(b).any(|(x, y)| x.to_bits() != y.to_bits());
        differs(&self.positions[p..p + 3], &self.source[p..p + 3])
            || differs(
                &self.values[local * s..local * s + s],
                &self.source_values[local * s..local * s + s],
            )
    }
}

/// Puts back each value of `solved` that differs from its `source` by rounding alone: a few
/// ulps of the value, or of `scale` added to it.
fn snap(solved: &mut [f32], source: &[f32], scale: f32) {
    for (value, &from) in solved.iter_mut().zip(source) {
        if (*value - from).abs() <= 4.0 * f32::EPSILON * (from.abs() + scale) {
            *value = from;
        }
    }
}

/// Simplifies `indices` towards `target_triangles` and solves what survives; `flags` answers
/// `VERTEX_LOCK` and `VERTEX_PROTECT` per source vertex. `None` when no triangle went.
pub fn simplify_with_update(
    positions: &[f32],
    attributes: &[Attribute],
    indices: &[u32],
    target_triangles: usize,
    flags: &dyn Fn(u32) -> u8,
) -> Result<Option<SolvedRegion>> {
    if indices.len() < 3 || !indices.len().is_multiple_of(3) || !positions.len().is_multiple_of(3) {
        return Err(invalid(
            "A solved region needs whole triangles and positions",
        ));
    }
    let current = indices.len() / 3;
    if current <= target_triangles.max(1) {
        return Ok(None);
    }
    let (source, mut compact, remap) = compact_region(positions, indices);
    let flags: Vec<u8> = remap.iter().map(|&vertex| flags(vertex)).collect();
    let (source_values, weights) = compact_attributes(attributes, &remap);
    let (mut solved, mut values) = (source.clone(), source_values.clone());
    let mut result_error = 0.0_f32;
    let options = SimplifyOptions::ErrorAbsolute | SimplifyOptions::Permissive;
    // Every buffer is sized as the call reads it: `compact` holds whole triangles below
    // `remap.len()`, `solved` three floats and `values` one float per weight for each of those
    // vertices, `flags` one byte each.
    let count = unsafe {
        meshopt::ffi::meshopt_simplifyWithUpdate(
            compact.as_mut_ptr(),
            compact.len(),
            solved.as_mut_ptr(),
            remap.len(),
            12,
            values.as_mut_ptr(),
            weights.len() * 4,
            weights.as_ptr(),
            weights.len(),
            flags.as_ptr(),
            target_triangles.max(1) * 3,
            f32::MAX,
            options.bits(),
            &mut result_error,
        )
    };
    if count == 0 || count / 3 >= current {
        return Ok(None);
    }
    compact.truncate(count);
    let extent = region_extent(&source)?;
    // meshoptimizer writes every survivor it did not lock back through its own rescaling, a few
    // ulps off where it solved nothing: such a value is the source's, and the vertex stays one.
    snap(&mut solved, &source, extent as f32);
    snap(&mut values, &source_values, 0.0);
    Ok(Some(SolvedRegion {
        indices: compact,
        remap,
        source,
        positions: solved,
        source_values,
        values,
        error_object: (result_error as f64).min(extent),
    }))
}
