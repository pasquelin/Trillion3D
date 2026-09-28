//! The vertices a solved reduction places (`solved.rs`), first in its region's numbering, then
//! in the primitive's.
//!
//! The solve rewrites the region's vertices in place. One it kept bit for bit stays the source
//! vertex; every other one it kept becomes a placed vertex. In the region, placed vertices follow
//! its `n` source vertices, so the checks every reduction runs — lost locks, faces lit from
//! behind, removed parts, re-clustering — read one array. In the primitive they follow every
//! vertex it already has: the pages read them there, `source.bin` never does. A placed normal is
//! renormalised; a value the solve left non-finite is its source's.
use super::clusters::position_key;
use super::*;
use crate::qem::solve::SolvedRegion;

/// The region after the solve, over its `n` source vertices then its placed ones.
pub(super) struct Local<'r> {
    pub n: usize,
    pub remap: &'r [u32],
    /// Per placed vertex, the region vertex it was solved from.
    pub origin: Vec<u32>,
    /// Weighed attributes of the placed vertices, finished, `stride` floats each.
    pub values: Vec<f32>,
    pub stride: usize,
    pub positions: Vec<f32>,
    pub normals: Option<Vec<f32>>,
    pub weld: Vec<u32>,
    pub extents: Vec<f64>,
    /// The group's live triangles, then the solve's, in the region's numbering.
    pub source: &'r [u32],
    pub indices: Vec<u32>,
}
impl<'r> Local<'r> {
    pub fn of(input: &GroupReductionInput, solved: SolvedRegion<'r>) -> Self {
        let region = solved.region;
        let (n, stride) = (region.remap.len(), solved.stride());
        let normals = input.attributes.normals().is_some();
        let mut used = vec![false; n];
        solved.indices.iter().for_each(|&i| used[i as usize] = true);
        let origin: Vec<u32> = (0..n as u32)
            .filter(|&i| used[i as usize] && solved.moved(i as usize))
            .collect();
        let mut id: Vec<u32> = (0..n as u32).collect();
        for (k, &i) in origin.iter().enumerate() {
            id[i as usize] = (n + k) as u32;
        }
        let mut values = Vec::with_capacity(origin.len() * stride);
        let mut positions = Vec::with_capacity(region.source.len() + origin.len() * 3);
        positions.extend_from_slice(&region.source);
        for &i in &origin {
            let i = i as usize;
            positions.extend_from_slice(&solved.positions[i * 3..i * 3 + 3]);
            let (mut placed, source) = (
                row(&solved.values, stride, i).to_vec(),
                row(&region.source_values, stride, i),
            );
            let first = if normals {
                let normal = [0, 1, 2].map(|c| f64::from(placed[c]));
                let unit = crate::shared_math::unit(normal).map(|n| n.map(|c| c as f32));
                placed[..3].copy_from_slice(unit.as_ref().map_or(&source[..3], |n| &n[..]));
                3
            } else {
                0
            };
            for (value, &from) in placed[first..].iter_mut().zip(&source[first..]) {
                *value = if value.is_finite() { *value } else { from };
            }
            values.extend(placed);
        }
        let normals = normals.then(|| {
            let rows = (0..n).map(|i| &region.source_values[i * stride..i * stride + 3]);
            let placed = values.chunks(stride.max(1)).map(|v| &v[..3]);
            rows.chain(placed).flatten().copied().collect()
        });
        let mut first: HashMap<u32, u32> = HashMap::new();
        let mut weld: Vec<u32> = (0..n as u32)
            .map(|i| {
                *first
                    .entry(input.weld[region.remap[i as usize] as usize])
                    .or_insert(i)
            })
            .collect();
        let mut seen: HashMap<[u32; 3], u32> = HashMap::new();
        for (k, &o) in origin.iter().enumerate() {
            let key = position_key(&positions, (n + k) as u32);
            weld.push(match key == position_key(&positions, o) {
                true => weld[o as usize],
                false => *seen.entry(key).or_insert((n + k) as u32),
            });
        }
        let global = |i: u32| region.remap[i as usize] as usize;
        let extents = (0..n as u32).chain(origin.iter().copied());
        Self {
            extents: extents.map(|i| input.extents[global(i)]).collect(),
            source: &region.compact,
            indices: solved.indices.iter().map(|&i| id[i as usize]).collect(),
            n,
            remap: &region.remap,
            origin,
            values,
            stride,
            positions,
            normals,
            weld,
        }
    }
    /// The region vertex `id` stands for: itself, or the one a placed vertex was solved from.
    pub fn from(&self, id: u32) -> usize {
        let id = id as usize;
        self.remap[if id < self.n {
            id
        } else {
            self.origin[id - self.n] as usize
        }] as usize
    }
    /// The level's vertices the solve kept as they were, one per corner that names one.
    pub fn kept(&self) -> Vec<u32> {
        let kept = self.indices.iter().filter(|&&i| (i as usize) < self.n);
        kept.map(|&i| self.remap[i as usize]).collect()
    }
    /// Per region vertex, its first copy by position and texture coordinates (the level's
    /// `weld_seam`); a placed vertex is its own, the only copy of what the solve wrote.
    pub fn weld_seam(&self, input: &GroupReductionInput) -> Vec<u32> {
        let mut first: HashMap<u32, u32> = HashMap::new();
        let source = self
            .remap
            .iter()
            .enumerate()
            .map(|(i, &v)| *first.entry(input.weld_seam[v as usize]).or_insert(i as u32));
        let placed = (self.n..self.n + self.origin.len()).map(|id| id as u32);
        source.chain(placed).collect()
    }
    /// `id` in the primitive's numbering: placed vertices from `base`.
    pub fn global(&self, id: u32, base: u32) -> u32 {
        match (id as usize) < self.n {
            true => self.remap[id as usize],
            false => base + id - self.n as u32,
        }
    }
}

/// The `stride` floats of vertex `i`.
fn row(values: &[f32], stride: usize, i: usize) -> &[f32] {
    &values[i * stride..(i + 1) * stride]
}
