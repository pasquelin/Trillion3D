//! The primitive's vertex arrays as its DAG grows them: the source's, then, level by level,
//! every vertex a solved reduction placed (`solved.rs`, `placed.rs`).
use super::attributes::key;
use super::placed::Local;
use super::welds::{Columns, Welds};
use super::{DagAttributes, GroupReduction, GroupReductionInput};
use crate::geometry_page::{Attribute as Carried, FLAG_UV, FLAG_UV1};
use std::collections::HashMap;

/// The source's positions and carried attributes followed by every placed vertex. The pages,
/// the cook's checks, the collider and the proxy read these; `source.bin` never does.
#[derive(Debug)]
pub struct Grown {
    pub positions: Vec<f32>,
    pub carried: Vec<Carried>,
    /// Per placed vertex, the source vertex it was solved from, through every level between.
    pub origin: Vec<u32>,
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
    /// whose vertex count was `base`; the reduction's clusters and the welds follow. The first
    /// placement copies the source's arrays once; a solve whose survivors all snapped back, never.
    pub(super) fn place(
        grown: &mut Option<Grown>,
        welds: &mut Welds,
        reduction: &mut GroupReduction,
        base: u32,
    ) {
        let (positions, attributes) = (welds.positions, welds.attributes);
        let Some(placed) = reduction.placed.take().filter(|p| !p.origins.is_empty()) else {
            return;
        };
        let offset = grown
            .as_ref()
            .map_or(0, |g| (g.positions.len() / 3) as u32 - base);
        let source = (positions.len() / 3) as u32;
        let shift = |v: u32| if v >= base { v + offset } else { v };
        for v in reduction.clusters.iter_mut().flatten() {
            *v = shift(*v);
        }
        let grown = grown.get_or_insert_with(|| Grown {
            positions: positions.to_vec(),
            carried: attributes
                .carried
                .iter()
                .map(|&a| Carried {
                    flag: a.flag,
                    width: a.width,
                    values: a.values.clone(),
                })
                .collect(),
            origin: Vec::new(),
        });
        for &o in &placed.origins {
            let origin = o
                .checked_sub(source)
                .map_or(o, |p| grown.origin[p as usize]);
            grown.origin.push(origin);
        }
        grown.positions.extend_from_slice(&placed.positions);
        for (attribute, values) in grown.carried.iter_mut().zip(&placed.carried) {
            attribute.values.extend_from_slice(values);
        }
        welds.extend(placed, shift);
    }
}

/// The vertices one solved reduction placed, numbered from its level's vertex count, with every
/// carried attribute, the level's vertex each was solved from and what the level's welds say.
pub(super) struct Placed {
    pub positions: Vec<f32>,
    /// Per carried attribute, in the build's order, `width` floats per placed vertex.
    pub carried: Vec<Vec<f32>>,
    pub origins: Vec<u32>,
    pub columns: Columns,
}

impl Local<'_> {
    /// The placed vertices, every carried attribute written: a weighed one solved, any other
    /// copied from the vertex it was solved from.
    pub fn placed(&self, input: &GroupReductionInput, base: u32) -> Placed {
        let carried = input.attributes.carried;
        let weighed = input.attributes.weighed();
        // Where each carried attribute sits in a solved row: the simplifier's order.
        let offset = |a: &Carried| {
            let at = weighed.iter().position(|&w| std::ptr::eq(w, a))?;
            Some(weighed[..at].iter().map(|w| w.width).sum::<usize>())
        };
        let placed = (self.n..self.n + self.origin.len()).map(|id| id as u32);
        let values: Vec<Vec<f32>> = carried
            .iter()
            .map(|&a| {
                let mut out = Vec::with_capacity(self.origin.len() * a.width);
                let offset = offset(a);
                for (k, id) in placed.clone().enumerate() {
                    out.extend_from_slice(match offset {
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
        let origins: Vec<u32> = placed.map(|id| self.from(id) as u32).collect();
        // Per placed vertex, the canonical vertex of what `by` keys: the source vertex it was
        // solved from where their keys agree, else the first placed vertex with its key.
        let canonical = |by: fn(u32) -> bool, of: &[u32]| -> Vec<u32> {
            let (own, source): (Vec<_>, Vec<_>) = (carried.iter())
                .zip(&values)
                .filter(|(a, _)| by(a.flag))
                .map(|(a, v)| ((&v[..], a.width), (&a.values[..], a.width)))
                .unzip();
            let mut seen: HashMap<Vec<u32>, u32> = HashMap::new();
            let mut out = Vec::with_capacity(origins.len());
            for (k, &g) in origins.iter().enumerate() {
                let g = g as usize;
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
        // Without a texture set there is no seam: the seam weld is the position weld.
        let textured = !input.seams.is_empty();
        let exact = canonical(|_| true, input.exact);
        let (weld_seam, seams) = match textured {
            false => (Vec::new(), Vec::new()),
            true => {
                let uv = |flag| flag == FLAG_UV || flag == FLAG_UV1;
                let weld_seam = canonical(uv, input.weld_seam);
                let mut split: HashMap<u32, (u32, bool)> = HashMap::new();
                for (&w, &s) in weld.iter().zip(&weld_seam) {
                    let entry = split.entry(w).or_insert((s, false));
                    entry.1 |= entry.0 != s;
                }
                let seam = |w: u32| split[&w].1 || (w < base && input.seams[w as usize]);
                let seams = weld.iter().map(|&w| seam(w)).collect();
                (weld_seam, seams)
            }
        };
        let charts = match input.charts.is_empty() {
            true => Vec::new(),
            false => origins.iter().map(|&g| input.charts[g as usize]).collect(),
        };
        Placed {
            positions,
            carried: values,
            origins,
            columns: Columns {
                weld_seam,
                extents: self.extents[self.n..].to_vec(),
                weld,
                exact,
                seams,
                charts,
            },
        }
    }
}
