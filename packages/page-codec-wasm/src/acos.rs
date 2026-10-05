//! fdlibm's arccosine, as the `libm` crate (0.2.16, `src/math/acos.rs`, MIT, from musl) writes it,
//! its constants written by their bits, with one change: its square root is the instruction's
//! (`f64::sqrt`, `f64.sqrt` in WebAssembly).
//! On `wasm32` stable Rust, `libm` takes its own software square root (the hardware path needs
//! its nightly `intrinsics` feature), the cost of most of the run-time cut's cone. IEEE-754 rounds a
//! square root correctly, and `libm`'s soft one returns the correctly rounded result too: the one
//! nearest float, so the same bits on every host, the cooked cones and the run-time ones alike.
//!
//! The original notice, which fdlibm asks to keep:
//!
//! Copyright (C) 1993 by Sun Microsystems, Inc. All rights reserved.
//! Developed at SunSoft, a Sun Microsystems, Inc. business. Permission to use, copy, modify, and
//! distribute this software is freely granted, provided that this notice is preserved.
//!
//! Method: `acos(x) = π/2 − (x + x·x²·R(x²))` for `|x| ≤ 0.5`; above, with `z = (1 − |x|)/2` and
//! `s = √z`, `acos(x) = 2s + 2s·z·R(z)` (its high part `f` and correction `c = (z − f²)/(s + f)`
//! summed apart) and `acos(−x) = π − 2s − 2s·z·R(z)`; `acos(±1)` is `0` or `π`, NaN outside.

const PIO2_HI: f64 = f64::from_bits(0x3FF921FB_54442D18); // 1.57079632679489655800e+00
const PIO2_LO: f64 = f64::from_bits(0x3C91A626_33145C07); // 6.12323399573676603587e-17
const PS0: f64 = f64::from_bits(0x3FC55555_55555555); // 1.66666666666666657415e-01
const PS1: f64 = f64::from_bits(0xBFD4D612_03EB6F7D); // -3.25565818622400915405e-01
const PS2: f64 = f64::from_bits(0x3FC9C155_0E884455); // 2.01212532134862925881e-01
const PS3: f64 = f64::from_bits(0xBFA48228_B5688F3B); // -4.00555345006794114027e-02
const PS4: f64 = f64::from_bits(0x3F49EFE0_7501B288); // 7.91534994289814532176e-04
const PS5: f64 = f64::from_bits(0x3F023DE1_0DFDF709); // 3.47933107596021167570e-05
const QS1: f64 = f64::from_bits(0xC0033A27_1C8A2D4B); // -2.40339491173441421878e+00
const QS2: f64 = f64::from_bits(0x40002AE5_9C598AC8); // 2.02094576023350569471e+00
const QS3: f64 = f64::from_bits(0xBFE6066C_1B8D0159); // -6.88283971605453293030e-01
const QS4: f64 = f64::from_bits(0x3FB3B8C5_B12E9282); // 7.70381505559019352791e-02

fn r(z: f64) -> f64 {
    let p: f64 = z * (PS0 + z * (PS1 + z * (PS2 + z * (PS3 + z * (PS4 + z * PS5)))));
    let q: f64 = 1.0 + z * (QS1 + z * (QS2 + z * (QS3 + z * QS4)));
    p / q
}

/// The arc cosine of `x` in `[0, π]`, the bits of `libm::acos`.
pub(crate) fn acos(x: f64) -> f64 {
    let x1p_120f = f64::from_bits(0x3870000000000000); // 2^-120
    let hx = (x.to_bits() >> 32) as u32;
    let ix = hx & 0x7fffffff;
    // |x| >= 1 or NaN.
    if ix >= 0x3ff00000 {
        let lx = x.to_bits() as u32;
        if ((ix - 0x3ff00000) | lx) == 0 {
            // acos(1) = 0, acos(-1) = π.
            if (hx >> 31) != 0 {
                return 2. * PIO2_HI + x1p_120f;
            }
            return 0.;
        }
        // NaN, the input's own when it is one.
        #[allow(clippy::eq_op)]
        return 0. / (x - x);
    }
    // |x| < 0.5.
    if ix < 0x3fe00000 {
        if ix <= 0x3c600000 {
            // |x| < 2^-57.
            return PIO2_HI + x1p_120f;
        }
        return PIO2_HI - (x - (PIO2_LO - x * r(x * x)));
    }
    // x < -0.5.
    if (hx >> 31) != 0 {
        let z = (1.0 + x) * 0.5;
        let s = z.sqrt();
        let w = r(z) * s - PIO2_LO;
        return 2. * (PIO2_HI - (s + w));
    }
    // x > 0.5.
    let z = (1.0 - x) * 0.5;
    let s = z.sqrt();
    // The low four bytes set to zero.
    let df = f64::from_bits(s.to_bits() & 0xff_ff_ff_ff_00_00_00_00);
    let c = (z - df * df) / (s + df);
    let w = r(z) * s + c;
    2. * (df + w)
}

#[cfg(test)]
mod tests {
    use super::acos;

    /// `libm::acos` itself, on every branch: both edges of each, then a sweep of the bit patterns
    /// of `[-1, 1]` and the specials. This transcription drifts from it by no bit.
    #[test]
    fn the_bits_are_libm_s() {
        let mut inputs = vec![f64::NAN, f64::INFINITY, -2.0, -0.0, 0.0, 1.0, -1.0];
        for edge in [
            0.5f64,
            -0.5,
            1.0,
            -1.0,
            0.0,
            2f64.powi(-57),
            -(2f64.powi(-57)),
        ] {
            let mut x = edge;
            for _ in 0..2000 {
                x = x.next_down();
            }
            for _ in 0..4000 {
                inputs.push(x);
                x = x.next_up();
            }
        }
        let (lo, hi) = (1f64.to_bits(), 0x8000_0000_0000_0000u64 | 1f64.to_bits());
        inputs.extend((0..1u64 << 20).map(|i| f64::from_bits(i * (lo / (1 << 20)))));
        inputs.extend((0..1u64 << 20).map(|i| f64::from_bits(hi - i * (lo / (1 << 20)))));
        for x in inputs {
            assert_eq!(acos(x).to_bits(), libm::acos(x).to_bits(), "acos({x:e})");
        }
    }
}
