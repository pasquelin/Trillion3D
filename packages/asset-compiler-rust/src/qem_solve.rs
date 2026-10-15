//! THE REGION SIMPLIFIER of the cluster DAG, by the linked `meshopt` simplifier's
//! `simplifyWithUpdate`: the library ranks the collapses — absolute error, the weighed attributes
//! counted, permissive across every attribute discontinuity but a protected one — measures the
//! error, then moves every surviving vertex that is neither locked, on a protected seam nor on an
//! open border to the minimum of its accumulated quadric, each copy's attributes solved at that
//! point. This module compacts the region, sets its flags and weights, and reads back what moved.
//!
//! The region is handed over in a frame of its own: each axis from its least coordinate, divided
//! by the widest axis span, and every attribute already multiplied by its weight, with unit
//! weights. The library's own normalisation is then the identity — least coordinate 0, span 1,
//! weight 1 — so a value it writes back is bit for bit the one it solved: a vertex whose bits did
//! not change did not move, and stays the source vertex.
use crate::qem::{compact_attributes, compact_region, Attribute, VERTEX_LOCK, VERTEX_PROTECT};
use crate::{invalid, Result};
use meshopt::SimplifyOptions;

/// A region prepared once, in its own compact vertex space: its retries differ only in flags.
pub struct Region {
    /// The region's triangles over the compact vertices.
    pub compact: Vec<u32>,
    /// Per compact vertex, the source vertex it stands for.
    pub remap: Vec<u32>,
    /// Three floats per compact vertex, in object space.
    pub source: Vec<f32>,
    /// The weighed attributes, interleaved in the order of `attributes`, as written.
    pub source_values: Vec<f32>,
    weights: Vec<f32>,
    /// The positions in the region's own frame, and that frame: least corner and span.
    frame: Vec<f32>,
    low: [f32; 3],
    span: f32,
    /// `source_values` times their weights: what the library weighs and solves.
    weighed: Vec<f32>,
}

/// A simplification of a `Region`: what it kept and where it moved it.
pub struct SolvedRegion<'r> {
    pub region: &'r Region,
    /// Triangles over the compact vertices.
    pub indices: Vec<u32>,
    /// Three floats per compact vertex: the source's where it did not move, else the solve's.
    pub positions: Vec<f32>,
    /// The weighed attributes, unweighed: the source's where the vertex did not move.
    pub values: Vec<f32>,
    moved: Vec<bool>,
    /// Object-space error of the collapses, clamped to the region's span.
    pub error_object: f64,
}
impl SolvedRegion<'_> {
    /// Floats of the weighed attributes per compact vertex.
    pub fn stride(&self) -> usize {
        self.region.weights.len()
    }
    /// Whether the solve rewrote compact vertex `local`: its position or a weighed attribute.
    pub fn moved(&self, local: usize) -> bool {
        self.moved[local]
    }
}

impl Region {
    /// Compacts `indices` and the weighed `attributes` of their vertices, in the region's frame.
    pub fn of(positions: &[f32], attributes: &[Attribute], indices: &[u32]) -> Result<Self> {
        if indices.len() < 3
            || !indices.len().is_multiple_of(3)
            || !positions.len().is_multiple_of(3)
        {
            return Err(invalid("A region needs whole triangles and positions"));
        }
        let (source, compact, remap) = compact_region(positions, indices);
        let (source_values, weights) = compact_attributes(attributes, &remap);
        let points = source.as_chunks::<3>().0;
        let low = [0, 1, 2].map(|k| points.iter().map(|p| p[k]).fold(f32::MAX, f32::min));
        let high = [0, 1, 2].map(|k| points.iter().map(|p| p[k]).fold(-f32::MAX, f32::max));
        let span = (0..3).map(|k| high[k] - low[k]).fold(0.0f32, f32::max);
        let unit = |x: f32, k: usize| if span > 0.0 { (x - low[k]) / span } else { 0.0 };
        let frame = points
            .iter()
            .flat_map(|p| [0, 1, 2].map(|k| unit(p[k], k)))
            .collect();
        let stride = weights.len().max(1);
        let weighed = (source_values.iter().enumerate())
            .map(|(i, &v)| v * weights[i % stride])
            .collect();
        Ok(Self {
            compact,
            remap,
            source,
            source_values,
            weights,
            frame,
            low,
            span,
            weighed,
        })
    }

    /// Simplifies the region towards `target_triangles` and solves what survives. `flags` answers
    /// `VERTEX_LOCK` and `VERTEX_PROTECT` per source vertex; `prune` also removes the parts that
    /// fall under the error, ignoring locks. `None` when no triangle went.
    pub fn solve(
        &self,
        target_triangles: usize,
        prune: bool,
        flags: &dyn Fn(u32) -> u8,
    ) -> Option<SolvedRegion<'_>> {
        let current = self.compact.len() / 3;
        if current <= target_triangles.max(1) {
            return None;
        }
        let flags: Vec<u8> = self.remap.iter().map(|&v| flags(v)).collect();
        let mut options = SimplifyOptions::ErrorAbsolute | SimplifyOptions::Permissive;
        if prune {
            options |= SimplifyOptions::Prune;
        }
        // The library rewrites the indices, positions and values it is handed: each solve starts
        // from fresh copies. Every buffer is sized as the call reads it.
        let (mut indices, mut frame) = (self.compact.clone(), self.frame.clone());
        let mut weighed = self.weighed.clone();
        let unit = vec![1.0f32; self.weights.len()];
        let mut result_error = 0.0_f32;
        let count = unsafe {
            meshopt::ffi::meshopt_simplifyWithUpdate(
                indices.as_mut_ptr(),
                indices.len(),
                frame.as_mut_ptr(),
                self.remap.len(),
                12,
                weighed.as_mut_ptr(),
                unit.len() * 4,
                unit.as_ptr(),
                unit.len(),
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
        let (n, stride) = (self.remap.len(), self.weights.len());
        let differs =
            |a: &[f32], b: &[f32]| a.iter().zip(b).any(|(x, y)| x.to_bits() != y.to_bits());
        let moved: Vec<bool> = (0..n)
            .map(|i| {
                differs(&frame[i * 3..i * 3 + 3], &self.frame[i * 3..i * 3 + 3])
                    || differs(
                        &weighed[i * stride..][..stride],
                        &self.weighed[i * stride..][..stride],
                    )
            })
            .collect();
        let mut positions = self.source.clone();
        let mut values = self.source_values.clone();
        for i in (0..n).filter(|&i| moved[i]) {
            for k in 0..3 {
                positions[i * 3 + k] = frame[i * 3 + k] * self.span + self.low[k];
            }
            for k in 0..stride {
                values[i * stride + k] = weighed[i * stride + k] / self.weights[k];
            }
        }
        let span = f64::from(self.span);
        Some(SolvedRegion {
            region: self,
            indices,
            positions,
            values,
            moved,
            error_object: (f64::from(result_error) * span).min(span),
        })
    }
}

/// A region's flags for the simplifier: `VERTEX_LOCK` where `locked`, `VERTEX_PROTECT` where
/// `protected`.
pub fn flags(locked: bool, protected: bool) -> u8 {
    u8::from(locked) * VERTEX_LOCK | u8::from(protected) * VERTEX_PROTECT
}
