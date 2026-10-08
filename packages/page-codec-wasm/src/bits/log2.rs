//! `floor(log2 x)` and `ceil(log2 x)` read from the bits of `x`, the same integer on every host,
//! for the grids (`grid.rs`); the TypeScript twin is `floorLog2` and `ceilLog2` of
//! `packages/page-codec/src/gridExponent.ts`.
//!
//! A platform's `log2` may differ from another's in its last bit, and next to a power of two
//! that bit carries the integer. These give the integer of the logarithm rounded to the nearest
//! double, as `x.log2().floor() as i32` does wherever `log2` rounds correctly there — the grids
//! were cut that way, every exponent the compiler wrote is kept (`log2_tests.rs` holds the
//! two to each other over the reference cases and around every power of two) —, without calling
//! any `log2`. A NaN or a negative gives 0, a zero `i32::MIN` and an infinity `i32::MAX`, as the
//! cast of the logarithm does.

/// ⌊2^p · ln 2⌋ for p in 0..=10. The doubles between the integers `e` and `e + 1` are 2^(p-52)
/// apart (`spacing`). With `x = 2^e · (2 − d · 2^-52)` just under 2^(e+1), `log2 x` lies
/// `d · 2^-53 / ln 2` under `e + 1`, to a relative 2^-43, and rounds to it when that is under
/// half the spacing: when `d ≤ ⌊2^p · ln 2⌋`. With `x = 2^e · (1 + d · 2^-52)` just over 2^e, it
/// lies `d · 2^-52 / ln 2` over `e` and rounds to it when `d ≤ ⌊2^(p-1) · ln 2⌋`. No `2^p · ln 2`
/// here is within 2^-34 of an integer: the relative 2^-43 never moves a count.
const LN2_STEPS: [u64; 11] = [0, 1, 2, 5, 11, 22, 44, 88, 177, 354, 709];

fn ln2_steps(p: i32) -> u64 {
    usize::try_from(p).map_or(0, |p| LN2_STEPS.get(p).copied().unwrap_or(0))
}

/// The `p` of the spacing 2^(p-52) of the doubles between `e` and `e + 1`: one binade holds
/// them, that of the larger magnitude, 2^p ≤ max(|e|, |e + 1|) − 1 < 2^(p+1); -1 between -1 and 1.
fn spacing(e: i32) -> i32 {
    let below = if e >= 0 { e } else { -e - 1 };
    if below > 0 {
        31 - below.leading_zeros() as i32
    } else {
        -1
    }
}

/// `x = 2^e · (1 + f · 2^-52)` for a positive finite `x`, as `(e, f)`; a subnormal is scaled by
/// 2^64 first, exactly.
fn split(x: f64) -> (i32, u64) {
    let (scaled, shift) = if x < f64::MIN_POSITIVE {
        (x * f64::from_bits((1023 + 64) << 52), 64)
    } else {
        (x, 0)
    };
    let bits = scaled.to_bits();
    ((bits >> 52) as i32 - 1023 - shift, bits & ((1 << 52) - 1))
}

/// What the cast of a logarithm gives for a value with no finite logarithm, or none.
fn special(x: f64) -> Option<i32> {
    match x {
        _ if x.is_nan() || x < 0.0 => Some(0),
        0.0 => Some(i32::MIN),
        f64::INFINITY => Some(i32::MAX),
        _ => None,
    }
}

/// `floor(log2 x)`: the exponent of `x`, or the power of two above when `x` lies so close
/// under it that the rounded logarithm is that power's.
pub fn floor_log2(x: f64) -> i32 {
    if let Some(cast) = special(x) {
        return cast;
    }
    let (e, f) = split(x);
    e + i32::from((1 << 52) - f <= ln2_steps(spacing(e)))
}

/// `ceil(log2 x)`: the exponent of `x` on a power of two, the next above otherwise, unless `x`
/// lies so close over the power that the rounded logarithm is that power's.
pub fn ceil_log2(x: f64) -> i32 {
    if let Some(cast) = special(x) {
        return cast;
    }
    let (e, f) = split(x);
    if f == 0 {
        return e;
    }
    e + 1 - i32::from(f <= ln2_steps(spacing(e) - 1))
}

#[cfg(test)]
#[path = "log2_tests.rs"]
mod tests;
