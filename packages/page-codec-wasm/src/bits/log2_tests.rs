//! The integer logarithms read from the bits (`log2.rs`) against two references that give the same
//! answer on every host: the exact integers, derived from the bits and rational bounds of ln 2 —
//! `2^k ≤ x < 2^(k+1)` but in the band of doubles so close to a power of two that the correctly
//! rounded logarithm is that power's —, and the cast of `libm`'s `log2`, pure Rust. Over the values
//! the grids' reference cases reach, around every power of two and on a spread of others.

use super::{ceil_log2, floor_log2, LN2_STEPS};
use crate::bits::grid::object_units;
use trillion3d_math::golden::Value;
use trillion3d_math::GOLDEN;

/// ⌊ln 2 · 2^64⌋: ln 2 · 2^64 lies strictly between it and the next integer.
const LN2_64: u128 = 0xB172_17F7_D1CF_79AB;

/// `x = m · 2^p` exactly for a positive finite `x`: its integer significand and its exponent.
fn parts(x: f64) -> (u64, i32) {
    let bits = x.to_bits();
    let (field, fraction) = ((bits >> 52) as i32, bits & ((1 << 52) - 1));
    match field {
        0 => (fraction, -1074),
        _ => (fraction | 1 << 52, field - 1075),
    }
}

/// The exponent of half the gap between the integer `n` and the double next to it, above or below.
fn half_gap(n: i32, above: bool) -> i32 {
    let at = f64::from(n);
    let next = match (at == 0.0, (at > 0.0) == above) {
        (true, _) => f64::from_bits(1).copysign(if above { 1.0 } else { -1.0 }),
        (false, outward) => f64::from_bits(at.to_bits() + 1 - 2 * u64::from(!outward)),
    };
    let (m, p) = parts((next - at).abs());
    p + 63 - m.leading_zeros() as i32 - 1
}

/// Whether `d · 2^shift`, a distance to a power of two over half a gap in units of 2^-64, lies
/// under `low`; not when over `high`. Between the two the bounds cannot tell, and no double of the
/// sweep may land there.
fn under(d: u64, shift: i32, low: u128, high: u128) -> bool {
    if 64 - d.leading_zeros() as i32 + shift > 127 {
        return false;
    }
    let scaled = u128::from(d) << shift;
    assert!(
        scaled < low || scaled > high,
        "{d} · 2^{shift} is too near ln 2"
    );
    scaled < low
}

/// The exact `(floor, ceil)` of the correctly rounded `log2 x` for a positive finite `x`. With
/// `x = 2^(k+1) · (1 − ε)` and `h` half the gap of the doubles under `k + 1`, the logarithm rounds
/// to `k + 1` when `ε ≤ 1 − 2^-h`, and `(1 − 2^-h) / h` lies in [ln 2 − h, ln 2]; with
/// `x = 2^k · (1 + ε)` and `h` that over `k`, it rounds to `k` when `ε ≤ 2^h − 1`, and
/// `(2^h − 1) / h` lies in [ln 2, ln 2 + h]. Every `h` here is at most 2^-44.
fn exact(x: f64) -> (i32, i32) {
    let (m, p) = parts(x);
    let bits = 64 - m.leading_zeros() as i32;
    let k = p + bits - 1;
    if m.is_power_of_two() {
        return (k, k);
    }
    let slack = 1 << 20;
    let (low, high) = (LN2_64 - slack, LN2_64 + 1);
    let shift = 64 - bits - half_gap(k + 1, false);
    let floor = k + i32::from(under((1 << bits) - m, shift, low, high));
    let (low, high) = (LN2_64, LN2_64 + 1 + slack);
    let shift = 64 - (bits - 1) - half_gap(k, true);
    let ceil = k + 1 - i32::from(under(m - (1 << (bits - 1)), shift, low, high));
    (floor, ceil)
}

fn assert_integers(x: f64) {
    let (floor, ceil) = match x {
        _ if x.is_nan() || x < 0.0 => (0, 0),
        0.0 => (i32::MIN, i32::MIN),
        f64::INFINITY => (i32::MAX, i32::MAX),
        _ => exact(x),
    };
    assert_eq!(floor_log2(x), floor, "floor of log2 {x:e}");
    assert_eq!(ceil_log2(x), ceil, "ceil of log2 {x:e}");
    let reference = libm::log2(x);
    assert_eq!(
        floor_log2(x),
        reference.floor() as i32,
        "libm floor of log2 {x:e}"
    );
    assert_eq!(
        ceil_log2(x),
        reference.ceil() as i32,
        "libm ceil of log2 {x:e}"
    );
}

// Behaviour: `LN2_64` is ⌊ln 2 · 2^64⌋: ln 2 = Σ 1 / (k · 2^k), summed in units of 2^-126 to an
// error under 2^7 of them, far from the boundary of the integer it gives.
#[test]
fn the_bound_of_ln2_is_its_integer_part() {
    let sum: u128 = (1..=126u32)
        .map(|k| ((1u128 << 126) / u128::from(k)) >> k)
        .sum();
    let fraction = sum & ((1 << 62) - 1);
    assert!(fraction > 1 << 8 && fraction < (1 << 62) - (1 << 8));
    assert_eq!(sum >> 62, LN2_64);
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
        assert_integers(x);
    }
}

// Behaviour: every span, extent, error and scale of the grids' reference cases, and the values the
// rules take their logarithm of — an eighth of an error, a tile in object units —, give the
// exact integers.
#[test]
fn the_reference_cases_keep_their_integers() {
    for twin in crate::golden_tests::grid::twins() {
        for case in (twin.cases)() {
            for value in case {
                if let Value::F64(x) = value {
                    for derived in [x, x / 8.0, object_units(2.0, Some(x))] {
                        assert_integers(derived);
                        assert_integers(-derived);
                    }
                }
            }
        }
    }
}

// Behaviour: within 1,024 doubles of every power of two, subnormal to the largest — past the
// widest band, 709, where the rounded logarithm reaches the integer —, the exact integers.
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
                    assert_integers(f64::from_bits(bits));
                }
            }
        }
    }
}

// Behaviour: a spread of positive doubles over every exponent gives the exact integers.
#[test]
fn a_spread_of_doubles_keeps_its_integers() {
    for i in 0..1u64 << 20 {
        let bits = i.wrapping_mul(GOLDEN) >> 1;
        if bits <= f64::MAX.to_bits() {
            assert_integers(f64::from_bits(bits));
        }
    }
}
