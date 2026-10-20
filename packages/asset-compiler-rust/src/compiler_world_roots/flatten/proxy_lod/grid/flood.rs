//! The level set's signs filled in from its narrow band, and its leaves pruned to the band.
use super::{lower_origin, lower_slot, upper_origin, upper_slot, Coord, Grid, SIZE, UPPER};
use trillion3d_page_codec::hash::{WordMap, WordSet};

impl Grid {
    /// The signed flood fill, bottom up: each leaf's
    /// inactive voxels take the sign of the last active voxel before them along z, y then x, each
    /// internal node's tiles the sign of the last child before them, and the root inserts inside
    /// tiles between two inside upper nodes of the same z line.
    pub(crate) fn signed_flood_fill(&mut self, outside: f32, inside: f32) {
        let (outside, inside) = (outside.abs(), -inside.abs());
        for leaf in &mut self.leaves {
            let Some(first) = leaf.on.ons().next() else {
                let v = if leaf.dist[0] < 0.0 { inside } else { outside };
                leaf.dist = [v; SIZE];
                continue;
            };
            let mut x_inside = leaf.dist[first] < 0.0;
            for x in 0..8 {
                let x00 = x << 6;
                if leaf.on.is_on(x00) {
                    x_inside = leaf.dist[x00] < 0.0;
                }
                let mut y_inside = x_inside;
                for y in 0..8 {
                    let xy0 = x00 + (y << 3);
                    if leaf.on.is_on(xy0) {
                        y_inside = leaf.dist[xy0] < 0.0;
                    }
                    let mut z_inside = y_inside;
                    for z in 0..8 {
                        let xyz = xy0 + z;
                        if leaf.on.is_on(xyz) {
                            z_inside = leaf.dist[xyz] < 0.0;
                        } else {
                            leaf.dist[xyz] = if z_inside { inside } else { outside };
                        }
                    }
                }
            }
        }
        // Lower nodes: the leaves' first and last values, by table slot.
        let mut lowers: WordMap<Coord, Vec<(usize, f32, f32)>> = WordMap::default();
        for leaf in &self.leaves {
            lowers.entry(lower_origin(leaf.origin)).or_default().push((
                lower_slot(leaf.origin),
                leaf.dist[0],
                leaf.dist[SIZE - 1],
            ));
        }
        self.lower = lowers
            .into_iter()
            .map(|(origin, children)| (origin, fill_table::<4>(&children, inside, outside)))
            .collect();
        let mut uppers: WordMap<Coord, Vec<(usize, f32, f32)>> = WordMap::default();
        for &origin in self.lower.keys() {
            uppers.entry(upper_origin(origin)).or_default().push((
                upper_slot(origin),
                self.lower_end(origin, false),
                self.lower_end(origin, true),
            ));
        }
        self.upper = uppers
            .into_iter()
            .map(|(origin, children)| (origin, fill_table::<5>(&children, inside, outside)))
            .collect();
        let mut keys: Vec<Coord> = self.upper.keys().copied().collect();
        keys.sort_unstable();
        self.root.clear();
        for pair in keys.windows(2) {
            let (a, b) = (pair[0], pair[1]);
            let d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
            if d[0] != 0 || d[1] != 0 || d[2] == UPPER {
                continue;
            }
            if !(self.upper_end(a, true) < 0.0) || !(self.upper_end(b, false) < 0.0) {
                continue;
            }
            let mut z = a[2] + UPPER;
            while z != b[2] {
                self.root.insert([a[0], a[1], z], inside);
                z += UPPER;
            }
        }
        self.background = outside;
    }

    /// The level set pruned to tiles of `outside` and `inside`: a leaf without active voxels becomes
    /// a tile of its first value's sign, then a lower node without leaves, then an upper node
    /// without lower nodes; outside root tiles equal the background and are erased.
    pub(crate) fn prune_level_set(&mut self, outside: f32, inside: f32) {
        let tile = |v: f32| if v < 0.0 { inside } else { outside };
        let (empty, kept): (Vec<_>, Vec<_>) = std::mem::take(&mut self.leaves)
            .into_iter()
            .partition(|l| l.on.is_empty());
        self.leaves = kept;
        self.reindex();
        for leaf in empty {
            let lower = lower_origin(leaf.origin);
            self.lower.get_mut(&lower).expect("a leaf's lower node")[lower_slot(leaf.origin)] =
                tile(leaf.dist[0]);
        }
        let alive_lower: WordSet<Coord> =
            self.leaves.iter().map(|l| lower_origin(l.origin)).collect();
        let dead_lower: Vec<Coord> = self
            .lower
            .keys()
            .filter(|o| !alive_lower.contains(*o))
            .copied()
            .collect();
        for origin in dead_lower {
            let first = self.lower.remove(&origin).expect("a lower node")[0];
            let upper = upper_origin(origin);
            self.upper
                .get_mut(&upper)
                .expect("a lower node's upper node")[upper_slot(origin)] = tile(first);
        }
        let alive_upper: WordSet<Coord> = self.lower.keys().map(|&o| upper_origin(o)).collect();
        let dead_upper: Vec<Coord> = self
            .upper
            .keys()
            .filter(|o| !alive_upper.contains(*o))
            .copied()
            .collect();
        for origin in dead_upper {
            let first = self.upper.remove(&origin).expect("an upper node")[0];
            let v = tile(first);
            if v != self.background {
                self.root.insert(origin, v);
            }
        }
    }
}

/// An internal node's tiles after the flood fill: `LOG2` bits per
/// axis, the children given by slot with their first and last values.
fn fill_table<const LOG2: usize>(
    children: &[(usize, f32, f32)],
    inside: f32,
    outside: f32,
) -> Vec<f32> {
    let side = 1usize << LOG2;
    let mut table = vec![0.0f32; side * side * side];
    let mut child: WordMap<usize, f32> = trillion3d_page_codec::hash::word_map(children.len());
    let mut first = usize::MAX;
    let mut first_value = 0.0;
    for &(slot, head, tail) in children {
        child.insert(slot, tail);
        if slot < first {
            first = slot;
            first_value = head;
        }
    }
    let mut x_inside = first_value < 0.0;
    for x in 0..side {
        let x00 = x << (2 * LOG2);
        if let Some(&tail) = child.get(&x00) {
            x_inside = tail < 0.0;
        }
        let mut y_inside = x_inside;
        for y in 0..side {
            let xy0 = x00 + (y << LOG2);
            if let Some(&tail) = child.get(&xy0) {
                y_inside = tail < 0.0;
            }
            let mut z_inside = y_inside;
            for z in 0..side {
                let xyz = xy0 + z;
                if let Some(&tail) = child.get(&xyz) {
                    z_inside = tail < 0.0;
                } else {
                    table[xyz] = if z_inside { inside } else { outside };
                }
            }
        }
    }
    table
}
