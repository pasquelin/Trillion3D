//! The bucketed hash table the reduction rings, finds and welds its elements with, and the keys it
//! files them under: Murmur3's 32-bit mix of raw words (`murmur3_32`), a position keyed by
//! its three floats' bits.
//!
//! Each bucket chains its entries newest first, and a search walks the whole chain of its key's
//! bucket — every entry whose key shares the bucket's low bits, not only its own key's —, testing
//! each for an exact match. So where the first match decides a result, or where two values compare
//! equal under different bits (`0.0` and `−0.0`), the bucket count and the order of insertion
//! decide it as well: each table is built with the count and in the order its step gives.

pub(super) use trillion3d_math::sequence::random::murmur3_32;

/// The end of a chain.
const END: u32 = u32::MAX;

/// Buckets of entry indices, each a chain from its head through `links`, the newest first.
pub(super) struct Chains {
    heads: Vec<u32>,
    links: Vec<u32>,
}

impl Chains {
    /// An empty table of `buckets` buckets, a power of two, sized for the indices under
    /// `capacity`; an index past it grows the links.
    pub(super) fn new(buckets: u32, capacity: usize) -> Self {
        Self {
            heads: vec![END; buckets as usize],
            links: vec![END; capacity],
        }
    }

    fn bucket(&self, key: u32) -> usize {
        (key & (self.heads.len() as u32 - 1)) as usize
    }

    /// `index` filed under `key`, at the head of its bucket.
    pub(super) fn add(&mut self, key: u32, index: u32) {
        let at = index as usize;
        if at >= self.links.len() {
            self.links.resize((at + 1).next_power_of_two().max(32), END);
        }
        let bucket = self.bucket(key);
        self.links[at] = self.heads[bucket];
        self.heads[bucket] = index;
    }

    /// `index` unlinked from `key`'s bucket, when it is there.
    pub(super) fn remove(&mut self, key: u32, index: u32) {
        if index as usize >= self.links.len() {
            return;
        }
        let bucket = self.bucket(key);
        if self.heads[bucket] == index {
            self.heads[bucket] = self.links[index as usize];
            return;
        }
        let mut at = self.heads[bucket];
        while at != END {
            if self.links[at as usize] == index {
                self.links[at as usize] = self.links[index as usize];
                return;
            }
            at = self.links[at as usize];
        }
    }

    /// The indices in `key`'s bucket, the newest first.
    pub(super) fn chain(&self, key: u32) -> impl Iterator<Item = u32> + '_ {
        let first = self.heads[self.bucket(key)];
        std::iter::successors((first != END).then_some(first), move |&at| {
            let next = self.links[at as usize];
            (next != END).then_some(next)
        })
    }
}

/// The bucket count `2^min(16, ⌊log₂ n⌋)` for a table of `n` entries, one for none.
pub(super) fn buckets_for(n: usize) -> u32 {
    1 << (n as u32).checked_ilog2().unwrap_or(0).min(16)
}

/// The key of a position: `murmur3_32` of its three floats' raw bits, a zero's sign kept.
pub(super) fn position_key(p: [f32; 3]) -> u32 {
    murmur3_32(&p.map(f32::to_bits))
}
