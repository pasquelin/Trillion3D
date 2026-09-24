//! How placed nodes are grouped into cells: by size class first, then halved along the widest
//! axis of their centres until a cell's bytes fit one stream unit. Nothing here is a distance: the
//! runtime derives when to read a cell from its box, its largest object and its own error target.
use super::*;

/// One placed node: its world box, its descriptor as the cell writes it, and that descriptor's size.
pub(in crate::compiler_tables) struct Placed {
    pub bounds: [f64; 6],
    pub entry: Value,
    pub bytes: usize,
}
impl Placed {
    /// The diagonal of its world box: the extent the runtime projects against its error target.
    pub fn size(&self) -> f64 {
        let b = &self.bounds;
        ((b[3] - b[0]).powi(2) + (b[4] - b[1]).powi(2) + (b[5] - b[2]).powi(2)).sqrt()
    }
    fn centre(&self, axis: usize) -> f64 {
        (self.bounds[axis] + self.bounds[axis + 3]) * 0.5
    }
    /// Its size class: the power of two its diagonal rounds up to; a point is a class of its own.
    fn class(&self) -> i64 {
        let size = self.size();
        if size > 0.0 {
            size.log2().ceil() as i64
        } else {
            i64::MIN
        }
    }
}

/// The box around every node of `cell`.
pub(super) fn union_of(cell: &[Placed]) -> [f64; 6] {
    let mut out = EMPTY;
    for placed in cell {
        grow(&mut out, &placed.bounds);
    }
    out
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

/// The cells of `placed`, size class by size class, smallest first.
pub(super) fn split_cells(placed: Vec<Placed>) -> Vec<Vec<Placed>> {
    let mut classes: BTreeMap<i64, Vec<Placed>> = BTreeMap::new();
    for node in placed {
        classes.entry(node.class()).or_default().push(node);
    }
    let mut cells = Vec::new();
    for group in classes.into_values() {
        halve(group, &mut cells);
    }
    cells
}
