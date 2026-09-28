//! The vertices a solved reduction places (`solved.rs`), first in its region's numbering, then
//! in the primitive's.
//!
//! The solve rewrites the region's vertices in place. One it kept bit for bit stays the source
//! vertex; every other one it kept becomes a placed vertex. In the region, placed vertices follow
//! its `n` source vertices, so the checks every reduction runs — lost locks, faces lit from
//! behind, removed parts, re-clustering — read one array. In the primitive they follow every
//! vertex it already has: the pages read them there, `source.bin` never does. A placed normal is
//! renormalised, a placed texture coordinate kept inside the region's source coordinates, so the
//! primitive's texture grid, set from its source span, still holds every page exactly (#283).
use super::clusters::position_key;
use super::*;
use crate::qem::solve::SolvedRegion;

/// The region after the solve, over its `n` source vertices then its placed ones.
pub(super) struct Local {
    pub n: usize,
    remap: Vec<u32>,
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
    pub source: Vec<u32>,
    pub indices: Vec<u32>,
}
impl Local {
    pub fn of(input: &GroupReductionInput, region: SolvedRegion, live: &[u32]) -> Self {
        let (n, stride) = (region.remap.len(), region.stride());
        let normals = input.attributes.normals().is_some();
        let mut used = vec![false; n];
        region.indices.iter().for_each(|&i| used[i as usize] = true);
        let origin: Vec<u32> = (0..n as u32)
            .filter(|&i| used[i as usize] && region.moved(i as usize))
            .collect();
        let mut id: Vec<u32> = (0..n as u32).collect();
        for (k, &i) in origin.iter().enumerate() {
            id[i as usize] = (n + k) as u32;
        }
        let (mut low, mut high) = (vec![f32::INFINITY; stride], vec![f32::NEG_INFINITY; stride]);
        for i in 0..n {
            for (c, &v) in row(&region.source_values, stride, i).iter().enumerate() {
                (low[c], high[c]) = (low[c].min(v), high[c].max(v));
            }
        }
        let mut values = Vec::with_capacity(origin.len() * stride);
        let mut positions = region.source;
        for &i in &origin {
            let i = i as usize;
            positions.extend_from_slice(&region.positions[i * 3..i * 3 + 3]);
            let (mut solved, source) = (
                row(&region.values, stride, i).to_vec(),
                row(&region.source_values, stride, i),
            );
            let first = if normals {
                let normal = [0, 1, 2].map(|c| f64::from(solved[c]));
                let unit = crate::shared_math::unit(normal).map(|n| n.map(|c| c as f32));
                solved[..3].copy_from_slice(unit.as_ref().map_or(&source[..3], |n| &n[..]));
                3
            } else {
                0
            };
            for c in first..stride {
                let within = solved[c].is_finite() && low[c] <= high[c];
                solved[c] = if within {
                    solved[c].clamp(low[c], high[c])
                } else {
                    source[c]
                };
            }
            values.extend(solved);
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
        let local: HashMap<u32, u32> = (0..n as u32).map(|i| (global(i) as u32, i)).collect();
        Self {
            extents: extents.map(|i| input.extents[global(i)]).collect(),
            source: live.iter().map(|v| local[v]).collect(),
            indices: region.indices.iter().map(|&i| id[i as usize]).collect(),
            n,
            remap: region.remap,
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
    /// The source vertices the solve kept as they were, in the primitive's numbering.
    pub fn kept(&self) -> Vec<u32> {
        let unmoved = self.indices.iter().filter(|&&i| (i as usize) < self.n);
        unmoved.map(|&i| self.remap[i as usize]).collect()
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
