//! The vertices a solved reduction places (`solved.rs`), first in its region's numbering, then
//! in the primitive's.
//!
//! The solve moves the region's vertices: one it left as it was stays the source vertex; every
//! other one it kept becomes a placed vertex, its normal and colour already corrected by the
//! simplifier (`qem::Corrected`). In the region, placed vertices follow its `n` source vertices,
//! so re-clustering reads one array. In the primitive they follow every vertex it already has: the pages read them there, `source.bin`
//! never does.
use super::clusters::position_key;
use super::*;
use crate::qem::solve::{Region, SolvedRegion};

/// What a region's vertices weld to under the level's weld, computed once per region: per region
/// vertex its first copy, and per position the copy that stands for it.
pub(super) struct RegionWeld {
    first: Vec<u32>,
    by_position: WordMap<[u32; 3], u32>,
}
impl RegionWeld {
    pub fn of(input: &GroupReductionInput, region: &Region) -> Self {
        let mut by_level: WordMap<u32, u32> = word_map(region.remap.len());
        let first: Vec<u32> = (region.remap.iter().enumerate())
            .map(|(i, &v)| *by_level.entry(input.weld[v as usize]).or_insert(i as u32))
            .collect();
        let mut by_position: WordMap<[u32; 3], u32> = word_map(region.remap.len());
        for (i, &copy) in first.iter().enumerate() {
            by_position.insert(position_key(&region.source, i as u32), copy);
        }
        Self { first, by_position }
    }
}

/// The region after the solve, over its `n` source vertices then its placed ones.
pub(super) struct Local<'r> {
    pub n: usize,
    pub remap: &'r [u32],
    /// Per placed vertex, the region vertex it was solved from.
    pub origin: Vec<u32>,
    /// Weighed attributes of the placed vertices, `stride` floats each.
    pub values: Vec<f32>,
    pub stride: usize,
    pub positions: Vec<f32>,
    pub weld: Vec<u32>,
    /// The solve's triangles, in the region's numbering.
    pub indices: Vec<u32>,
}
impl<'r> Local<'r> {
    pub fn of(solved: SolvedRegion<'r>, region_weld: &RegionWeld) -> Self {
        let region = solved.region;
        let (n, stride) = (region.remap.len(), solved.stride());
        // The solve marks moved only the vertices its triangles use.
        let origin: Vec<u32> = (0..n as u32)
            .filter(|&i| solved.moved(i as usize))
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
            values.extend_from_slice(&solved.values[i * stride..(i + 1) * stride]);
        }
        // A placed vertex welds to the region's copy at its position, if one lies there, or to the
        // first placed vertex at it.
        let mut weld = region_weld.first.clone();
        let mut placed_at: WordMap<[u32; 3], u32> = WordMap::default();
        for k in 0..origin.len() {
            let key = position_key(&positions, (n + k) as u32);
            weld.push(match region_weld.by_position.get(&key) {
                Some(&copy) => copy,
                None => *placed_at.entry(key).or_insert((n + k) as u32),
            });
        }
        Self {
            indices: solved.indices.iter().map(|&i| id[i as usize]).collect(),
            n,
            remap: &region.remap,
            origin,
            values,
            stride,
            positions,
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
    /// `id` in the primitive's numbering: placed vertices from `base`.
    pub fn global(&self, id: u32, base: u32) -> u32 {
        match (id as usize) < self.n {
            true => self.remap[id as usize],
            false => base + id - self.n as u32,
        }
    }
}
