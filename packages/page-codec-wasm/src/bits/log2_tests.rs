//! The integer logarithms read from the bits (`log2.rs`) against the cast of this host's `log2`,
//! which cut every grid so far: equal on every value the grids' reference cases reach, around every
//! power of two, and on a spread of others — so no exponent the compiler writes moves.

use super::{ceil_log2, floor_log2, LN2_STEPS};
use crate::bits::grid::object_units;
use trillion3d_math::golden::Value;
use trillion3d_math::GOLDEN;

fn assert_cast(x: f64) {
    assert_eq!(
        floor_log2(x),
        x.log2().floor() as i32,
        "floor of log2 {x:e}"
    );
    assert_eq!(ceil_log2(x), x.log2().ceil() as i32, "ceil of log2 {x:e}");
}

// Behaviour: the counts are ⌊2^p · ln 2⌋, none so near an integer that the 2^-43 the bound
// neglects could move it.
#[test]
fn the_steps_are_the_logarithm_of_two_scaled() {
    for (p, steps) in LN2_STEPS.iter().enumerate() {
        let scaled = 2f64.powi(p as i32) * std::f64::consts::LN_2;
        assert_eq!(*steps, scaled.floor() as u64);
        let fraction = scaled - scaled.floor();
        assert!(fraction > 2f64.powi(-30) && fraction < 1.0 - 2f64.powi(-30));
    }
}

// Behaviour: what has no finite logarithm gives what the cast gives: 0 for a NaN or a negative,
// the extremes for a zero and an infinity.
#[test]
fn values_without_a_finite_logarithm_cast_as_before() {
    for x in [
        f64::NAN,
        -f64::NAN,
        0.0,
        -0.0,
        f64::INFINITY,
        f64::NEG_INFINITY,
        -1.0,
        -5e-324,
        -f64::MAX,
    ] {
        assert_cast(x);
    }
}

// Behaviour: every span, extent, error and scale of the grids' reference cases, and the values the
// rules take their logarithm of — an eighth of an error, a tile in object units —, give the
// same integers.
#[test]
fn the_reference_cases_keep_their_integers() {
    for twin in crate::golden_tests::grid::twins() {
        for case in (twin.cases)() {
            for value in case {
                if let Value::F64(x) = value {
                    for derived in [x, x / 8.0, object_units(2.0, Some(x))] {
                        assert_cast(derived);
                        assert_cast(-derived);
                    }
                }
            }
        }
    }
}

// Behaviour: within 1,024 doubles of every power of two, subnormal to the largest — past the
// widest band, 709, where the rounded logarithm reaches the integer —, the same integers.
#[test]
fn every_power_of_two_and_its_neighbours_keep_their_integers() {
    let smallest = 1u64;
    let largest = f64::MAX.to_bits();
    for k in -1074..=1023i32 {
        let power = if k < -1022 {
            1u64 << (k + 1074)
        } else {
            ((k + 1023) as u64) << 52
        };
        for d in 0..=1024u64 {
            for bits in [power.saturating_sub(d), power + d] {
                if (smallest..=largest).contains(&bits) {
                    assert_cast(f64::from_bits(bits));
                }
            }
        }
    }
}

// Behaviour: a spread of positive doubles over every exponent gives the same integers.
#[test]
fn a_spread_of_doubles_keeps_its_integers() {
    for i in 0..1u64 << 20 {
        let bits = i.wrapping_mul(GOLDEN) >> 1;
        if bits <= f64::MAX.to_bits() {
            assert_cast(f64::from_bits(bits));
        }
    }
}
