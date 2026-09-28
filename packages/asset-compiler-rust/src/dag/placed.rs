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
use super::attributes::key;
use super::clusters::position_key;
use super::*;
use crate::geometry_page::{FLAG_NORMAL, FLAG_UV, FLAG_UV1};
use crate::qem::solve::SolvedRegion;

/// The vertices one solved reduction placed, numbered from its level's vertex count: their
/// positions, every carried attribute, and what the level's welds say of each.
pub(super) struct Placed {
    pub positions: Vec<f32>,
    /// Per carried attribute, in the build's order, `width` floats per placed vertex.
    pub carried: Vec<Vec<f32>>,
    /// Canonical vertex by position, by position and texture coordinates, and by everything a
    /// page stores (`attributes::Welds`).
    pub weld: Vec<u32>,
    pub weld_seam: Vec<u32>,
    pub exact: Vec<u32>,
    /// On a texture seam, on a mirror of the source (inherited); empty without a texture set.
    pub seams: Vec<bool>,
    pub mirrors: Vec<bool>,
    /// The extent of the part each was solved in (`vanished::part_extents`).
    pub extents: Vec<f64>,
}

/// The region after the solve, over its `n` source vertices then its placed ones.
pub(super) struct Local<'r> {
    pub n: usize,
    remap: &'r [u32],
    /// Per placed vertex, the region vertex it was solved from.
    origin: Vec<u32>,
    /// Weighed attributes of the placed vertices, finished, `stride` floats each.
    values: Vec<f32>,
    stride: usize,
    pub positions: Vec<f32>,
    pub normals: Option<Vec<f32>>,
    pub weld: Vec<u32>,
    pub extents: Vec<f64>,
    /// The group's live triangles, then the solve's, in the region's numbering.
    pub source: Vec<u32>,
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
        let (mut low, mut high) = (vec![f32::INFINITY; stride], vec![f32::NEG_INFINITY; stride]);
        for i in 0..n {
            for (c, &v) in row(&region.source_values, stride, i).iter().enumerate() {
                (low[c], high[c]) = (low[c].min(v), high[c].max(v));
            }
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
            for c in first..stride {
                let within = placed[c].is_finite() && low[c] <= high[c];
                placed[c] = if within {
                    placed[c].clamp(low[c], high[c])
                } else {
                    source[c]
                };
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
            source: region.compact.clone(),
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
    /// `id` in the primitive's numbering: placed vertices from `base`.
    pub fn global(&self, id: u32, base: u32) -> u32 {
        match (id as usize) < self.n {
            true => self.remap[id as usize],
            false => base + id - self.n as u32,
        }
    }

    /// The placed vertices, every carried attribute written: a weighed one solved, any other
    /// copied from the vertex it was solved from.
    pub fn placed(&self, input: &GroupReductionInput, base: u32) -> Placed {
        let carried = input.attributes.carried;
        let normals = usize::from(input.attributes.normals().is_some()) * 3;
        let uv0 = usize::from(carried.iter().any(|a| a.flag == FLAG_UV)) * 2;
        let offset = |flag| match flag {
            FLAG_NORMAL if normals > 0 => Some(0),
            FLAG_UV => Some(normals),
            FLAG_UV1 => Some(normals + uv0),
            _ => None,
        };
        let placed = (self.n..self.n + self.origin.len()).map(|id| id as u32);
        let values: Vec<Vec<f32>> = carried
            .iter()
            .map(|a| {
                let mut out = Vec::with_capacity(self.origin.len() * a.width);
                for (k, id) in placed.clone().enumerate() {
                    out.extend_from_slice(match offset(a.flag) {
                        Some(o) => &self.values[k * self.stride + o..][..a.width],
                        None => &a.values[self.from(id) * a.width..][..a.width],
                    });
                }
                out
            })
            .collect();
        let positions = self.positions[self.n * 3..].to_vec();
        // A placed vertex welded to a source one takes that position's canonical vertex, as the
        // level's weld names it: the region's first copy of it need not be the canonical one.
        let weld: Vec<u32> = placed
            .clone()
            .map(|id| match self.weld[id as usize] {
                w if (w as usize) < self.n => input.weld[self.from(w)],
                w => self.global(w, base),
            })
            .collect();
        let origins: Vec<usize> = placed.map(|id| self.from(id)).collect();
        // Per placed vertex, the canonical vertex of what `by` keys: the source vertex it was
        // solved from where their keys agree, else the first placed vertex with its key.
        let canonical = |by: fn(u32) -> bool, of: &[u32]| -> Vec<u32> {
            let own: Vec<(&[f32], usize)> = carried
                .iter()
                .zip(&values)
                .filter(|(a, _)| by(a.flag))
                .map(|(a, v)| (&v[..], a.width))
                .collect();
            let source: Vec<(&[f32], usize)> = carried
                .iter()
                .filter(|a| by(a.flag))
                .map(|a| (&a.values[..], a.width))
                .collect();
            let mut seen: HashMap<Vec<u32>, u32> = HashMap::new();
            let mut out = Vec::with_capacity(origins.len());
            for (k, &g) in origins.iter().enumerate() {
                let placed = key(&positions, k, own.iter().copied());
                out.push(
                    match placed == key(input.positions, g, source.iter().copied()) {
                        true => of[g],
                        false => *seen.entry(placed).or_insert(base + k as u32),
                    },
                );
            }
            out
        };
        let weld_seam = canonical(|flag| flag == FLAG_UV || flag == FLAG_UV1, input.weld_seam);
        let exact = canonical(|_| true, input.exact);
        let mut split: HashMap<u32, (u32, bool)> = HashMap::new();
        for (&w, &s) in weld.iter().zip(&weld_seam) {
            let entry = split.entry(w).or_insert((s, false));
            entry.1 |= entry.0 != s;
        }
        let seam = |w: u32| split[&w].1 || (w < base && input.seams[w as usize]);
        let seams = match input.seams.is_empty() {
            true => Vec::new(),
            false => weld.iter().map(|&w| seam(w)).collect(),
        };
        let mirrors = input.mirrors();
        let mirrors = match mirrors.is_empty() {
            true => Vec::new(),
            false => origins.iter().map(|&g| mirrors[g]).collect(),
        };
        Placed {
            extents: self.extents[self.n..].to_vec(),
            positions,
            carried: values,
            weld,
            weld_seam,
            exact,
            seams,
            mirrors,
        }
    }
}

/// The `stride` floats of vertex `i`.
fn row(values: &[f32], stride: usize, i: usize) -> &[f32] {
    &values[i * stride..(i + 1) * stride]
}
