//! How placed nodes are grouped into cells: halved along the widest axis of their centres until
//! a cell's bytes fit one stream unit. Nothing here is a distance: the runtime derives when to
//! read a cell from its boxes and its own camera.
use super::*;

/// One placed node: its world box, the core rank of its parent (`None`: a scene root) and its box
/// in that parent's frame, its descriptor as the cell writes it, and that descriptor's size.
pub(in crate::compiler_tables) struct Placed {
    pub bounds: [f64; 6],
    pub parent: Option<usize>,
    pub local: [f64; 6],
    pub entry: Value,
    pub bytes: usize,
}
impl Placed {
    fn centre(&self, axis: usize) -> f64 {
        (self.bounds[axis] + self.bounds[axis + 3]) * 0.5
    }
}

/// Halves `group` along the widest spread of its centres until each part fits the budget; a
/// single node is a cell whatever its size.
fn halve(mut group: Vec<Placed>, out: &mut Vec<Vec<Placed>>) {
    if group.len() <= 1
        || group.iter().map(|p| p.bytes).sum::<usize>() <= crate::STREAM_BUNDLE_BYTES
    {
        out.push(group);
        return;
    }
    let spread = |axis: usize| {
        let (low, high) = group
            .iter()
            .fold((f64::INFINITY, f64::NEG_INFINITY), |(l, h), p| {
                (l.min(p.centre(axis)), h.max(p.centre(axis)))
            });
        high - low
    };
    let axis = (0..3)
        .max_by(|a, b| spread(*a).total_cmp(&spread(*b)))
        .unwrap_or(0);
    group.sort_by(|a, b| a.centre(axis).total_cmp(&b.centre(axis)));
    let upper = group.split_off(group.len() / 2);
    halve(group, out);
    halve(upper, out);
}

/// The cells of `placed`.
pub(super) fn split_cells(placed: Vec<Placed>) -> Vec<Vec<Placed>> {
    let mut cells = Vec::new();
    halve(placed, &mut cells);
    cells
}
