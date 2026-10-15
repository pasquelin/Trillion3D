//! How placed nodes are grouped into cells: halved at the median of their centres, on the axis of
//! least cost over their boxes (`split::bisect_least_cost`, every tree's split), until a cell's
//! bytes fit one stream unit. Nothing here is a distance: the runtime derives when to
//! read a cell from its boxes and its own camera. The halving is kept: the paged cell index is cut
//! from its tree (`pages.rs`).
use super::*;
use std::ops::Range;
use trillion3d_math::aabb::centre;
use trillion3d_page_codec::split::bisect_least_cost;

/// One placed node: its rank in the published scene, its world box, the core rank of its parent
/// (`None`: a scene root) and its box in that parent's frame, its descriptor as the cell writes
/// it, and that descriptor's size.
pub(in crate::compiler_tables) struct Placed {
    pub node: usize,
    pub bounds: [f64; 6],
    pub parent: Option<usize>,
    pub local: [f64; 6],
    pub entry: Value,
    pub bytes: usize,
}
impl Placed {
    fn corners(&self) -> ([f64; 3], [f64; 3]) {
        let b = &self.bounds;
        ([b[0], b[1], b[2]], [b[3], b[4], b[5]])
    }
}

/// A node of the halving tree: its contiguous range of cells, and its halves unless it is one.
pub(crate) struct Region {
    pub cells: Range<usize>,
    pub halves: Option<Box<[Region; 2]>>,
}

/// Halves `group` at the median of its centres on the axis of least cost until each part fits the
/// budget; a single node is a cell whatever its size. Returns the tree of the halving.
fn halve(group: Vec<Placed>, out: &mut Vec<Vec<Placed>>) -> Region {
    let first = out.len();
    if group.len() <= 1
        || group.iter().map(|p| p.bytes).sum::<usize>() <= crate::STREAM_BUNDLE_BYTES
    {
        out.push(group);
        return Region {
            cells: first..first + 1,
            halves: None,
        };
    }
    let centres: Vec<[f64; 3]> = group
        .iter()
        .map(|p| {
            let (low, high) = p.corners();
            centre(low, high)
        })
        .collect();
    let mut ids: Vec<usize> = (0..group.len()).collect();
    let at = group.len() / 2;
    bisect_least_cost(&mut ids, &centres, |id| group[id].corners(), at);
    let mut slots: Vec<Option<Placed>> = group.into_iter().map(Some).collect();
    let mut group: Vec<Placed> = ids.iter().filter_map(|&id| slots[id].take()).collect();
    let upper = group.split_off(at);
    let halves = [halve(group, out), halve(upper, out)];
    Region {
        cells: first..out.len(),
        halves: Some(Box::new(halves)),
    }
}

/// The halving of `records` in order, in two down to single records: the tree of records that have
/// no place to halve by, as the manifest's primitives.
pub(crate) fn halving(records: Range<usize>) -> Region {
    let middle = records.start + records.len() / 2;
    let halves = (records.len() > 1)
        .then(|| Box::new([halving(records.start..middle), halving(middle..records.end)]));
    Region {
        cells: records,
        halves,
    }
}

/// The cells of `placed`, and the tree that halved them.
pub(super) fn split_cells(placed: Vec<Placed>) -> (Vec<Vec<Placed>>, Region) {
    let mut cells = Vec::new();
    let tree = halve(placed, &mut cells);
    (cells, tree)
}
