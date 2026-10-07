//! fdlibm's sine, as the `libm` crate (0.2.16, `src/math/{sin,k_sin,k_cos,rem_pio2}.rs`, MIT,
//! from musl and FreeBSD msun) writes it, its constants written by their bits, for every argument
//! below 2^20 · π/2 — the reduction past it (Payne–Hanek) is not carried: the animation sampler's
//! angles stay within [0, π/2]. The TypeScript twin is `fdlibmSin` of
//! `packages/math/src/float/trig.ts`: the same bits on that range.
//!
//! The original notice, which fdlibm asks to keep:
//!
//! Copyright (C) 1993 by Sun Microsystems, Inc. All rights reserved.
//! Developed at SunSoft, a Sun Microsystems, Inc. business. Permission to use, copy, modify, and
//! distribute this software is freely granted, provided that this notice is preserved.

const S1: f64 = f64::from_bits(0xBFC55555_55555549); // -1.66666666666666324348e-01
const S2: f64 = f64::from_bits(0x3F811111_1110F8A6); // 8.33333333332248946124e-03
const S3: f64 = f64::from_bits(0xBF2A01A0_19C161D5); // -1.98412698298579493134e-04
const S4: f64 = f64::from_bits(0x3EC71DE3_57B1FE7D); // 2.75573137070700676789e-06
const S5: f64 = f64::from_bits(0xBE5AE5E6_8A2B9CEB); // -2.50507602534068634195e-08
const S6: f64 = f64::from_bits(0x3DE5D93A_5ACFD57C); // 1.58969099521155010221e-10
const C1: f64 = f64::from_bits(0x3FA55555_5555554C); // 4.16666666666666019037e-02
const C2: f64 = f64::from_bits(0xBF56C16C_16C15177); // -1.38888888888741095749e-03
const C3: f64 = f64::from_bits(0x3EFA01A0_19CB1590); // 2.48015872894767294178e-05
const C4: f64 = f64::from_bits(0xBE927E4F_809C52AD); // -2.75573143513906633035e-07
const C5: f64 = f64::from_bits(0x3E21EE9E_BDB4B1C4); // 2.08757232129817482790e-09
const C6: f64 = f64::from_bits(0xBDA8FAE9_BE8838D4); // -1.13596475577881948265e-11
const TO_INT: f64 = 1.5 / f64::EPSILON;
const INV_PIO2: f64 = f64::from_bits(0x3FE45F30_6DC9C883); // 6.36619772367581382433e-01
const PIO2_1: f64 = f64::from_bits(0x3FF921FB_54400000); // 1.57079632673412561417e+00
const PIO2_1T: f64 = f64::from_bits(0x3DD0B461_1A626331); // 6.07710050650619224932e-11
const PIO2_2: f64 = f64::from_bits(0x3DD0B461_1A600000); // 6.07710050630396597660e-11
const PIO2_2T: f64 = f64::from_bits(0x3BA3198A_2E037073); // 2.02226624879595063154e-21
const PIO2_3: f64 = f64::from_bits(0x3BA3198A_2E000000); // 2.02226624871116645580e-21
const PIO2_3T: f64 = f64::from_bits(0x397B839A_252049C1); // 8.47842766036889956997e-32

/// sin(x + y), |x| ≤ π/4, `y` the tail of a reduced argument (`iy` = 1); `iy` = 0: no tail.
fn k_sin(x: f64, y: f64, iy: i32) -> f64 {
    let z = x * x;
    let w = z * z;
    let r = S2 + z * (S3 + z * S4) + z * w * (S5 + z * S6);
    let v = z * x;
    if iy == 0 {
        x + v * (S1 + z * r)
    } else {
        x - ((z * (0.5 * y - v * r) - y) - v * S1)
    }
}

/// cos(x + y), |x| ≤ π/4.
fn k_cos(x: f64, y: f64) -> f64 {
    let z = x * x;
    let w = z * z;
    let r = z * (C1 + z * (C2 + z * C3)) + w * w * (C4 + z * (C5 + z * C6));
    let hz = 0.5 * z;
    let w = 1.0 - hz;
    w + (((1.0 - w) - hz) + (z * r - x * y))
}

