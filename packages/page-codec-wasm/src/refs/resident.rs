//! The resident page's vertices and the pair that names a cluster.

use super::*;

/// A resident page (`resident.rs`), read for the vertices it holds: what the install pass finds
/// the vertex a pair names in.
pub struct Resident {
    header: Header,
    layout: Layout,
    words: Vec<u32>,
}

impl Resident {
    /// The resident page that starts `bytes`, whatever follows it: refused unless its header is
    /// within the format's bounds and `bytes` holds all its streams.
    pub fn read(bytes: &[u8]) -> Result<Self, PageError> {
        let header = Header::read_words(bytes, RESIDENT_VERSION)?;
        let layout = Layout::of(&header);
        let sane = header.fields_sane()
            && (1..=MAX_PAGE_VERTICES).contains(&header.vertex_count)
            && (1..=header.vertex_count).contains(&header.position_count)
            && bytes.len() >= layout.bytes();
        if !sane {
            return Err(PageError::Bounds);
        }
        let words = le_words(&bytes[header.body_at()..layout.bytes()]).collect();
        Ok(Self {
            header,
            layout,
            words,
        })
    }

    /// The `bits`-bit field `index` of the stream that starts at word `stream`.
    fn field(&self, stream: usize, index: usize, bits: u32) -> u32 {
        if bits == 0 {
            return 0;
        }
        BitReader::at(&self.words, stream * 32 + index * bits as usize).read(bits)
    }

    /// Vertex `v`, none past the page's.
    pub fn vertex(&self, v: usize) -> Option<Vertex> {
        let (h, l) = (&self.header, &self.layout);
        if v >= h.vertex_count {
            return None;
        }
        let slot = if h.links_positions() {
            self.field(l.links, v, h.link_bits()) as usize
        } else {
            v
        };
        if slot >= h.position_count {
            return None;
        }
        let has = |flag: u32| h.flags & flag != 0;
        let mut cell = Cell {
            position: [0, 1, 2].map(|c| self.field(l.position[c], slot, h.position.bits[c])),
            ..Cell::default()
        };
        if has(FLAG_NORMAL) {
            cell.normal = [0, 1].map(|c| self.field(l.normal[c], v, h.normal_precision));
        }
        if has(FLAG_TANGENT) {
            cell.tangent = self.field(l.tangent, v, h.tangent_precision + 1);
        }
        if has(FLAG_COLOR) {
            cell.color = [0, 1, 2, 3].map(|c| self.field(l.color[c], v, h.color.bits[c]));
        }
        for (set, flag) in UV_FLAGS.into_iter().enumerate() {
            if has(flag) {
                cell.uv[set] = [0, 1].map(|c| self.field(l.uv[set][c], v, h.uv[set].bits[c]));
            }
        }
        Some(Vertex::of(h, &cell))
    }
}

/// The highest rank of a streaming page in a page's list of dependencies that a pair holds: the
/// rank sits above the `REF_PLACE_BITS` bits of the place, in what the word has left.
pub const MAX_PAIR_RANK: u32 = u32::MAX >> REF_PLACE_BITS;

/// The pair of cluster `place` of the streaming page of rank `rank` in a page's list. A rank past
/// `MAX_PAIR_RANK` would wrap into the place; the compiler leaves such a page out of the search
/// (`asset-compiler-rust/src/compiler/pages/bundles/lay.rs`).
pub fn pair(rank: u32, place: u32) -> u32 {
    debug_assert!(rank <= MAX_PAIR_RANK && place < SELF_PLACE);
    rank << REF_PLACE_BITS | place
}
