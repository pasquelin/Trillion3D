//! Equivalence harness of the sequential reader (STR-01/02/03, E0): `decode` gives the same
//! words and the same refusal as the reference decoder — every field read at random, the first
//! corner out of range refusing —, kept here as the reference, on the page shapes of the format,
//! ten thousand random pages and their corruptions, and the edge cases.

use super::*;
use crate::bits::{ColorRange, PositionGrid, UvRange, MAX_BITS};
use crate::triangles::{CornerCode, Spans};
use crate::unpack::reference::reference;
use crate::writer::BitWriter;
use crate::{
    COLOR_BITS, COLOR_LEVELS, FLAG_UV, FLAG_UV1, FLAG_UV2, FLAG_UV3, MAX_NORMAL_PRECISION,
    MAX_POSITION_BITS, MAX_POSITION_PRECISION, MAX_TANGENT_PRECISION, MIN_POSITION_PRECISION,
    UV_CODE_BITS,
};
use trillion3d_math::sequence::random::xorshift32;
use trillion3d_math::GOLDEN_32;

struct Rng(u32);

impl Rng {
    fn next(&mut self) -> u32 {
        xorshift32(&mut self.0)
    }
    fn below(&mut self, n: u32) -> u32 {
        self.next() % n
    }
}

/// Every attribute a page carries but the stored tangent: the normal, the four texture sets and
/// the colour.
const ALL: u32 = FLAG_NORMAL | FLAG_UV | FLAG_UV1 | FLAG_UV2 | FLAG_UV3 | FLAG_COLOR;

/// A random set of the attributes `ALL` names.
fn attributes(rng: &mut Rng) -> u32 {
    UV_FLAGS
        .into_iter()
        .chain([FLAG_NORMAL, FLAG_COLOR])
        .filter(|_| rng.below(2) == 0)
        .fold(0, |flags, flag| flags | flag)
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
        uv: core::array::from_fn(|_| uv_range(rng, widest)),
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
    let words = h.words().into_iter().chain(out.words().iter().copied());
    words.flat_map(u32::to_le_bytes).collect()
}

/// Both decoders agree, bit for bit, on the page read in place and from a copy (unaligned).
fn same(data: &[u8]) -> Result<(), PageError> {
    let expected = reference(data, 1 << 24);
    let mut shifted = vec![0u8];
    shifted.extend_from_slice(data);
    for bytes in [data, &shifted[1..]] {
        let decoded = decode(bytes, 1 << 24).map(|page| page.words);
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

#[test]
fn the_audits_page_shapes_decode_to_the_same_words() {
    let mut rng = Rng(12345);
    let shapes = [
        (9, 3),
        (24, 3),
        (64, 3),
        (72, 1),
        (64, ALL),
        (181, 3),
        (128, 0),
    ];
    for (side, flags) in shapes {
        let mut indices = Vec::new();
        for y in 0..side - 1 {
            for a in (y * side..).take(side - 1).map(|a| a as u32) {
                let (b, c) = (a + 1, a + side as u32);
                indices.extend([a, c, b, b, c, c + 1]);
            }
        }
        assert!(same(&page(&mut rng, side * side, &indices, flags, false)).is_ok());
    }
}

#[test]
fn ten_thousand_random_pages_and_their_corruptions_decode_the_same() {
    let (mut rng, mut refused) = (Rng(GOLDEN_32), [0; 5]);
    for i in 0..10_000 {
        let n = 1 + rng.below(if i % 50 == 0 { 65_535 } else { 400 }) as usize;
        let triangles = 1 + rng.below(300) as usize;
        let indices = corners(&mut rng, n, triangles);
        let flags = attributes(&mut rng);
        let mut data = page(&mut rng, n, &indices, flags, false);
        if i % 4 == 3 {
            let at = rng.below(data.len() as u32) as usize;
            data[at] ^= 1 << rng.below(8);
        }
        if let Err(cause) = same(&data) {
            refused[cause as usize] += 1;
        }
    }
    // The corruptions reach both late refusals, the block table and a corner out of range.
    assert!(refused[PageError::Bounds as usize] > 0 && refused[PageError::Index as usize] > 0);
}

#[test]
fn the_edge_cases_decode_the_same() {
    let mut rng = Rng(7);
    // The smallest page, then no triangle and no byte: refused alike.
    assert!(same(&page(&mut rng, 1, &[0, 0, 0], 0, false)).is_ok());
    assert_eq!(
        same(&page(&mut rng, 1, &[], 0, false)),
        Err(PageError::Bounds)
    );
    assert_eq!(same(&[]), Err(PageError::Header));
    // Every field at its widest, on the finest grid and the farthest cells, and 65,535 vertices:
    // 16-bit corners, and fields crossing words at every offset.
    let widest: Vec<u32> = (0..65_535).chain([65_534, 0, 1]).collect();
    assert!(same(&page(&mut rng, 65_535, &widest, ALL, true)).is_ok());
    // A stream ending exactly on a word, then one bit past it.
    for n in [32, 33] {
        assert_eq!((n * MAX_BITS as usize).is_multiple_of(32), n == 32);
        let indices = corners(&mut rng, n, 40);
        assert!(same(&page(&mut rng, n, &indices, ALL, true)).is_ok());
    }
    // A precision past the format's, finer or coarser, never decodes: both decoders refuse the header.
    for forged in [
        (MAX_POSITION_PRECISION + 1) as i8,
        (MIN_POSITION_PRECISION - 1) as i8,
    ] {
        let mut data = page(&mut rng, 3, &[0, 1, 2], 0, false);
        data[23] = forged as u8;
        assert_eq!(same(&data), Err(PageError::Bounds));
    }
}
