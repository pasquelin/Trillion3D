//! The primitive's vertex arrays as its DAG grows them: the source's as the build reads them
//! (`input.rs`), then, level by level, every vertex a solved reduction placed (`solved.rs`,
//! `placed.rs`).
use super::attributes::{key, row_offset, Key};
use super::placed::Local;
use super::welds::{Columns, Welds};
use super::{DagAttributes, GroupReductionInput};
use trillion3d_page_codec::encode::Attribute;
use trillion3d_page_codec::hash::{word_map, WordMap};
use trillion3d_page_codec::{FLAG_SKIN, UV_FLAGS};

/// The source's positions and carried attributes as the build reads them, followed by every
/// placed vertex. The pages, the cook's checks, the collider and the proxy read these
/// (`Grown::arrays`); `source.bin` never does.
#[derive(Debug)]
pub struct Grown {
    pub positions: Vec<f32>,
    pub carried: Vec<Attribute>,
    /// Per vertex past the source's, the source vertex it deforms as: for a piece the build cut
    /// from a source vertex (`input::frames`), that vertex; for a placed vertex, through every
    /// level between, the one whose bones it took (`Local::placed`).
    pub origin: Vec<u32>,
}
impl Grown {
    /// The vertex arrays a stage reads: the grown ones, or the source's when the build changed
    /// nothing, without the bones (`attributes::bones`), which no stage reads from there.
    pub fn arrays<'a>(
        grown: &'a Option<Grown>,
        positions: &'a [f32],
        attributes: DagAttributes<'a>,
    ) -> (&'a [f32], Vec<&'a Attribute>) {
        let (positions, mut carried) = Self::level(grown, positions, attributes);
        carried.retain(|a| a.flag != FLAG_SKIN);
        (positions, carried)
    }
    /// The vertex arrays a level of the build reads: the grown ones, or the source's.
    pub(super) fn level<'a>(
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
    /// first placement copies the `source` arrays once; a solve that moved nothing, never.
    pub(super) fn place(
        grown: &mut Option<Grown>,
        (positions, attributes): (&[f32], DagAttributes),
        welds: &mut Welds,
        placed: Placed,
        clusters: &mut [Vec<u32>],
        base: u32,
    ) {
        if placed.origins.is_empty() {
            return;
        }
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
/// carried attribute, the level's vertex each deforms as (`Local::placed`) and what the level's
/// welds say; none by default.
#[derive(Default)]
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
        let offset = |a: &Attribute| row_offset(weighted, a);
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
        let origins = self.deformed_as(placed, carried, &values);
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
        let weld_seam = canonical(|flag| UV_FLAGS.contains(&flag), input.weld_seam);
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

    /// Per vertex of `placed`, the level's vertex it deforms as: the one it was solved from, when
    /// the build carries no bones (`FLAG_SKIN` among `carried`) or that one holds the bones the
    /// vertex took (`values`, per carried attribute); else the region's first vertex holding them,
    /// as one does: a solve copies bones whole, never blends them (`simplify::Role::Bones`).
    fn deformed_as(
        &self,
        placed: impl Iterator<Item = u32>,
        carried: &[&Attribute],
        values: &[Vec<f32>],
    ) -> Vec<u32> {
        let Some(bones) = carried.iter().position(|a| a.flag == FLAG_SKIN) else {
            return placed.map(|id| self.from(id) as u32).collect();
        };
        let width = carried[bones].width;
        let held = |v: usize| &carried[bones].values[v * width..][..width];
        let bits = |values: &[f32]| -> Vec<u32> { values.iter().map(|x| x.to_bits()).collect() };
        let mut holding: Option<WordMap<Vec<u32>, u32>> = None;
        (placed.enumerate())
            .map(|(k, id)| {
                let (from, took) = (self.from(id), &values[bones][k * width..][..width]);
                if bits(held(from)) == bits(took) {
                    return from as u32;
                }
                let holding = holding.get_or_insert_with(|| {
                    let mut first: WordMap<Vec<u32>, u32> = word_map(self.remap.len());
                    for &v in self.remap {
                        first.entry(bits(held(v as usize))).or_insert(v);
                    }
                    first
                });
                *holding
                    .get(&bits(took))
                    .expect("a solve copies a region vertex's bones")
            })
            .collect()
    }
}
