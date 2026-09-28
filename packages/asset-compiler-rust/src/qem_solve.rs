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

/// A region prepared once for the solve, in its own compact vertex space: its retries differ only
/// in their flags.
pub struct Region {
    /// The region's triangles over the compact vertices.
    pub compact: Vec<u32>,
    /// Per compact vertex, the source vertex it stands for.
    pub remap: Vec<u32>,
    /// Three floats per compact vertex.
    pub source: Vec<f32>,
    /// The weighed attributes, interleaved in the order of `attributes`.
    pub source_values: Vec<f32>,
    weights: Vec<f32>,
    /// The extent meshoptimizer normalises the positions by (`qem::region_extent`).
    extent: f64,
}

/// A solve of a `Region`: what it kept and where it moved it.
pub struct SolvedRegion<'r> {
    pub region: &'r Region,
    /// Triangles over the compact vertices.
    pub indices: Vec<u32>,
    /// Three floats per compact vertex, after the solve.
    pub positions: Vec<f32>,
    /// The weighed attributes after the solve.
    pub values: Vec<f32>,
    /// Object-space error of the collapses, clamped to the region's extent.
    pub error_object: f64,
}
impl SolvedRegion<'_> {
    /// Floats of the weighed attributes per compact vertex.
    pub fn stride(&self) -> usize {
        self.values.len() / self.region.remap.len().max(1)
    }
    /// Whether the solve rewrote compact vertex `local`: its position or a weighed attribute
    /// differs, bit for bit, from the source vertex it started from.
    pub fn moved(&self, local: usize) -> bool {
        let (p, s) = (local * 3, self.stride());
        let differs =
            |a: &[f32], b: &[f32]| a.iter().zip(b).any(|(x, y)| x.to_bits() != y.to_bits());
        differs(&self.positions[p..p + 3], &self.region.source[p..p + 3])
            || differs(
                &self.values[local * s..local * s + s],
                &self.region.source_values[local * s..local * s + s],
            )
    }
    /// The source vertices the solve kept as they were, one per corner that names one.
    pub fn kept(&self) -> Vec<u32> {
        let unmoved = self.indices.iter().filter(|&&i| !self.moved(i as usize));
        unmoved.map(|&i| self.region.remap[i as usize]).collect()
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

impl Region {
    /// Compacts `indices` and the weighed `attributes` of their vertices.
    pub fn of(positions: &[f32], attributes: &[Attribute], indices: &[u32]) -> Result<Self> {
        if indices.len() < 3
            || !indices.len().is_multiple_of(3)
            || !positions.len().is_multiple_of(3)
        {
            return Err(invalid(
                "A solved region needs whole triangles and positions",
            ));
        }
        let (source, compact, remap) = compact_region(positions, indices);
        let (source_values, weights) = compact_attributes(attributes, &remap);
        Ok(Self {
            extent: region_extent(&source)?,
            compact,
            remap,
            source,
            source_values,
            weights,
        })
    }

    /// Simplifies the region towards `target_triangles` and solves what survives; `flags`
    /// answers `VERTEX_LOCK` and `VERTEX_PROTECT` per source vertex. `None` when no triangle went.
    pub fn solve(
        &self,
        target_triangles: usize,
        flags: &dyn Fn(u32) -> u8,
    ) -> Option<SolvedRegion<'_>> {
        let current = self.compact.len() / 3;
        if current <= target_triangles.max(1) {
            return None;
        }
        let flags: Vec<u8> = self.remap.iter().map(|&vertex| flags(vertex)).collect();
        // meshoptimizer rewrites the indices, positions and values it is handed: each solve
        // starts from fresh copies, the region's own stay the source.
        let mut indices = self.compact.clone();
        let (mut solved, mut values) = (self.source.clone(), self.source_values.clone());
        let mut result_error = 0.0_f32;
        let options = SimplifyOptions::ErrorAbsolute | SimplifyOptions::Permissive;
        // Every buffer is sized as the call reads it: `indices` holds whole triangles below
        // `remap.len()`, `solved` three floats and `values` one float per weight for each of
        // those vertices, `flags` one byte each.
        let count = unsafe {
            meshopt::ffi::meshopt_simplifyWithUpdate(
                indices.as_mut_ptr(),
                indices.len(),
                solved.as_mut_ptr(),
                self.remap.len(),
                12,
                values.as_mut_ptr(),
                self.weights.len() * 4,
                self.weights.as_ptr(),
                self.weights.len(),
                flags.as_ptr(),
                target_triangles.max(1) * 3,
                f32::MAX,
                options.bits(),
                &mut result_error,
            )
        };
        if count == 0 || count / 3 >= current {
            return None;
        }
        indices.truncate(count);
        // meshoptimizer writes every survivor it did not lock back through its own rescaling, a
        // few ulps off where it solved nothing: such a value is the source's, and the vertex
        // stays one.
        snap(&mut solved, &self.source, self.extent as f32);
        snap(&mut values, &self.source_values, 0.0);
        Some(SolvedRegion {
            region: self,
            indices,
            positions: solved,
            values,
            error_object: (result_error as f64).min(self.extent),
        })
    }
}
