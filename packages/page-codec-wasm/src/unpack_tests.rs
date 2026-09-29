//! Equivalence harness of the sequential reader (STR-01/02/03, #238, E0): `decode` gives the same
//! words and the same refusal as develop's decoder — every field read at random, the first corner
//! out of range refusing —, kept here as the reference, on the audit's page shapes, ten thousand
//! random pages and their corruptions, and the edge cases.

use super::*;
use crate::bits::MAX_BITS;
use crate::triangles::{CornerCode, Spans};
use crate::unpack::reference::reference;
use crate::writer::BitWriter;

struct Rng(u32);

impl Rng {
    fn next(&mut self) -> u32 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 17;
        self.0 ^= self.0 << 5;
        self.0
    }
    fn below(&mut self, n: u32) -> u32 {
        self.next() % n
    }
}

/// Minima dequantization is most fragile around: ±0, subnormal, the float's bounds, and any.
fn minimum(rng: &mut Rng) -> f32 {
    let edges = [0.0, -0.0, 1e-45, -f32::MIN_POSITIVE, f32::MAX, -f32::MAX];
    match rng.below(10) as usize {
        k @ 0..6 => edges[k],
        _ => (rng.next() as f32 / 4e9 - 0.5) * 2f32.powi(rng.below(40) as i32 - 20),
    }
}

fn record<const N: usize>(rng: &mut Rng, widest: bool) -> Quant<N> {
    let bits = |r: &mut Rng| {
        if widest {
            MAX_BITS
        } else {
            r.below(MAX_BITS + 1)
        }
    };
    Quant {
        min: core::array::from_fn(|_| minimum(rng)),
        exponent: if widest {
            64
        } else {
            rng.below(129) as i32 - 64
        },
        bits: core::array::from_fn(|_| bits(rng)),
    }
}

/// A page of `n` vertices on `indices`: random records, every field a random value of its width;
/// one page in three stores fewer positions than vertices, each vertex linked to one (#960).
fn page(rng: &mut Rng, n: usize, indices: &[u32], flags: u32, widest: bool) -> Vec<u8> {
    let positions = if rng.below(3) == 0 {
        1 + rng.below(n as u32) as usize
    } else {
        n
    };
    let spans = Spans::of(indices);
    let code = CornerCode::of(n, indices.len(), spans.bits);
    let h = Header {
        vertex_count: n,
        index_count: indices.len(),
        flags,
        position: record(rng, widest),
        uv: record(rng, widest),
        uv1: record(rng, widest),
        color: record(rng, widest),
        quantization_error: 0.5,
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
    streams(&[16], flags & FLAG_NORMAL != 0, n, 0);
    streams(&h.uv.bits, flags & FLAG_UV != 0, n, 0);
    streams(&h.uv1.bits, flags & FLAG_UV1 != 0, n, 0);
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
        (64, 15),
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
    let (mut rng, mut refused) = (Rng(0x9E37_79B9), [0; 5]);
    for i in 0..10_000 {
        let n = 1 + rng.below(if i % 50 == 0 { 65_535 } else { 400 }) as usize;
        let triangles = 1 + rng.below(300) as usize;
        let indices = corners(&mut rng, n, triangles);
        let flags = rng.below(16);
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
    // Every field 24 bits wide on the coarsest grid over the float's bounds and ±0, and 65,535
    // vertices: 16-bit corners, and fields crossing words at every offset.
    let widest: Vec<u32> = (0..65_535).chain([65_534, 0, 1]).collect();
    assert!(same(&page(&mut rng, 65_535, &widest, 15, true)).is_ok());
    // A stream ending exactly on a word, then one bit past it.
    for n in [32, 33] {
        assert_eq!((n * MAX_BITS as usize).is_multiple_of(32), n == 32);
        let indices = corners(&mut rng, n, 40);
        assert!(same(&page(&mut rng, n, &indices, 15, true)).is_ok());
    }
    // A NaN or infinite minimum never dequantizes: both decoders refuse the header.
    for forged in [f32::NAN, f32::INFINITY, f32::NEG_INFINITY] {
        let mut data = page(&mut rng, 3, &[0, 1, 2], 0, false);
        data[24..28].copy_from_slice(&forged.to_le_bytes());
        assert_eq!(same(&data), Err(PageError::Bounds));
    }
}
