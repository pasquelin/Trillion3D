//! The skin and morph streams of a page: written, read back, and refused when their records lie.

use super::*;
use crate::triangles::{CornerCode, Spans};
use crate::writer::BitWriter;
use crate::{decode, Header, Layout, PageError};

const N: usize = 3;

/// A one-triangle page, skinned on joints 5 to 8 and carrying two morph targets.
fn page(start_shift: usize) -> Vec<u8> {
    let indices = [0u32, 1, 2];
    let spans = Spans::of(&indices);
    let code = CornerCode::of(N, 3, spans.bits);
    let target = |bits: u32| Morph {
        start: 0,
        position: Quant {
            min: [-1.0, 0.0, 0.5],
            exponent: -4,
            bits: [bits, 0, 2],
        },
        normal: Quant {
            min: [0.0, -0.25, 0.0],
            exponent: -8,
            bits: [0, 3, 0],
        },
    };
    let mut h = Header {
        vertex_count: N,
        index_count: 3,
        flags: FLAG_SKIN | FLAG_MORPH,
        position: Quant::flat(-8),
        uv: Quant::flat(-14),
        uv1: Quant::flat(-14),
        color: Quant::flat(-8),
        quantization_error: 0.0,
        corner_bits: spans.bits,
        position_count: N,
        skin: Skin { base: 5, bits: 2 },
        morphs: vec![target(4), target(1)],
    };
    let layout = Layout::of(&h);
    h.morphs[0].start = layout.morph + start_shift;
    h.morphs[1].start = layout.morph + morph_words(&h.morphs[0], N);
    let mut out = BitWriter::default();
    spans.write(&mut out, &indices, &code);
    for (base, bits) in [(0u32, 2u32), (1, 2), (2, 2), (3, 2)] {
        out.stream((0..N as u32).map(|v| (v + base) % 4), bits);
    }
    for stored in [[255u32, 128, 0], [0, 127, 100], [0, 0, 100]] {
        out.stream(stored.into_iter(), WEIGHT_BITS);
    }
    for morph in &h.morphs {
        for bits in morph.bits() {
            out.stream((0..N as u32).map(|v| v & ((1 << bits) - 1)), bits);
        }
    }
    let words = h.words().into_iter().chain(out.words().iter().copied());
    words.flat_map(u32::to_le_bytes).collect()
}

#[test]
fn joints_weights_and_targets_decode_from_their_streams() {
    let decoded = decode(&page(0), 1 << 24).expect("page");
    assert_eq!(decoded.morph_targets, 2);
    let skin = decoded.attribute(5).expect("joints");
    // Vertex 1: joint fields 1, 2, 3, 0 on base 5; weights 128, 127, 0 and what they leave.
    assert_eq!(skin[4..8], [6.0, 7.0, 8.0, 5.0]);
    let weights = decoded.attribute(6).expect("weights");
    assert_eq!(weights[4..8], [128.0 / 255.0, 127.0 / 255.0, 0.0, 0.0]);
    // Vertex 0 stores 255 and 0, 0: its last weight is zero; vertex 2 stores 0, 100, 100: 55.
    assert_eq!(weights[3], 0.0);
    assert_eq!(weights[11], 55.0 / 255.0);
    let morph = decoded.attribute(7).expect("targets");
    // Vertex 2, target 0: x field 2 on 2^-4 from -1, z field 2 from 0.5, normal y field 2 on 2^-8.
    assert_eq!(
        morph[24..30],
        [-0.875, 0.0, 0.625, 0.0, -0.25 + 2.0 / 256.0, 0.0]
    );
    // Target 1's x is one bit wide: field 0 at vertex 2.
    assert_eq!(morph[30], -1.0);
}

#[test]
fn a_record_that_lies_or_is_not_announced_refuses_the_page() {
    assert_eq!(decode(&page(1), 1 << 24).unwrap_err(), PageError::Bounds);
    let good = page(0);
    let mut unflagged = good.clone();
    unflagged[16] = 0; // word 4: no flag, records still there
    assert_eq!(decode(&unflagged, 1 << 24).unwrap_err(), PageError::Bounds);
    // Word 23's low byte: the joint width in six bits, then the two low bits of the target count.
    let mut none = good.clone();
    none[92] = 2; // no target, the flag still set
    assert_eq!(decode(&none, 1 << 24).unwrap_err(), PageError::Bounds);
    let mut wide = good;
    wide[92] = 17 | 128; // a joint seventeen bits wide
    assert_eq!(decode(&wide, 1 << 24).unwrap_err(), PageError::Bounds);
}

#[test]
fn the_last_weight_never_falls_below_zero() {
    assert_eq!(last_weight([200, 100, 0]), 0);
    assert_eq!(last_weight([100, 50, 5]), 100);
}
