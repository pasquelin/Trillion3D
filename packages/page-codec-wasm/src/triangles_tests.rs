//! Equivalence of the corner code (CMP-09's harness, E0): what `Spans::write` codes, `read` gives
//! back bit for bit, on random pages and on the edge cases — no triangle, one vertex, a partial
//! last block, the widest meshlet — and a forged record fails the gate, never read past its stream.

use super::*;
use crate::bits::stream_words;
use trillion3d_math::random::xorshift32 as xorshift;
use trillion3d_math::GOLDEN_32;

/// The words of the block table then of the corner stream that code `indices`, and their code.
fn coded(indices: &[u32], vertex_count: usize) -> (CornerCode, Vec<u32>) {
    let spans = Spans::of(indices);
    let code = CornerCode::of(vertex_count, indices.len(), spans.bits);
    let mut out = BitWriter::default();
    spans.write(&mut out, indices, &code);
    (code, out.words().to_vec())
}

fn bytes(words: &[u32]) -> Vec<u8> {
    words.iter().flat_map(|w| w.to_le_bytes()).collect()
}

/// `indices` coded then decoded against a page of `vertex_count` vertices.
fn round_trip(indices: &[u32], vertex_count: usize) -> Result<Vec<u32>, PageError> {
    let (code, words) = coded(indices, vertex_count);
    let table = stream_words(code.blocks, code.record_bits());
    assert_eq!(words.len(), table + stream_words(code.bits, 1));
    assert!(code.fits(&bytes(&words[..table]), vertex_count, indices.len()));
    let mut decoded = vec![u32::MAX; indices.len()];
    code.read(&words, [0, table], vertex_count, &mut decoded)?;
    Ok(decoded)
}

/// A page numbered by first use, as the compiler writes one: each corner a new vertex, one of
/// the last dozen met, or any met before.
fn page(state: &mut u32, corners: usize) -> Vec<u32> {
    let mut seen = 0;
    (0..corners)
        .map(|_| {
            let r = xorshift(state);
            let corner = match (r % 3, seen) {
                (_, 0) | (0, _) => seen,
                (1, _) => seen - 1 - (r >> 8) % seen.min(12),
                _ => (r >> 8) % seen,
            };
            seen = seen.max(corner + 1);
            corner
        })
        .collect()
}

#[test]
fn ten_thousand_random_pages_decode_to_the_same_corners() {
    let mut state = GOLDEN_32;
    for _ in 0..10_000 {
        let corners = 3 + 3 * (xorshift(&mut state) as usize % 300);
        let indices = page(&mut state, corners);
        let count = 1 + *indices.iter().max().unwrap() as usize;
        assert_eq!(round_trip(&indices, count).unwrap(), indices);
    }
}

#[test]
fn the_edge_cases_decode_to_the_same_corners() {
    let widest: Vec<u32> = (0..65_535u32)
        .chain([65_534, 0, 1])
        .chain((0..3 * 1000).map(|i| (i * 7919) % 65_535))
        .collect();
    let cases: [(Vec<u32>, usize); 6] = [
        (vec![], 1),
        (vec![0, 0, 0], 1),
        ((0..3 * 13).collect(), 39),
        (vec![5, 5, 5, 5, 5, 5], 6),
        (vec![0, 65_534, 1], 65_535),
        (widest, 65_535),
    ];
    for (indices, vertices) in cases {
        assert_eq!(round_trip(&indices, vertices).unwrap(), indices);
    }
}

#[test]
fn a_forged_record_fails_the_gate_and_a_forged_corner_the_read() {
    let indices = [0, 1, 2, 2, 1, 3];
    let (code, mut words) = coded(&indices, 4);
    let mut decoded = [0u32; 6];
    let width_at = code.index_bits;
    // A width past 16, then one wider than an index, then a base at the vertex count.
    for forged in [17u32, 3] {
        let mut table = words[..1].to_vec();
        table[0] = (table[0] & !(31 << width_at)) | forged << width_at;
        assert!(!code.fits(&bytes(&table), 4, 6));
    }
    assert!(code.fits(&bytes(&words[..1]), 4, 6));
    assert!(!code.fits(&bytes(&words[..1]), 0, 6));
    let result = code.read(&words, [0, 1], 3, &mut decoded);
    assert_eq!(result, Err(PageError::Index));
    words[1] = 0;
    assert!(code.read(&words, [0, 1], 4, &mut decoded).is_ok());
    assert_eq!(decoded, [0; 6]);
}
