//! Equivalence harness of the sequential reader (STR-01/02/03, E0): `decode_resident` gives the
//! same words and the same refusal as the reference decoder — every field read at random, the
//! first corner out of range refusing —, kept here as the reference, on the page shapes of the
//! format, ten thousand random pages and their corruptions, and the edge cases; then the page on
//! disk: its strips unpack to the triangles they were laid from, it reads back the values it was
//! written from — the vertices it names found in the clusters it names them in —, and decodes as
//! the resident page it expands to.

use super::*;
use crate::bits::grid::PageGrid;
use crate::bits::{ColorRange, PositionGrid, UvRange, MAX_BITS};
use crate::clusters::strip::strips_in_order;
use crate::encode::encode;
use crate::refs::{alone, pair, share, Parent, Same, Shelf};
use crate::streams::{Page, Streams};
use crate::triangles::{CornerCode, Spans};
use crate::unpack::reference::reference;
use crate::writer::BitWriter;
use crate::{
    COLOR_BITS, COLOR_LEVELS, FLAG_UV, FLAG_UV1, FLAG_UV2, FLAG_UV3, FLAG_UV4, FLAG_UV5, FLAG_UV6,
    FLAG_UV7, HEADER_UV_SETS, MAX_NORMAL_PRECISION, MAX_PAGE_TRIANGLES, MAX_PAGE_VERTICES,
    MAX_POSITION_BITS, MAX_POSITION_PRECISION, MAX_TANGENT_PRECISION, MAX_UV_SETS,
    MIN_POSITION_PRECISION, RESIDENT_VERSION, UV_CODE_BITS,
};
use trillion3d_math::sequence::random::xorshift32;
use trillion3d_math::GOLDEN_32;

/// A grid of cells a sixteenth of a centimetre.
const GRID: PageGrid = PageGrid {
    position: 4,
    normal: 8,
    tangent: 7,
};

struct Rng(u32);

impl Rng {
    fn next(&mut self) -> u32 {
        xorshift32(&mut self.0)
    }
    fn below(&mut self, n: u32) -> u32 {
        self.next() % n
    }
}

/// Every attribute a page carries but the stored tangent: the normal, the eight texture sets and
/// the colour.
const ALL: u32 = FLAG_NORMAL
    | FLAG_UV
    | FLAG_UV1
    | FLAG_UV2
    | FLAG_UV3
    | FLAG_UV4
    | FLAG_UV5
    | FLAG_UV6
    | FLAG_UV7
    | FLAG_COLOR;

/// A random set of the attributes `ALL` names.
fn attributes(rng: &mut Rng) -> u32 {
    UV_FLAGS
        .into_iter()
        .chain([FLAG_NORMAL, FLAG_COLOR])
        .filter(|_| rng.below(2) == 0)
        .fold(0, |flags, flag| flags | flag)
}

/// The ranges of a page of `flags`: one for each set of the fixed header, whether the page carries
/// it or not, and for each set past them only one the page carries.
fn uv_ranges(rng: &mut Rng, widest: bool, flags: u32) -> [UvRange; MAX_UV_SETS] {
    core::array::from_fn(|set| {
        if set < HEADER_UV_SETS || flags & UV_FLAGS[set] != 0 {
            uv_range(rng, widest)
        } else {
            UvRange::default()
        }
    })
}

/// A `bits`-wide field at most, or the widest when `widest`.
fn width(rng: &mut Rng, widest: bool, most: u32) -> u32 {
    if widest {
        most
    } else {
        rng.below(most + 1)
    }
}

/// The grid of positions: a cell, then each axis' start and width, every one in the format's bounds,
/// the widest start the bounds allow when `widest`.
fn position_grid(rng: &mut Rng, widest: bool) -> PositionGrid {
    let bits = [0; 3].map(|_| width(rng, widest, MAX_POSITION_BITS));
    let start = bits.map(|b| {
        let room = i32::MAX - ((1i64 << b) - 1) as i32;
        if widest {
            room
        } else {
            (rng.next() as i32).clamp(i32::MIN, room)
        }
    });
    let precisions = (MAX_POSITION_PRECISION - MIN_POSITION_PRECISION + 1) as u32;
    let precision = if widest {
        MIN_POSITION_PRECISION
    } else {
        MIN_POSITION_PRECISION + rng.below(precisions) as i32
    };
    PositionGrid {
        start,
        bits,
        precision,
    }
}

/// A texture set's range: widths within a code's, each least code leaving room for them.
fn uv_range(rng: &mut Rng, widest: bool) -> UvRange {
    let bits = [0; 2].map(|_| width(rng, widest, UV_CODE_BITS));
    let min = bits.map(|b| {
        let room = (1u32 << UV_CODE_BITS) - (1 << b);
        if widest {
            0
        } else {
            rng.next() % (room + 1)
        }
    });
    UvRange { min, bits }
}

/// The colour's range: widths within a byte's, each least byte leaving room for them.
fn color_range(rng: &mut Rng, widest: bool) -> ColorRange {
    let bits = [0; 4].map(|_| width(rng, widest, COLOR_BITS));
    let min = bits.map(|b| {
        let room = COLOR_LEVELS - ((1 << b) - 1);
        if widest {
            0
        } else {
            rng.below(room + 1)
        }
    });
    ColorRange { min, bits }
}

