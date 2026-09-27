//! Equivalence of the corner code (CMP-09's harness, E0): what `write` codes, `read` gives back
//! bit for bit, on random pages and on the edge cases — no triangle, one vertex, a partial last
//! block, the widest meshlet — and a forged record is refused, never read past its stream.

use super::*;

fn xorshift(state: &mut u32) -> u32 {
    *state ^= *state << 13;
    *state ^= *state >> 17;
    *state ^= *state << 5;
    *state
}

/// `indices` coded then decoded against a page of `vertex_count` vertices.
fn round_trip(indices: &[u32], vertex_count: usize) -> Result<Vec<u32>, PageError> {
    let code = CornerCode::of(vertex_count, indices.len(), corner_bits(indices));
    let mut out = BitWriter::default();
    write(&mut out, indices, &code);
    let table = (code.blocks * code.record_bits() as usize).div_ceil(32);
    assert_eq!(out.words().len(), table + code.bits.div_ceil(32));
    let mut decoded = vec![u32::MAX; indices.len()];
    code.read(out.words(), [0, table], vertex_count, &mut decoded)?;
    Ok(decoded)
}

/// A page numbered by first use, as the compiler writes one: each corner is a new vertex or
/// one already met, near the frontier or anywhere before it.
fn page(state: &mut u32, triangles: usize, vertices: usize) -> Vec<u32> {
    let mut seen = 0u32;
    (0..triangles * 3)
        .map(|_| {
            let r = xorshift(state);
            if seen == 0 || (r.is_multiple_of(3) && (seen as usize) < vertices) {
                seen += 1;
                seen - 1
            } else if r % 3 == 1 {
                seen - 1 - (r >> 8) % seen.min(12)
            } else {
                (r >> 8) % seen
            }
        })
        .collect()
}

#[test]
fn ten_thousand_random_pages_decode_to_the_same_corners() {
    let mut state = 0x9E37_79B9;
    for _ in 0..10_000 {
        let triangles = 1 + xorshift(&mut state) as usize % 300;
        let vertices = 1 + xorshift(&mut state) as usize % 400;
        let indices = page(&mut state, triangles, vertices);
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
fn a_forged_record_or_corner_is_refused() {
    let indices = [0, 1, 2, 2, 1, 3];
    let code = CornerCode::of(4, 6, corner_bits(&indices));
    let mut out = BitWriter::default();
    write(&mut out, &indices, &code);
    let mut words = out.words().to_vec();
    let mut decoded = [0u32; 6];
    let width_at = code.index_bits;
    for (word, forged) in [(0, 17u32 << width_at), (0, 3u32 << width_at)] {
        let mut bad = words.clone();
        bad[word] = (bad[word] & !(31 << width_at)) | forged;
        let result = code.read(&bad, [0, 1], 4, &mut decoded);
        assert_eq!(result, Err(PageError::Index));
    }
    assert_eq!(
        code.read(&words, [0, 1], 3, &mut decoded),
        Err(PageError::Index)
    );
    words[1] = 0;
    assert!(code.read(&words, [0, 1], 4, &mut decoded).is_ok());
    assert_eq!(decoded, [0; 6]);
}
