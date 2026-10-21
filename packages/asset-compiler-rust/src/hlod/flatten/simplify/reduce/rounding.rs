//! The roundings of a float to a 32-bit integer the reduction takes its counts and slabs with,
//! as the x86 conversion the method was built on computes them: the value doubled and offset by a
//! half, rounded to the nearest integer with ties to even — a rounded value past the 32-bit range,
//! or NaN, reads as the range's least —, then halved by an arithmetic shift. On every value whose
//! doubled value is in range that is the plain floor or ceiling; past it, the floor of a huge
//! value or of an infinity is `−2³⁰`, which a clamp then reads as its lower bound.

/// `x` rounded to the nearest integer, ties to even, or `i32::MIN` when that is past the range or
/// `x` is NaN.
fn nearest(x: f32) -> i32 {
    let rounded = x.round_ties_even();
    if (-2_147_483_648.0..2_147_483_648.0).contains(&rounded) {
        rounded as i32
    } else {
        i32::MIN
    }
}

/// The greatest integer not above `x`.
pub(super) fn floor_i32(x: f32) -> i32 {
    nearest(x + x - 0.5) >> 1
}

/// The least integer not below `x`.
pub(super) fn ceil_i32(x: f32) -> i32 {
    -(nearest(-0.5 - (x + x)) >> 1)
}