/// A page of `n` vertices on `indices`: random records, every field a random value of its width;
/// one page in three stores fewer positions than vertices, each vertex linked to one.
fn page(rng: &mut Rng, n: usize, indices: &[u32], flags: u32, widest: bool) -> Vec<u8> {
    let positions = if rng.below(3) == 0 {
        1 + rng.below(n as u32) as usize
    } else {
        n
    };
    let spans = Spans::of(indices);
    let code = CornerCode::of(n, indices.len(), spans.bits);
    let normal_precision = 1 + width(rng, widest, MAX_NORMAL_PRECISION - 1);
    let h = Header {
        vertex_count: n,
        index_count: indices.len(),
        flags,
        position: position_grid(rng, widest),
        uv: uv_ranges(rng, widest, flags),
        color: color_range(rng, widest),
        normal_precision,
        tangent_precision: width(rng, widest, MAX_TANGENT_PRECISION),
        corner_bits: spans.bits,
        position_count: positions,
        skin: crate::Skin::default(),
        morphs: Vec::new(),
    };
    let mut out = BitWriter::default();
    spans.write(&mut out, indices, &code);
    // Every field a random value of its width; a link, a random position.
    let mut streams = |bits: &[u32], present: bool, count: usize, below: u32| {
        if present {
            for &b in bits {
                let mask = ((1u64 << b) - 1) as u32;
                let value = |rng: &mut Rng| match below {
                    0 => rng.next() & mask,
                    _ => rng.below(below),
                };
                out.stream((0..count).map(|_| value(rng)), b);
            }
        }
    };
    streams(&h.position.bits, true, positions, 0);
    let (links, link_bits) = (h.links_positions(), h.link_bits());
    streams(&[link_bits], links, n, positions as u32);
    streams(&[normal_precision; 2], flags & FLAG_NORMAL != 0, n, 0);
    for (set, flag) in UV_FLAGS.into_iter().enumerate() {
        streams(&h.uv[set].bits, flags & flag != 0, n, 0);
    }
    streams(&h.color.bits, flags & FLAG_COLOR != 0, n, 0);
    let words = (h.words(RESIDENT_VERSION).into_iter()).chain(out.words().iter().copied());
    words.flat_map(u32::to_le_bytes).collect()
}

/// Both decoders agree, bit for bit, on the page read in place and from a copy (unaligned).
fn same(data: &[u8]) -> Result<(), PageError> {
    let expected = reference(data, 1 << 24);
    let mut shifted = vec![0u8];
    shifted.extend_from_slice(data);
    for bytes in [data, &shifted[1..]] {
        let decoded = decode_resident(bytes, 1 << 24).map(|page| page.words);
        assert_eq!(decoded, expected, "{} bytes", data.len());
    }
    expected.map(|_| ())
}

/// The corners of `triangles` triangles over `n` vertices, numbered by first use.
fn corners(rng: &mut Rng, n: usize, triangles: usize) -> Vec<u32> {
    let mut seen = 0u32;
    (0..3 * triangles)
        .map(|_| {
            let fresh = seen < n as u32 && (seen == 0 || rng.below(3) == 0);
            let corner = if fresh { seen } else { rng.below(seen) };
            seen = seen.max(corner + 1);
            corner
        })
        .collect()
}

/// A random page on disk of at most 85 triangles over `n` vertices: its triangles laid in strips in
/// the order given, every field of every vertex laid a random value of its width — the narrowest
/// widths make equal vertices, which the page names —, a link a random stored position, every
/// stored position used by a vertex; one page in three stores fewer positions than vertices.
fn values(rng: &mut Rng, n: usize, triangles: usize, flags: u32, widest: bool) -> Page {
    let indices = corners(rng, n, triangles.min(85));
    let strips = strips_in_order(&indices);
    let laid = strips.laid.len();
    let positions = if rng.below(3) == 0 {
        1 + rng.below(laid as u32) as usize
    } else {
        laid
    };
    let h = Header {
        vertex_count: laid,
        index_count: indices.len(),
        flags,
        position: position_grid(rng, widest),
        uv: uv_ranges(rng, widest, flags),
        color: color_range(rng, widest),
        normal_precision: 1 + width(rng, widest, MAX_NORMAL_PRECISION - 1),
        tangent_precision: width(rng, widest, MAX_TANGENT_PRECISION),
        corner_bits: Spans::of(&strips.triangles).bits,
        position_count: positions,
        skin: crate::Skin::default(),
        morphs: Vec::new(),
    };
    let mut field = |bits: u32, count: usize| -> Vec<u32> {
        let mask = ((1u64 << bits) - 1) as u32;
        (0..count).map(|_| rng.next() & mask).collect()
    };
    let streams = Streams {
        corners: strips.triangles,
        position: h.position.bits.map(|b| field(b, positions)),
        normal: [h.normal_precision; 2].map(|b| {
            if flags & FLAG_NORMAL != 0 {
                field(b, laid)
            } else {
                Vec::new()
            }
        }),
        uv: core::array::from_fn(|set| {
            h.uv[set].bits.map(|b| {
                if flags & UV_FLAGS[set] != 0 {
                    field(b, laid)
                } else {
                    Vec::new()
                }
            })
        }),
        color: h.color.bits.map(|b| {
            if flags & FLAG_COLOR != 0 {
                field(b, laid)
            } else {
                Vec::new()
            }
        }),
        ..Streams::default()
    };
    let links = if h.links_positions() {
        (0..laid)
            .map(|v| {
                if v < positions {
                    v as u32
                } else {
                    rng.below(positions as u32)
                }
            })
            .collect()
    } else {
        Vec::new()
    };
    Page {
        header: h,
        streams: Streams { links, ..streams },
        strip: strips.strip,
    }
}

mod decodes;
mod on_disk;
