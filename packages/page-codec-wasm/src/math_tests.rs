use super::*;
use crate::min_ball::xorshift;
use std::hint::black_box;

/// Values that break a careless transform: signed zeros, the extremes, subnormals, infinities and
/// NaN, beside ordinary ones.
const HOSTILE: [f64; 16] = [
    0.0,
    -0.0,
    1.0,
    -1.0,
    0.5,
    -2.0,
    1e308,
    -1e308,
    1e-320,
    -1e-320,
    f64::INFINITY,
    f64::NEG_INFINITY,
    f64::NAN,
    3.0000000000000004,
    1e154,
    -1e154,
];

#[test]
fn the_affine_sums_are_the_corner_walk_s_bits() {
    let mut state = 0x9e37_79b9_7f4a_7c15u64;
    let mut draw = || xorshift(&mut state);
    let value = |draw: &mut dyn FnMut() -> u64| match draw() % 4 {
        0 => HOSTILE[(draw() % 16) as usize],
        1 => [0.0, -0.0][(draw() % 2) as usize],
        _ => (draw() >> 11) as f64 / (1u64 << 53) as f64 * 200.0 - 100.0,
    };
    let (mut affine, mut zeros) = (0, 0);
    for _ in 0..1_000_000 {
        let mut m: [f64; 16] = std::array::from_fn(|_| value(&mut draw));
        if draw() % 4 != 0 {
            for at in [3, 7, 11] {
                m[at] = [0.0, -0.0][(draw() % 2) as usize];
            }
            m[15] = 1.0;
        }
        let mut b: [f64; 6] = std::array::from_fn(|_| value(&mut draw));
        for axis in 0..3 {
            if b[axis + 3] < b[axis] {
                b.swap(axis, axis + 3);
            }
        }
        let (lo, hi) = ([b[0], b[1], b[2]], [b[3], b[4], b[5]]);
        let (mut fast, mut walked) = ([0f64; 6], [0f64; 6]);
        corner_walk(&mut walked, lo, hi, &m);
        if affine_box(&mut fast, lo, hi, &m) {
            affine += 1;
            zeros += usize::from(fast.contains(&0.0));
            assert_eq!(
                fast.map(f64::to_bits),
                walked.map(f64::to_bits),
                "{m:?} {b:?}"
            );
        }
    }
    // Both paths are exercised, signed zeros among the results.
    assert!(affine > 150_000 && zeros > 10_000, "{affine} {zeros}");
}

#[test]
fn javascript_min_and_max_keep_nan_and_order_signed_zeros() {
    assert!(js_min(1.0, f64::NAN).is_nan() && js_max(f64::NAN, 0.0).is_nan());
    assert!(js_min(0.0, -0.0).is_sign_negative() && js_min(-0.0, 0.0).is_sign_negative());
    assert!(js_max(0.0, -0.0).is_sign_positive() && js_max(-0.0, 0.0).is_sign_positive());
    assert_eq!(js_min(1.0, 0.25), 0.25);
    assert_eq!(js_max(0.0, -3.0), 0.0);
}

#[test]
fn hypot_rounds_as_javascript_does_where_a_plain_root_does_not() {
    // `Math.hypot` of these three in Node and Chrome; `sqrt` of the squares is one bit higher.
    let (x, y, z) = (0.4471859335899353, -0.1211518868803978, 0.4516414701938629);
    assert_eq!(hypot([x, y, z]).to_bits(), 0x3fe4b46054c7ac11);
    assert_ne!((x * x + y * y + z * z).sqrt().to_bits(), 0x3fe4b46054c7ac11);
    assert_eq!(hypot([-3.0, 4.0, 12.0]), 13.0);
    assert_eq!(hypot([3.0, 4.0, 0.0, 0.0]), 5.0);
    assert_eq!(hypot([0.0, -0.0, 0.0]).to_bits(), 0);
    // An infinity before a NaN, then a NaN before any number, the inputs opaque to the optimiser:
    // the four-value form `anim.rs` carried before returned NaN on the second, once optimised.
    assert_eq!(
        hypot(black_box([f64::NAN, f64::NEG_INFINITY, 1.0])),
        f64::INFINITY
    );
    assert_eq!(
        hypot(black_box([f64::NAN, -1e-320, -4e159, f64::INFINITY])),
        f64::INFINITY
    );
    assert!(hypot(black_box([f64::NAN, 2.0, 1.0])).is_nan());
}
