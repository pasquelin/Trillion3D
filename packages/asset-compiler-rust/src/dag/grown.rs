//! The primitive's vertex arrays as its DAG grows them: the source's, then, level by level,
//! every vertex a solved reduction placed (`solved.rs`, `placed.rs`).
use super::attributes::{key, Key};
use super::placed::Local;
use super::welds::{Columns, Welds};
use super::{DagAttributes, GroupReductionInput};
use trillion3d_page_codec::encode::Attribute;
use trillion3d_page_codec::hash::{word_map, WordMap};
use trillion3d_page_codec::{FLAG_UV, FLAG_UV1};

/// The source's positions and carried attributes followed by every placed vertex. The pages,
/// the cook's checks, the collider and the proxy read these; `source.bin` never does.
#[derive(Debug)]
pub struct Grown {
    pub positions: Vec<f32>,
    pub carried: Vec<Attribute>,
    /// Per placed vertex, the source vertex it was solved from, through every level between.
    pub origin: Vec<u32>,
}
impl Grown {
    /// The vertex arrays a stage reads: the grown ones, or the source's when nothing was placed.
    pub fn arrays<'a>(
        grown: &'a Option<Grown>,
        positions: &'a [f32],
        attributes: DagAttributes<'a>,
    ) -> (&'a [f32], Vec<&'a Attribute>) {
        match grown {
            Some(grown) => (&grown.positions, grown.carried.iter().collect()),
            None => (positions, attributes.carried.to_vec()),
        }
    }
    /// Appends the vertices a reduction `placed`, if any, after those already placed at its
    /// level, whose vertex count was `base`; the reduction's `clusters` and the welds follow. The
    /// first placement copies the source's arrays once; a solve that moved nothing, never.
    pub(super) fn place(
        grown: &mut Option<Grown>,
        welds: &mut Welds,
        placed: Placed,
        clusters: &mut [Vec<u32>],
        base: u32,
    ) {
        if placed.origins.is_empty() {
            return;
        }
        let (positions, attributes) = (welds.positions, welds.attributes);
        let offset = grown
            .as_ref()
            .map_or(0, |g| (g.positions.len() / 3) as u32 - base);
        let source = (positions.len() / 3) as u32;
        let shift = |v: u32| if v >= base { v + offset } else { v };
        for v in clusters.iter_mut().flatten() {
            *v = shift(*v);
        }
        let grown = grown.get_or_insert_with(|| Grown {
            positions: positions.to_vec(),
            carried: attributes.carried.iter().map(|&a| a.clone()).collect(),
            origin: Vec::new(),
        });
        for &o in &placed.origins {
            let origin = o
                .checked_sub(source)
                .map_or(o, |p| grown.origin[p as usize]);
            grown.origin.push(origin);
        }
        grown.positions.extend(placed.positions);
        for (attribute, values) in grown.carried.iter_mut().zip(placed.carried) {
            attribute.values.extend(values);
        }
        welds.extend(placed.columns, shift);
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
        let weighted = input.weighted;
        // Where each carried attribute sits in a solved row: the simplifier's order.
        let offset = |a: &Attribute| {
            let at = (weighted.iter()).position(|w| std::ptr::eq(w.values, &a.values[..]))?;
            Some(weighted[..at].iter().map(|w| w.width).sum::<usize>())
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
        // The keys `by` names of the placed vertices and of the level's vertices.
        let (at, level_positions) = (&positions[..], input.positions);
        let keys = |by: fn(u32) -> bool| {
            let (own, source): (Vec<_>, Vec<_>) = (carried.iter())
                .zip(&values)
                .filter(|(a, _)| by(a.flag))
                .map(|(a, v)| ((&v[..], a.width), (&a.values[..], a.width)))
                .unzip();
            let placed = move |k: usize| key(at, k, own.iter().copied());
            let level = move |v: usize| key(level_positions, v, source.iter().copied());
            (placed, level)
        };
        // Per placed vertex, the canonical vertex of what `by` keys: the region's source vertex
        // with its key, else the first placed vertex with it — vertices equal in every float the
        // pages store are one vertex to the next level.
        let canonical = |by: fn(u32) -> bool, of: &[u32]| -> Vec<u32> {
            let (placed, level) = keys(by);
            let mut seen: WordMap<Key, u32> = word_map(self.n + origins.len());
            for &v in self.remap {
                let v = v as usize;
                seen.entry(level(v)).or_insert(of[v]);
            }
            (0..origins.len())
                .map(|k| *seen.entry(placed(k)).or_insert(base + k as u32))
                .collect()
        };
        let weld_seam = canonical(|flag| flag == FLAG_UV || flag == FLAG_UV1, input.weld_seam);
        let exact = canonical(|_| true, input.exact);
        Placed {
            positions,
            carried: values,
            origins,
            columns: Columns {
                weld_seam,
                weld,
                exact,
            },
        }
    }
}
