//! The primitive's vertex arrays as its DAG grows them: the source's, then, level by level,
//! every vertex a solved reduction placed (`solved.rs`, `placed.rs`).
use super::attributes::key;
use super::attributes::Welds;
use super::placed::Local;
use super::{DagAttributes, GroupReduction, GroupReductionInput};
use crate::geometry_page::{Attribute as Carried, FLAG_NORMAL, FLAG_UV, FLAG_UV1};
use std::collections::HashMap;

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

/// The source's positions and carried attributes followed by every placed vertex. The pages,
/// the cook's checks, the collider and the proxy read these; `source.bin` never does.
#[derive(Debug)]
pub struct Grown {
    pub positions: Vec<f32>,
    pub carried: Vec<Carried>,
}
impl Grown {
    /// The vertex arrays a stage reads: the grown ones, or the source's when nothing was placed.
    pub fn arrays<'a>(
        grown: &'a Option<Grown>,
        positions: &'a [f32],
        attributes: DagAttributes<'a>,
    ) -> (&'a [f32], Vec<&'a Carried>) {
        match grown {
            Some(grown) => (&grown.positions, grown.carried.iter().collect()),
            None => (positions, attributes.carried.to_vec()),
        }
    }
    /// Appends the vertices `reduction` placed, if any, after those already placed at its level,
    /// whose vertex count was `base`; the reduction's clusters and the welds follow.
    pub(super) fn place(
        grown: &mut Option<Grown>,
        (positions, attributes): (&[f32], DagAttributes),
        welds: &mut Welds,
        reduction: &mut GroupReduction,
        base: u32,
    ) {
        let Some(placed) = reduction.placed.take() else {
            return;
        };
        let offset = grown
            .as_ref()
            .map_or(0, |g| (g.positions.len() / 3) as u32 - base);
        let shift = |v: u32| if v >= base { v + offset } else { v };
        reduction
            .clusters
            .iter_mut()
            .flatten()
            .for_each(|v| *v = shift(*v));
        let grown = grown.get_or_insert_with(|| Grown {
            positions: positions.to_vec(),
            carried: attributes.carried.iter().map(|&a| a.clone()).collect(),
        });
        grown.positions.extend(placed.positions);
        for (attribute, values) in grown.carried.iter_mut().zip(placed.carried) {
            attribute.values.extend(values);
        }
        welds.weld.extend(placed.weld.into_iter().map(shift));
        if let Some(weld_seam) = &mut welds.weld_seam {
            weld_seam.extend(placed.weld_seam.into_iter().map(shift));
        }
        welds.exact.extend(placed.exact.into_iter().map(shift));
        welds.seams.extend(placed.seams);
        welds.mirrors.extend(placed.mirrors);
        welds.extents.extend(placed.extents);
    }
}

impl Local {
    /// The placed vertices, every carried attribute written: a weighed one solved, any other
    /// copied from the vertex it was solved from.
    pub(super) fn placed(&self, input: &GroupReductionInput, base: u32) -> Placed {
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
                let copy = |k: usize, id: u32| match offset(a.flag) {
                    Some(o) => self.values[k * self.stride + o..][..a.width].to_vec(),
                    None => a.values[self.from(id) * a.width..][..a.width].to_vec(),
                };
                placed
                    .clone()
                    .enumerate()
                    .flat_map(|(k, id)| copy(k, id))
                    .collect()
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
        let origins: Vec<usize> = placed.clone().map(|id| self.from(id)).collect();
        let canonical = |by: &dyn Fn(u32) -> bool, of: &[u32]| {
            let mut seen: HashMap<Vec<u32>, u32> = HashMap::new();
            let own = carried.iter().zip(&values).filter(|(a, _)| by(a.flag));
            let source = carried.iter().filter(|a| by(a.flag));
            let own = |k| key(&positions, k, own.clone().map(|(a, v)| (&v[..], a.width)));
            let source = |g| {
                key(
                    input.positions,
                    g,
                    source.clone().map(|a| (&a.values[..], a.width)),
                )
            };
            let first = |(k, &g): (usize, &usize)| match own(k) {
                key if key == source(g) => of[g],
                key => *seen.entry(key).or_insert(base + k as u32),
            };
            origins.iter().enumerate().map(first).collect::<Vec<u32>>()
        };
        let weld_seam = canonical(&|flag| flag == FLAG_UV || flag == FLAG_UV1, input.weld_seam);
        let exact = canonical(&|_| true, input.exact);
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
        let mirrors = match input.mirrors.is_empty() {
            true => Vec::new(),
            false => origins.iter().map(|&g| input.mirrors[g]).collect(),
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
