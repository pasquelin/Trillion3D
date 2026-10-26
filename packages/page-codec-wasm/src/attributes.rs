//! Streams of a page and the block of words they unpack into (`unpack.rs`).
use crate::bits::stream_words;
use crate::deform::{morph_words, skin_words, FLAG_MORPH, FLAG_SKIN};
use crate::triangles::CornerCode;
pub(crate) use crate::{
    deform, Header, FLAG_COLOR, FLAG_NORMAL, FLAG_TANGENT, FLAG_UV, FLAG_UV1, FLAG_UV2, FLAG_UV3,
    FLAG_UV4, FLAG_UV5, FLAG_UV6, FLAG_UV7, HEADER_BYTES, MAX_UV_SETS, RESIDENT_TABLE_WORDS,
};
/// Optional stream flags and float widths, after position: normal, the eight texture sets, colour,
/// tangent (its direction and its bitangent's sign).
pub const OPTIONAL: [(u32, usize); 11] = [
    (FLAG_NORMAL, 3),
    (FLAG_UV, 2),
    (FLAG_UV1, 2),
    (FLAG_UV2, 2),
    (FLAG_UV3, 2),
    (FLAG_UV4, 2),
    (FLAG_UV5, 2),
    (FLAG_UV6, 2),
    (FLAG_UV7, 2),
    (FLAG_COLOR, 4),
    (FLAG_TANGENT, 4),
];
/// The presence bit of each texture set, in set order.
pub const UV_FLAGS: [u32; MAX_UV_SETS] = [
    FLAG_UV, FLAG_UV1, FLAG_UV2, FLAG_UV3, FLAG_UV4, FLAG_UV5, FLAG_UV6, FLAG_UV7,
];
/// The presence bits of every texture set together: `flag & UV_MASK != 0` tells a texture
/// coordinate attribute from any other, as a test and not a search of `UV_FLAGS`.
pub const UV_MASK: u32 = {
    let mut mask = 0;
    let mut set = 0;
    while set < MAX_UV_SETS {
        mask |= UV_FLAGS[set];
        set += 1;
    }
    mask
};
/// Floats per vertex of each attribute rank, `None` for one the page does not carry: position,
/// `OPTIONAL` in order, skin joints and weights (`influences` each), morph deltas (six per
/// target). The one walk of a decoded vertex, which `attribute` and `Header::vertex_floats` read.
pub(crate) fn attribute_widths(
    flags: u32,
    influences: usize,
    targets: usize,
) -> impl Iterator<Item = Option<usize>> {
    let deformation = [
        (FLAG_SKIN, influences),
        (FLAG_SKIN, influences),
        (FLAG_MORPH, 6 * targets),
    ];
    let ranks = core::iter::once((0, 3)).chain(OPTIONAL).chain(deformation);
    ranks.map(move |(bit, width)| (flags & bit == bit).then_some(width))
}
/// Decoded indices then float attribute bits in one `decoded_bytes` block, shared with JS.
pub struct DecodedPage {
    pub words: Vec<u32>,
    pub vertex_count: usize,
    pub index_count: usize,
    pub flags: u32,
    /// Morph targets of the page: six floats each per vertex, after the skin's eight.
    pub morph_targets: usize,
    pub skin_influences: usize,
}
impl DecodedPage {
    pub fn indices(&self) -> &[u32] {
        &self.words[..self.index_count]
    }
    /// Attribute by rank: position, OPTIONAL, skin joints/weights, morph deltas; None if absent.
    pub fn attribute(&self, rank: usize) -> Option<&[f32]> {
        let mut at = self.index_count;
        let widths = attribute_widths(self.flags, self.skin_influences, self.morph_targets);
        for (r, width) in widths.enumerate() {
            let Some(width) = width else { continue };
            let run = at..at + self.vertex_count * width;
            if r == rank {
                return Some(floats(&self.words[run]));
            }
            at = run.end;
        }
        None
    }

    pub fn decoded_bytes(&self) -> usize {
        self.words.len() * 4
    }
}

/// The floats a run of words spells, without a copy.
fn floats(words: &[u32]) -> &[f32] {
    // SAFETY: `f32` and `u32` share size and alignment, and every bit pattern is a valid `f32`.
    unsafe { core::slice::from_raw_parts(words.as_ptr().cast::<f32>(), words.len()) }
}

/// A decoded page is summarised by its counts: printing its buffers would teach nothing.
impl core::fmt::Debug for DecodedPage {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        write!(
            f,
            "DecodedPage {{ vertices: {}, indices: {}, flags: {} }}",
            self.vertex_count, self.index_count, self.flags
        )
    }
}

/// The greatest word offset a stream of a page of the format's bounds starts at, which the resident
/// page's table holds in 16 bits: the largest header (23 words, 255 morph records of 9, the four
/// extension ranges of 2 words each for the sets past the fourth, the table), then the block table
/// and the corner stream (a corner takes at most `MAX_WIDTH` bits), then at most a word per vertex
/// and bit of width for each of the 27 other streams before the skin (3 positions, links,
/// 2 normals, 16 texture streams, 4 colours, tangents).
pub const MAX_TABLE_OFFSET: usize = crate::HEADER_WORDS
    + deform::MAX_MORPH_TARGETS * deform::MORPH_WORDS
    + (MAX_UV_SETS - crate::HEADER_UV_SETS) * crate::UV_EXTENSION_WORDS
    + RESIDENT_TABLE_WORDS
    + crate::MAX_PAGE_CORNERS
    + crate::MAX_PAGE_CORNERS * crate::triangles::MAX_WIDTH / 32
    + 27 * crate::MAX_PAGE_VERTICES;
