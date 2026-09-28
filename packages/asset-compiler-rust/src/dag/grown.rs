//! The primitive's vertex arrays as its DAG grows them: the source's, then, level by level,
//! every vertex a solved reduction placed (`solved.rs`, `placed.rs`).
use super::attributes::Welds;
use super::{DagAttributes, GroupReduction};
use crate::geometry_page::Attribute as Carried;

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
    /// whose vertex count was `base`; the reduction's clusters and the welds follow. The first
    /// placement copies the source's `positions` and `attributes` once.
    pub(super) fn place(
        grown: &mut Option<Grown>,
        positions: &[f32],
        attributes: DagAttributes,
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
            positions: with_room(positions),
            carried: attributes
                .carried
                .iter()
                .map(|&a| Carried {
                    flag: a.flag,
                    width: a.width,
                    values: with_room(&a.values),
                })
                .collect(),
        });
        grown.positions.extend_from_slice(&placed.positions);
        for (attribute, values) in grown.carried.iter_mut().zip(&placed.carried) {
            attribute.values.extend_from_slice(values);
        }
        welds.extend(placed, shift);
    }
}

/// A copy of `values` with room for the vertices the solve will place, so the first placement
/// does not copy them a second time.
fn with_room(values: &[f32]) -> Vec<f32> {
    let mut copy = Vec::with_capacity(values.len() + values.len() / 8);
    copy.extend_from_slice(values);
    copy
}
