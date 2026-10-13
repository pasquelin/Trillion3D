//! The quantizers dispatched at run time (`simd::dispatch`) write the bits their baseline
//! copy writes: on an x86-64 processor with AVX2 the public entry points run the AVX2 copy, the
//! bodies called directly the SSE2 one.

use super::{max_error, quantize};
use crate::bits;
use trillion3d_math::random::xorshift64;

/// Positions over twenty octaves, within the 2^24 cells of the finest grid tried, negative and
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

// Behaviour: the dispatched quantizers and the baseline ones agree bit for bit.
#[test]
fn dispatched_quantizers_write_the_baseline_bits() {
    let values = values(4099);
    for exponent in [-12, -6, 0, 4] {
        let (record, cells) = quantize::<3>(&values, exponent).expect("fits the grid");
        let (expected, expected_cells) = bits::quantize::<3>(&values, exponent).expect("fits");
        assert_eq!(record.min.map(f32::to_bits), expected.min.map(f32::to_bits));
        assert_eq!(
            (record.bits, record.exponent),
            (expected.bits, expected.exponent)
        );
        assert_eq!(cells, expected_cells);
        assert_eq!(
            max_error(&values, &record, &cells).to_bits(),
            bits::quantization_error(&values, &expected, &expected_cells).to_bits()
        );
    }
}
