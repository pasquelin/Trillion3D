//! The float a matrix is composed in, `f32` or `f64`: what is generic over it keeps the caller's
//! rounding, so each caller's output bits.

use core::ops::{Add, Div, Mul, Neg, Sub};

/// `f32` or `f64`. Its sine, cosine and tangent are the platform's (`std`), which may differ in the
/// last bit between hosts; `trig::sin` is fdlibm's, the same everywhere.
pub trait Real:
    Copy
    + Add<Output = Self>
    + Sub<Output = Self>
    + Mul<Output = Self>
    + Div<Output = Self>
    + Neg<Output = Self>
{
    const ZERO: Self;
    const NEG_ZERO: Self;
    const ONE: Self;
    const TWO: Self;
    fn sin_cos(self) -> (Self, Self);
    fn sin(self) -> Self;
    fn cos(self) -> Self;
    fn tan(self) -> Self;
    fn sqrt(self) -> Self;
}

macro_rules! real {
    ($float:ty) => {
        impl Real for $float {
            const ZERO: Self = 0.0;
            const NEG_ZERO: Self = -0.0;
            const ONE: Self = 1.0;
            const TWO: Self = 2.0;
            #[inline]
            fn sin_cos(self) -> (Self, Self) {
                <$float>::sin_cos(self)
            }
            #[inline]
            fn sin(self) -> Self {
                <$float>::sin(self)
            }
            #[inline]
            fn cos(self) -> Self {
                <$float>::cos(self)
            }
            #[inline]
            fn tan(self) -> Self {
                <$float>::tan(self)
            }
            #[inline]
            fn sqrt(self) -> Self {
                <$float>::sqrt(self)
            }
        }
    };
}
real!(f32);
real!(f64);

#[cfg(test)]
#[path = "real_tests.rs"]
mod tests;