const _: () = assert!(MAX_TABLE_OFFSET <= u16::MAX as usize);

/// Stream word offsets derived from counts and widths, never trusted header offsets.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Layout {
    pub corners: CornerCode,
    /// The block table then the corner stream (`triangles.rs`).
    pub triangles: [usize; 2],
    pub position: [usize; 3],
    /// Vertex-to-position links when positions are shared (`positions.rs`).
    pub links: usize,
    /// The normals' two streams, `x` then `y`, of the page's normal precision.
    pub normal: [usize; 2],
    /// Each texture set's two streams, `u` then `v`.
    pub uv: [[usize; 2]; MAX_UV_SETS],
    pub color: [usize; 4],
    /// The stored tangents, one code of the page's tangent precision plus one bits per vertex
    /// (`bits::tangent_code`).
    pub tangent: usize,
    /// The skin's first stream: all joint streams, then all float32 weight streams (`deform.rs`).
    pub skin: usize,
    /// The first morph target's first stream; each target's own start is in its record.
    pub morph: usize,
    /// Bytes before the first stream of the resident page: the header, the morph records, the
    /// extension and the table (`Header::body_at`).
    pub header_bytes: usize,
    /// Words of every stream together.
    pub words: usize,
}

impl Layout {
    pub fn of(h: &Header) -> Self {
        let corners = CornerCode::of(h.vertex_count, h.index_count, h.corner_bits);
        let mut at = 0usize;
        let mut stream = |present: bool, count: usize, bits: u32| {
            let start = at;
            if present {
                at += stream_words(count, bits);
            }
            start
        };
        let triangles = [
            stream(true, corners.blocks, corners.record_bits()),
            stream(true, corners.bits, 1),
        ];
        let position = h.position.bits.map(|b| stream(true, h.position_count, b));
        let links = stream(h.links_positions(), h.vertex_count, h.link_bits());
        let has_normal = h.flags & FLAG_NORMAL != 0;
        let normal = [0, 1].map(|_| stream(has_normal, h.vertex_count, h.normal_precision));
        let uv = core::array::from_fn(|set| {
            let present = h.flags & UV_FLAGS[set] != 0;
            h.uv[set].bits.map(|b| stream(present, h.vertex_count, b))
        });
        let color = h
            .color
            .bits
            .map(|b| stream(h.flags & FLAG_COLOR != 0, h.vertex_count, b));
        let tangent = stream(
            h.flags & FLAG_TANGENT != 0,
            h.vertex_count,
            h.tangent_precision + 1,
        );
        let skinned = h.flags & FLAG_SKIN != 0;
        let (skin, morph) = (
            at,
            at.saturating_add(if skinned {
                skin_words(&h.skin, h.vertex_count)
            } else {
                0
            }),
        );
        at = morph.saturating_add(
            h.morphs
                .iter()
                .map(|m| morph_words(m, h.vertex_count))
                .sum::<usize>(),
        );
        Self {
            corners,
            triangles,
            position,
            links,
            normal,
            uv,
            color,
            tangent,
            skin,
            morph,
            header_bytes: h.body_at(),
            words: at,
        }
    }

    /// The resident page's table (`RESIDENT_TABLE_WORDS`): the word offset of each stream from the
    /// page's first word, 16 bits each — a page of the format's bounds never passes them
    /// (`MAX_TABLE_OFFSET`, proved at compile time); only the test-only reading of a resident page
    /// of up to `MAX_VERTICES` vertices does, and saturates alike on both sides — in this order: the block table and the corners, the three
    /// positions, the links, the two normals, the two streams of each texture set, the four
    /// colours, the tangents, the skin. An absent stream's offset is where it would start.
    pub fn table(&self) -> [u32; RESIDENT_TABLE_WORDS] {
        let base = self.header_bytes / 4;
        let offsets = (self.triangles.into_iter())
            .chain(self.position)
            .chain([self.links])
            .chain(self.normal)
            .chain(self.uv.into_iter().flatten())
            .chain(self.color)
            .chain([self.tangent, self.skin])
            .map(|at| at.saturating_add(base).min(0xffff) as u32);
        let mut table = [0u32; RESIDENT_TABLE_WORDS];
        for (k, at) in offsets.enumerate() {
            table[k / 2] |= at << (16 * (k % 2));
        }
        table
    }

    /// True when each morph record names the word its streams start at, in stream order.
    pub fn morphs_at(&self, h: &Header) -> bool {
        let mut at = self.morph;
        h.morphs.iter().all(|m| {
            let start = at;
            at += morph_words(m, h.vertex_count);
            m.start == start
        })
    }

    /// Length of the whole page file: the header and every stream.
    pub fn bytes(&self) -> usize {
        self.header_bytes
            .saturating_add(self.words.saturating_mul(4))
    }
}
