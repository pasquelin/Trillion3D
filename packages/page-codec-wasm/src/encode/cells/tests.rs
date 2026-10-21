//! The position quantizer dispatched at run time (`simd::dispatch`) writes the bits its baseline
//! copy writes: on an x86-64 processor with AVX2 the public entry point runs the AVX2 copy, the
//! body called directly the SSE2 one.

use super::quantize;
use crate::bits;
use trillion3d_math::sequence::random::xorshift64;

/// Positions over twenty octaves, within the 2^21 cells of the finest precision tried, negative and
/// positive, halves of a cell included: the values where a rounding or a reordered sum would show.
fn values(count: usize) -> Vec<f32> {
    let mut state = 1352u64 | 1;
    let mut next = move || xorshift64(&mut state);
    (0..count * 3)
        .map(|i| {
            let magnitude = ((next() % 20) as i32 - 10) as f32;
            let value = ((next() >> 40) as f32 / (1u64 << 24) as f32 - 0.5) * magnitude.exp2();
            if i % 7 == 0 {
                (value * 64.0).round() / 64.0 + 1.0 / 128.0
            } else {
                value
            }
        })
        .collect()
}

// Behaviour: the dispatched quantizer and the baseline one agree bit for bit.
#[test]
fn the_dispatched_quantizer_writes_the_baseline_bits() {
    let values = values(4099);
    for precision in [-6, -2, 0, 4] {
        let (grid, cells) = quantize(&values, precision).expect("fits the grid");
        let (expected, expected_cells) = bits::quantize_positions(&values, precision);
        assert_eq!(grid, expected);
        assert_eq!(cells, expected_cells);
    }
}

// Behaviour: a page whose positions span more cells than a page holds is refused, whatever the
// grid it was asked for.
#[test]
fn a_range_past_the_pages_cells_is_refused() {
    let wide = [0.0, 0.0, 0.0, 1.0e5, 0.0, 0.0];
    assert!(quantize(&wide, 4).is_err());
    assert!(quantize(&wide, -4).is_ok());
}
