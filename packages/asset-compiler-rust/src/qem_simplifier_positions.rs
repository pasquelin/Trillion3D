//! Items found by position: a position's bits, their hash, and the lists of items at each.
use super::P;
use trillion3d_math::scalar::normalized_bits;
use trillion3d_page_codec::hash::WordMap;

/// The bits of a position, a zero of either sign read as one.
pub(crate) fn key(p: P) -> [u32; 3] {
    p.map(normalized_bits)
}

/// The 32-bit Murmur hash of a position's bits: the order of a pair's two positions.
pub(super) fn hash_position(p: P) -> u32 {
    let mut hash = 0u32;
    for element in key(p) {
        let mut e = element.wrapping_mul(0xcc9e_2d51);
        e = e.rotate_left(15);
        e = e.wrapping_mul(0x1b87_3593);
        hash ^= e;
        hash = hash.rotate_left(13);
        hash = hash.wrapping_mul(5).wrapping_add(0xe654_6b64);
    }
    hash ^= hash >> 16;
    hash = hash.wrapping_mul(0x85eb_ca6b);
    hash ^= hash >> 13;
    hash = hash.wrapping_mul(0xc2b2_ae35);
    hash ^ (hash >> 16)
}

/// Items listed by position, oldest first: each position's newest is read first, as the items
/// were last listed.
#[derive(Default)]
pub(super) struct ByPosition {
    lists: WordMap<[u32; 3], Vec<u32>>,
}
impl ByPosition {
    pub fn add(&mut self, p: P, item: u32) {
        self.lists.entry(key(p)).or_default().push(item);
    }
    pub fn remove(&mut self, p: P, item: u32) {
        if let Some(list) = self.lists.get_mut(&key(p)) {
            if let Some(at) = list.iter().rposition(|&x| x == item) {
                list.remove(at);
            }
        }
    }
    /// The items at `p`, oldest first: read them backwards.
    pub fn at(&self, p: P) -> &[u32] {
        self.lists.get(&key(p)).map_or(&[], |list| list.as_slice())
    }
    /// Every position's list.
    pub fn lists(&self) -> impl Iterator<Item = &Vec<u32>> {
        self.lists.values()
    }
    /// Takes every item at `p` off the list, oldest first.
    pub fn take(&mut self, p: P) -> Vec<u32> {
        self.lists.remove(&key(p)).unwrap_or_default()
    }
}
