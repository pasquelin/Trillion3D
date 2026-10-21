//! The smaller and the larger of two numbers as the unwraps' steps compare them, by one `<` each, so
//! what a tie and a NaN give is part of the step. Two forms of each, which differ on exactly those:
//!
//! - `least` and `most` keep the first argument only on a strict comparison, so a NaN in either
//!   gives the second;
//! - `lesser` and `greater` keep the first argument unless the second is strictly smaller or
//!   larger, so a tie, or a NaN in the second, gives the first.

/// `a` when strictly less than `b`, else `b`.
#[inline]
pub(crate) fn least<T: PartialOrd>(a: T, b: T) -> T {
    if a < b {
        a
    } else {
        b
    }
}

/// `a` when strictly greater than `b`, else `b`.
#[inline]
pub(crate) fn most<T: PartialOrd>(a: T, b: T) -> T {
    if a > b {
        a
    } else {
        b
    }
}

/// `b` when strictly less than `a`, else `a`.
#[inline]
pub(crate) fn lesser<T: PartialOrd>(a: T, b: T) -> T {
    if b < a {
        b
    } else {
        a
    }
}

/// `b` when strictly greater than `a`, else `a`.
#[inline]
pub(crate) fn greater<T: PartialOrd>(a: T, b: T) -> T {
    if a < b {
        b
    } else {
        a
    }
}
