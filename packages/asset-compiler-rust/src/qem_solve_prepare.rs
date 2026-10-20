//! The region's simplifier, built from the region in its frame, and what it leaves of it.
use super::simplifier::{Input, Simplifier};
use super::{Region, SolvedRegion};

impl Region {
    /// The simplifier of the region in its frame.
    pub(super) fn build(&self) -> Simplifier {
        Simplifier::new(&Input {
            positions: &self.frame,
            values: &self.source_values,
            weights: &self.weights,
            corrected: self.corrected,
            locked: &self.locked,
            triangles: &self.compact,
            materials: &self.materials,
        })
    }

    /// The region as it is, at zero error.
    pub(super) fn unsimplified(&self) -> SolvedRegion<'_> {
        SolvedRegion {
            region: self,
            indices: self.compact.clone(),
            positions: self.source.clone(),
            values: self.source_values.clone(),
            moved: vec![false; self.remap.len()],
            error_object: 0.0,
        }
    }

    /// What `simplifier` left of the region at `error`: its triangles over the compact vertices,
    /// the positions — brought back from the frame — and attributes it rewrote, and its error in
    /// object space.
    pub(super) fn assembled(&self, simplifier: &Simplifier, error: f32) -> SolvedRegion<'_> {
        let (n, stride) = (self.remap.len(), self.weights.len());
        let mut positions = self.source.clone();
        let mut values = self.source_values.clone();
        let mut moved = vec![false; n];
        let indices = simplifier.remaining();
        let inverse = 1.0 / self.scale;
        let same = |a: &[f32], b: &[f32]| a.iter().zip(b).all(|(x, y)| x.to_bits() == y.to_bits());
        for &v in &indices {
            let v = v as usize;
            let (p, attributes) = simplifier.vertex(v);
            let built = (
                &self.frame[v * 3..v * 3 + 3],
                &self.source_values[v * stride..][..stride],
            );
            if moved[v] || (same(&p, built.0) && same(attributes, built.1)) {
                continue;
            }
            moved[v] = true;
            positions[v * 3..v * 3 + 3].copy_from_slice(&p.map(|x| x * inverse));
            values[v * stride..(v + 1) * stride].copy_from_slice(attributes);
        }
        SolvedRegion {
            region: self,
            indices,
            positions,
            values,
            moved,
            error_object: f64::from(error.sqrt() * inverse),
        }
    }
}

/// Per triangle, one bit per texture set laid on it mirrored — its texture's orientation turned
/// against its winding. A chart and its mirror image meet along an edge where the texture's frame
/// flips: the simplifier treats triangles of different bits as different materials, so that
/// edge stays a border and no collapse spreads one side's orientation over the other.
pub(super) fn mirrored(
    triangles: &[u32],
    values: &[f32],
    stride: usize,
    uv_offsets: &[usize],
) -> Vec<u32> {
    let uv = |v: u32, at: usize| {
        let i = v as usize * stride + at;
        [values[i], values[i + 1]]
    };
    (triangles.as_chunks::<3>().0.iter())
        .map(|t| {
            let mut bits = 0u32;
            for (set, &at) in uv_offsets.iter().enumerate() {
                let ([u0, v0], [u1, v1], [u2, v2]) = (uv(t[0], at), uv(t[1], at), uv(t[2], at));
                let signed = (u1 - u0) * (v2 - v0) - (v1 - v0) * (u2 - u0);
                bits |= u32::from(signed >= 0.0) << set;
            }
            bits
        })
        .collect()
}
