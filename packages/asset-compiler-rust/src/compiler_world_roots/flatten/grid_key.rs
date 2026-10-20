//! Grid coordinates packed in one word, twenty bits each — the solid's grid holds at most
//! 1024 cells along an axis and one corner past them (`approximate.rs`), the closing's at most
//! 4096 (`morphology.rs`), both well under 2²⁰ —,
//! and a grid edge as its lower corner's key and its axis, so the two cubes sharing an edge find
//! the same crossing vertex; and the leaf every sparse grid is allocated by, eight nodes a side
//! (the closing's field, the proxy's volume).
const BITS: u32 = 20;
const MASK: u64 = (1 << BITS) - 1;

/// The key of coordinates `c`, each in `0..2²⁰`.
pub(super) fn key<T: Into<i64> + Copy>(c: [T; 3]) -> u64 {
    let [x, y, z] = c.map(|v| v.into() as u64);
    x << (2 * BITS) | y << BITS | z
}

/// The coordinates of `key`.
pub(super) fn unkey<T: From<i32>>(key: u64) -> [T; 3] {
    [2 * BITS, BITS, 0].map(|shift| T::from((key >> shift & MASK) as i32))
}

/// The grid edge between neighbouring corners `a` and `b`: its lower corner's key, then its axis
/// in the two low bits.
pub(super) fn edge_key<T: Into<i64> + Copy>(a: [T; 3], b: [T; 3]) -> u64 {
    let (a, b) = (a.map(Into::into), b.map(Into::into));
    let low: [i64; 3] = std::array::from_fn(|k| a[k].min(b[k]));
    let axis = (0..3).find(|&k| a[k] != b[k]).unwrap_or(0) as u64;
    key(low) << 2 | axis
}

/// The two corners of the grid edge `key`, the lower first.
pub(super) fn edge_ends(key: u64) -> ([i64; 3], [i64; 3]) {
    let low: [i64; 3] = unkey(key >> 2);
    let mut high = low;
    high[(key & 3) as usize] += 1;
    (low, high)
}

/// The side, in nodes, of a leaf, and its node count.
pub(super) const LEAF_SIDE: i32 = 8;
pub(super) const LEAF_SIZE: usize = 512;

/// The least corner of the leaf holding node `c`.
pub(super) fn leaf_origin(c: [i32; 3]) -> [i32; 3] {
    c.map(|x| x & !(LEAF_SIDE - 1))
}

/// Node `c`'s offset in its leaf: x major, z minor.
pub(super) fn leaf_offset(c: [i32; 3]) -> usize {
    (((c[0] & 7) << 6) | ((c[1] & 7) << 3) | (c[2] & 7)) as usize
}

/// The node at `offset` in its leaf, from the leaf's least corner (`leaf_offset` inverted).
pub(super) fn local_coord(offset: usize) -> [i32; 3] {
    [
        (offset >> 6) as i32,
        ((offset >> 3) & 7) as i32,
        (offset & 7) as i32,
    ]
}

/// A bit per node of a leaf, by `leaf_offset`.
#[derive(Clone, Copy, Default)]
pub(super) struct Mask(pub [u64; 8]);

impl Mask {
    pub(super) fn is_on(&self, i: usize) -> bool {
        self.0[i >> 6] >> (i & 63) & 1 == 1
    }
    pub(super) fn set_on(&mut self, i: usize) {
        self.0[i >> 6] |= 1 << (i & 63);
    }
    pub(super) fn set_off(&mut self, i: usize) {
        self.0[i >> 6] &= !(1 << (i & 63));
    }
    pub(super) fn is_empty(&self) -> bool {
        self.0.iter().all(|&w| w == 0)
    }
    /// The offsets whose bit is on, in increasing order.
    pub(super) fn ons(&self) -> impl Iterator<Item = usize> + '_ {
        self.0.iter().enumerate().flat_map(|(w, &bits)| {
            let mut bits = bits;
            std::iter::from_fn(move || {
                (bits != 0).then(|| {
                    let b = bits.trailing_zeros() as usize;
                    bits &= bits - 1;
                    w * 64 + b
                })
            })
        })
    }
}