/// `rint(x / (π/2))` and the remainder, in up to three rounds.
fn medium(x: f64, ix: u32) -> (i32, f64, f64) {
    let f_n = x * INV_PIO2 + TO_INT - TO_INT;
    let n = f_n as i32;
    let mut r = x - f_n * PIO2_1;
    let mut w = f_n * PIO2_1T;
    let mut y0 = r - w;
    let ex = (ix >> 20) as i32;
    let ey = (y0.to_bits() >> 52) as i32 & 0x7ff;
    if ex - ey > 16 {
        let t = r;
        w = f_n * PIO2_2;
        r = t - w;
        w = f_n * PIO2_2T - ((t - r) - w);
        y0 = r - w;
        let ey = (y0.to_bits() >> 52) as i32 & 0x7ff;
        if ex - ey > 49 {
            let t = r;
            w = f_n * PIO2_3;
            r = t - w;
            w = f_n * PIO2_3T - ((t - r) - w);
            y0 = r - w;
        }
    }
    let y1 = (r - y0) - w;
    (n, y0, y1)
}

/// `x` less `n` quarter turns of its sign in one round, `n` from 1 to 4.
fn quarter_turns(x: f64, n: i32) -> (i32, f64, f64) {
    let k = if x.is_sign_negative() { -n } else { n };
    let turns = f64::from(n);
    if k > 0 {
        let z = x - turns * PIO2_1;
        let y0 = z - turns * PIO2_1T;
        (k, y0, (z - y0) - turns * PIO2_1T)
    } else {
        let z = x + turns * PIO2_1;
        let y0 = z + turns * PIO2_1T;
        (k, y0, (z - y0) + turns * PIO2_1T)
    }
}

/// `libm`'s `rem_pio2` below 2^20 · π/2: `None` past it.
fn rem_pio2(x: f64) -> Option<(i32, f64, f64)> {
    let ix = (x.to_bits() >> 32) as u32 & 0x7fffffff;
    if ix <= 0x400f6a7a {
        if (ix & 0xfffff) == 0x921fb {
            return Some(medium(x, ix));
        }
        return Some(quarter_turns(x, if ix <= 0x4002d97c { 1 } else { 2 }));
    }
    if ix <= 0x401c463b {
        if ix <= 0x4015fdbc {
            if ix == 0x4012d97c {
                return Some(medium(x, ix));
            }
            return Some(quarter_turns(x, 3));
        }
        if ix == 0x401921fb {
            return Some(medium(x, ix));
        }
        return Some(quarter_turns(x, 4));
    }
    (ix < 0x413921fb).then(|| medium(x, ix))
}

/// sin x, the bits of `libm::sin` for |x| < 2^20 · π/2 and for NaN or an infinity (NaN); NaN past
/// that range, which no caller reaches.
pub(crate) fn sin(x: f64) -> f64 {
    let ix = (x.to_bits() >> 32) as u32 & 0x7fffffff;
    if ix <= 0x3fe921fb {
        if ix < 0x3e500000 {
            return x;
        }
        return k_sin(x, 0.0, 0);
    }
    if ix >= 0x7ff00000 {
        #[allow(clippy::eq_op)]
        return x - x;
    }
    let Some((n, y0, y1)) = rem_pio2(x) else {
        return f64::NAN;
    };
    match n & 3 {
        0 => k_sin(y0, y1, 1),
        1 => k_cos(y0, y1),
        2 => -k_sin(y0, y1, 1),
        _ => -k_cos(y0, y1),
    }
}

#[cfg(test)]
mod tests {
    use super::sin;

    /// `libm::sin` itself on every branch of the reduction below 2^20 · π/2: both edges of each
    /// threshold, the near multiples of π/2, the specials, and a sweep of the range's bit patterns.
    #[test]
    fn the_bits_are_libm_s() {
        let mut inputs = vec![f64::NAN, f64::INFINITY, f64::NEG_INFINITY, 0.0, -0.0];
        let mut edges: Vec<f64> = (1..=9)
            .map(|m| f64::from(m) * core::f64::consts::FRAC_PI_4)
            .collect();
        edges.extend([2f64.powi(-26), 1.0, 1.0e6, 1_647_098.0]);
        for high in [
            0x3e500000u64,
            0x3fe921fb,
            0x4002d97c,
            0x400f6a7a,
            0x4012d97c,
            0x4015fdbc,
            0x401921fb,
            0x401c463b,
        ] {
            edges.push(f64::from_bits(high << 32));
            edges.push(f64::from_bits((high << 32) | 0xffff_ffff));
        }
        for edge in edges {
            let mut x = edge;
            for _ in 0..1500 {
                x = x.next_down();
            }
            for _ in 0..3000 {
                inputs.push(x);
                inputs.push(-x);
                x = x.next_up();
            }
        }
        let top = 1_647_098.0f64.to_bits();
        inputs.extend((0..1u64 << 20).map(|i| f64::from_bits(i * (top / (1 << 20)))));
        for x in inputs {
            let (ours, theirs) = (sin(x), libm::sin(x));
            assert!(
                ours.to_bits() == theirs.to_bits() || (ours.is_nan() && theirs.is_nan()),
                "sin({x:e})"
            );
        }
    }
}
