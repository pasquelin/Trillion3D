//! Grid coordinates packed in one word, twenty bits each — the solid's grid holds at most
//! 1024 cells along an axis and one corner past them (`../approximate.rs`), the closing's at most
//! 4096 (`morphology.rs`), both well under 2²⁰ —,
//! and a grid edge as its lower corner's key and its axis, so the two cubes sharing an edge find
//! the same crossing vertex; and the leaf every sparse grid is allocated by, eight nodes a side
//! (the closing's field, the march's corners and cells, `Leaves`).
const BITS: u32 = 20;
const MASK: u64 = (1 << BITS) - 1;

/// The key of coordinates `c`, each in `0..2²⁰`.
pub(crate) fn key<T: Into<i64> + Copy>(c: [T; 3]) -> u64 {
    let [x, y, z] = c.map(|v| v.into() as u64);
    x << (2 * BITS) | y << BITS | z
}

/// The coordinates of `key`.
pub(crate) fn unkey<T: From<i32>>(key: u64) -> [T; 3] {
    [2 * BITS, BITS, 0].map(|shift| T::from((key >> shift & MASK) as i32))
}

/// The grid edge between neighbouring corners `a` and `b`: its lower corner's key, then its axis
/// in the two low bits.
pub(crate) fn edge_key<T: Into<i64> + Copy>(a: [T; 3], b: [T; 3]) -> u64 {
    let (a, b) = (a.map(Into::into), b.map(Into::into));
    let low: [i64; 3] = std::array::from_fn(|k| a[k].min(b[k]));
    let axis = (0..3).find(|&k| a[k] != b[k]).unwrap_or(0) as u64;
    key(low) << 2 | axis
}

/// The two corners of the grid edge `key`, the lower first.
pub(crate) fn edge_ends(key: u64) -> ([i64; 3], [i64; 3]) {
    let low: [i64; 3] = unkey(key >> 2);
    let mut high = low;
    high[(key & 3) as usize] += 1;
    (low, high)
}

/// The side, in nodes, of a leaf, and its node count.
pub(crate) const LEAF_SIDE: i32 = 8;
pub(crate) const LEAF_SIZE: usize = 512;

/// Node `c`'s offset in its leaf: x major, z minor.
pub(crate) fn leaf_offset(c: [i32; 3]) -> usize {
    (((c[0] & 7) << 6) | ((c[1] & 7) << 3) | (c[2] & 7)) as usize
}

/// A bit per node of a leaf, by `leaf_offset`.
#[derive(Clone, Copy, Default)]
struct Mask([u64; 8]);

impl Mask {
    fn is_on(&self, i: usize) -> bool {
        self.0[i >> 6] >> (i & 63) & 1 == 1
    }
    fn set_on(&mut self, i: usize) {
        self.0[i >> 6] |= 1 << (i & 63);
    }
}

/// Values on the nodes of a grid, by leaf: a leaf is allocated the first time one of its nodes is
/// written, and a node is read through its leaf's slot, found from the leaf's coordinates alone —
/// a dense list of slots, one per leaf of the grid, so no lookup is ever hashed. A node never
/// written reads none. A node is written only in the grid or in a leaf one of its nodes shares;
/// one in no leaf of the grid — below zero, or past the last leaf on an axis — reads none, never
/// another leaf's node.
pub(crate) struct Leaves<T> {
    /// The leaves along each axis.
    across: [usize; 3],
    slots: Vec<Option<Box<Leaf<T>>>>,
}

/// One leaf's nodes, by `leaf_offset`: which were written, and their values.
struct Leaf<T> {
    written: Mask,
    values: [T; LEAF_SIZE],
}

impl<T: Copy + Default> Leaves<T> {
    /// None written, on a grid of `nodes` nodes along each axis.
    pub(crate) fn new(nodes: [i64; 3]) -> Self {
        let across = nodes.map(|n| (n.max(0) as usize).div_ceil(LEAF_SIDE as usize));
        Self {
            across,
            slots: std::iter::repeat_with(|| None)
                .take(across.iter().product())
                .collect(),
        }
    }

    /// The slot of node `c`'s leaf and the node's offset in it; none for a node in no leaf of the
    /// grid.
    fn at(&self, c: [i64; 3]) -> Option<(usize, usize)> {
        let leaf: [usize; 3] = std::array::from_fn(|k| {
            usize::try_from(c[k]).map_or(usize::MAX, |v| v / LEAF_SIDE as usize)
        });
        if (0..3).any(|k| leaf[k] >= self.across[k]) {
            return None;
        }
        let slot = leaf[0] + self.across[0] * (leaf[1] + self.across[1] * leaf[2]);
        Some((slot, leaf_offset(c.map(|v| v as i32))))
    }

    /// Node `c`'s value, when it was written.
    pub(crate) fn get(&self, c: [i64; 3]) -> Option<T> {
        let (slot, offset) = self.at(c)?;
        let leaf = self.slots[slot].as_deref()?;
        leaf.written.is_on(offset).then_some(leaf.values[offset])
    }

    /// Whether node `c` was written.
    pub(crate) fn contains(&self, c: [i64; 3]) -> bool {
        self.get(c).is_some()
    }

    /// `value` written at node `c`, its leaf allocated when it has none: whether `c` had not been
    /// written before. Every writer names a node of the grid's leaves (`Leaves`): one in none is a
    /// fault of the caller, and panics.
    pub(crate) fn insert(&mut self, c: [i64; 3], value: T) -> bool {
        let (slot, offset) = self.at(c).expect("a node written in a leaf of the grid");
        let leaf = self.slots[slot].get_or_insert_with(|| {
            Box::new(Leaf {
                written: Mask::default(),
                values: [T::default(); LEAF_SIZE],
            })
        });
        let fresh = !leaf.written.is_on(offset);
        leaf.written.set_on(offset);
        leaf.values[offset] = value;
        fresh
    }
}
