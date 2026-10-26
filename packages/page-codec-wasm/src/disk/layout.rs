//! The page on disk's layout: its streams, the shape its counts make and the coding of its fields.

use super::*;

/// Words of masks a group of 32 triangles takes: the start, left and with-a-vertex-named bits.
pub(super) const GROUP_WORDS: usize = 3;

/// One stream of a page on disk: `count` fields of `comps` components, each component `bits[c]`
/// wide, each value `bytes` bytes of the planes.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Run {
    pub part: Part,
    pub count: usize,
    pub comps: usize,
    pub bits: [u32; 4],
    /// The bytes a value takes in the planes: those the widest component's width needs.
    pub bytes: usize,
    /// What the first delta of each component is counted from.
    pub start: [u32; 4],
}

/// The streams of a page whose header is `h` that stores `stored` of its vertices, in the order
/// they lie in the planes: the links of every vertex, the positions, then the other fields of the
/// vertices stored. The header's records are within the format's bounds, so every shift below is.
pub fn runs(h: &Header, stored: usize) -> Vec<Run> {
    let n = h.vertex_count;
    let mut out = Vec::with_capacity(8);
    let mut push = |part: Part, count: usize, bits: &[u32], start: [u32; 4]| {
        let mut widths = [0u32; 4];
        widths[..bits.len()].copy_from_slice(bits);
        let widest = bits.iter().copied().max().unwrap_or(0);
        out.push(Run {
            part,
            count,
            comps: bits.len(),
            bits: widths,
            bytes: widest.div_ceil(8) as usize,
            start,
        });
    };
    if h.links_positions() {
        push(Part::Links, n, &[h.link_bits()], [0; 4]);
    }
    // A page that stores its positions once keeps the whole table, whoever names a vertex; one that
    // stores one a vertex keeps those of the vertices it stores, the others' coming from the
    // clusters they name.
    let positions = if h.links_positions() {
        h.position_count
    } else {
        stored
    };
    let [x, y, z] = h.position.bits.map(|b| (1u32 << b) >> 1);
    push(Part::Position, positions, &h.position.bits, [x, y, z, 0]);
    if h.flags & FLAG_NORMAL != 0 {
        push(Part::Normal, stored, &[h.normal_precision; 2], [0; 4]);
    }
    if h.flags & FLAG_TANGENT != 0 {
        push(Part::Tangent, stored, &[h.tangent_precision + 1], [0; 4]);
    }
    if h.flags & FLAG_COLOR != 0 {
        push(Part::Color, stored, &h.color.bits, [0; 4]);
    }
    for (set, flag) in UV_FLAGS.into_iter().enumerate() {
        if h.flags & flag != 0 {
            push(Part::Uv(set), stored, &h.uv[set].bits, [0; 4]);
        }
    }
    out
}

/// What a page's header does not say of its size: the distances its strips carry, the pairs of
/// clusters it names and the vertices it names.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Shape {
    pub strip_refs: usize,
    pub pairs: usize,
    pub named: usize,
}

/// Where everything lies in a page on disk, derived from its header's counts and widths and the
/// shape of its code, never trusted from the page: the planes' bytes, the byte each section
/// starts at, the raw words, the page's length.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DiskLayout {
    pub shape: Shape,
    pub runs: Vec<Run>,
    /// The byte each section starts at, from the page's first: the masks of the strips, their
    /// distances, the pairs, the vertices named (one bit a vertex), their references.
    pub masks_at: usize,
    pub strip_refs_at: usize,
    pub pairs_at: usize,
    pub named_at: usize,
    pub refs_at: usize,
    /// The bytes each plane holds, before the padding that closes it on a word, and the byte each
    /// starts at.
    pub plane_bytes: [usize; 3],
    pub plane_at: [usize; 3],
    /// The byte the raw words start at, and how many they are.
    pub raw_at: usize,
    pub raw_words: usize,
    /// The page's length.
    pub bytes: usize,
    /// The resident layout of the same page (`Layout`).
    pub resident: Layout,
}

/// `bytes` closed on a word.
pub(super) fn closed(bytes: usize) -> usize {
    bytes.saturating_add(3) & !3
}

impl DiskLayout {
    /// The layout of a page of header `h` and shape `shape`; saturating, so forged counts cannot
    /// wrap into a size that matches the bytes.
    pub fn of(h: &Header, shape: Shape) -> Self {
        let n = h.vertex_count;
        let runs = runs(h, n.saturating_sub(shape.named));
        let mut plane_bytes = [0usize; 3];
        for run in &runs {
            for plane in plane_bytes.iter_mut().take(run.bytes) {
                *plane = plane.saturating_add(run.comps.saturating_mul(run.count));
            }
        }
        let resident = Layout::of(h);
        let words = |count: usize| count.saturating_mul(4);
        let masks_at = h.bytes().saturating_add(words(DISK_HEADER_WORDS));
        let strip_refs_at = masks_at.saturating_add(words(MASK_GROUPS * GROUP_WORDS));
        let pairs_at =
            strip_refs_at.saturating_add(words(stream_words(shape.strip_refs, STRIP_REF_BITS)));
        let named_at = pairs_at.saturating_add(words(shape.pairs));
        let refs_at = named_at.saturating_add(words(stream_words(n, 1)));
        let mut at = refs_at.saturating_add(closed(shape.named.saturating_mul(2)));
        let plane_at = plane_bytes.map(|bytes| {
            let start = at;
            at = at.saturating_add(closed(bytes));
            start
        });
        let raw_words = resident.words.saturating_sub(resident.skin);
        Self {
            shape,
            runs,
            masks_at,
            strip_refs_at,
            pairs_at,
            named_at,
            refs_at,
            plane_bytes,
            plane_at,
            raw_at: at,
            raw_words,
            bytes: at.saturating_add(raw_words.saturating_mul(4)),
            resident,
        }
    }

    /// The words that follow the header and the morph records: how many vertices the page names
    /// and how many pairs of clusters; the vertices the strips named, then those they laid, before
    /// the second, third and fourth word of 32 triangles (`Strip::packed_counts`); then the byte
    /// each section after the masks starts at — the strips' distances, the pairs, the vertices
    /// named, their references, the three planes, the raw words.
    pub fn words(&self, strip: &Strip) -> [u32; DISK_HEADER_WORDS] {
        let [low, mid, high] = self.plane_at;
        [
            self.shape.named,
            self.shape.pairs,
            strip.named_before as usize,
            strip.laid_before as usize,
            self.strip_refs_at,
            self.pairs_at,
            self.named_at,
            self.refs_at,
            low,
            mid,
            high,
            self.raw_at,
        ]
        .map(|word| word as u32)
    }
}

/// The least bits of `bits` a field of that width holds; every one of a 32-bit word's for 32.
pub(super) fn mask(bits: u32) -> u32 {
    if bits >= 32 {
        u32::MAX
    } else {
        (1u32 << bits) - 1
    }
}

/// `value` as the signed number its low `bits` bits make: the shortest way round a field of that
/// width. Zero for a field of none.
pub fn shortest_wrap(value: i32, bits: u32) -> i32 {
    if bits == 0 {
        return 0;
    }
    let shift = 32 - bits;
    (value << shift) >> shift
}

/// A signed number with its sign in its low bit: 0, -1, 1, -2, 2 become 0, 1, 2, 3, 4.
pub fn encode_zigzag(value: i32) -> u32 {
    ((value << 1) ^ (value >> 31)) as u32
}

/// The signed number `encode_zigzag` made `code` of.
pub fn decode_zigzag(code: u32) -> i32 {
    ((code >> 1) as i32) ^ -((code & 1) as i32)
}
