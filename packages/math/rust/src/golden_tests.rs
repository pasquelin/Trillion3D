//! The reference values of this crate's mirrored primitives (`golden.rs`): the 4×4 product, `hypot`,
//! the arc cosine, the sine and the quaternion normalisation, on hostile and ordinary inputs.

use crate::golden::{f64s, ordinary, run, Twin, Value, HOSTILE_F64};
use crate::matrix::{multiply_matrix4_one, MATRIX_VALUES};

fn twins() -> [Twin; 5] {
    [
        Twin {
            file: "matrix4_product",
            name: "matrix4_product",
            about: "multiplyMatrix4 (math matrix4.ts), multiply_matrix4_one (math/rust matrix.rs): a * b, column-major, each term the sum of four products in step order, no initial zero",
            inputs: "a: 16 f64, b: 16 f64",
            outputs: "16 f64",
            cases: product_cases,
            compute: |v| {
                let a: Vec<f64> = v[..MATRIX_VALUES].iter().map(|x| x.f64()).collect();
                let b: Vec<f64> = v[MATRIX_VALUES..].iter().map(|x| x.f64()).collect();
                let mut out = [0f64; MATRIX_VALUES];
                multiply_matrix4_one(&mut out, &a, &b);
                f64s(&out)
            },
        },
        Twin {
            file: "hypot",
            name: "hypot",
            about: "Math.hypot of 2, 3 or 4 values (math hypot.ts hypot2, hypot3, hypot4), hypot (math/rust js.rs)",
            inputs: "2 to 4 f64",
            outputs: "1 f64",
            cases: hypot_cases,
            compute: |v| {
                let x: Vec<f64> = v.iter().map(|x| x.f64()).collect();
                f64s(&[match x.len() {
                    2 => crate::js::hypot([x[0], x[1]]),
                    3 => crate::js::hypot([x[0], x[1], x[2]]),
                    _ => crate::js::hypot([x[0], x[1], x[2], x[3]]),
                }])
            },
        },
        Twin {
            file: "acos",
            name: "acos",
            about: "fdlibm's arc cosine (math/rust acos.rs, math trig.ts)",
            inputs: "x: f64",
            outputs: "1 f64",
            cases: acos_cases,
            compute: |v| f64s(&[crate::acos::acos(v[0].f64())]),
        },
        Twin {
            file: "sin",
            name: "sin",
            about: "fdlibm's sine below 2^20 * pi/2 (math/rust trig.rs, math trig.ts fdlibmSin)",
            inputs: "x: f64",
            outputs: "1 f64",
            cases: sin_cases,
            compute: |v| f64s(&[crate::trig::sin(v[0].f64())]),
        },
        Twin {
            file: "quaternion_normalize",
            name: "quaternion_normalize",
            about: "normalizeQuaternion (sdk-core quaternion.ts), normalize (math/rust quaternion.rs): the compensated squares between 2^-900 and 2^900, Math.hypot outside, a zero or NaN length taken as 1",
            inputs: "q: 4 f64 (x, y, z, w)",
            outputs: "4 f64",
            cases: normalize_cases,
            compute: |v| {
                let mut q: Vec<f64> = v.iter().map(|x| x.f64()).collect();
                crate::quaternion::normalize(&mut q);
                f64s(&q)
            },
        },
    ]
}

/// Hostile quaternions: each a rotation of the hostile values, the zero, the huge and the tiny.
fn normalize_cases() -> Vec<Vec<Value>> {
    let mut cases: Vec<Vec<Value>> = (0..64)
        .map(|i| f64s(&[0, 5, 9, 14].map(|k| HOSTILE_F64[(i + k * (i / 16 + 1)) % 16])))
        .collect();
    for scale in [0.0, 1e-160, 2f64.powi(-450), 2f64.powi(450), 1e160, 5e-324] {
        cases.push(f64s(&[0.5, -0.5, 0.5, 0.5].map(|c| c * scale)));
    }
    cases
}

/// Hostile matrices against each other, a column of negative zeros, then ordinary ones.
fn product_cases() -> Vec<Vec<Value>> {
    let hostile =
        |k: usize, step: usize| (0..MATRIX_VALUES).map(move |j| HOSTILE_F64[(k + step * j) % 16]);
    let mut cases: Vec<Vec<Value>> = (0..16)
        .map(|k| f64s(&hostile(k, 1).chain(hostile(3 * k, 5)).collect::<Vec<_>>()))
        .collect();
    let mut zeros = [0f64; 32];
    for diagonal in 0..4 {
        zeros[diagonal * 5] = 1.0;
        zeros[16 + diagonal * 5] = 1.0;
    }
    zeros[0] = -0.0;
    zeros[4] = -1.0;
    cases.push(f64s(&zeros));
    cases.extend(
        (0..32u64).map(|c| f64s(&(0..32).map(|j| ordinary(c * 32 + j)).collect::<Vec<_>>())),
    );
    cases
}

/// Every pair of hostile values, hostile triples and quadruples, the rounding a plain root misses.
fn hypot_cases() -> Vec<Vec<Value>> {
    let h = |i: usize| HOSTILE_F64[i % 16];
    let mut cases: Vec<Vec<Value>> = (0..256).map(|i| f64s(&[h(i), h(i / 16)])).collect();
    cases.extend((0..64).map(|i| f64s(&[h(i), h(i * 7 + 3), h(i * 11 + 5)])));
    cases.extend((0..64).map(|i| f64s(&[h(i), h(i * 3 + 1), h(i * 5 + 2), h(i * 13 + 7)])));
    cases.extend((0..64u64).map(|i| f64s(&[ordinary(i), ordinary(i + 64), ordinary(i + 128)])));
    cases.push(f64s(&[
        0.4471859335899353,
        -0.1211518868803978,
        0.4516414701938629,
    ]));
    cases.push(f64s(&[f64::NAN, -1e-320, -4e159, f64::INFINITY]));
    cases
}

/// `x` and its neighbours, `steps` floats on each side.
fn around(x: f64, steps: usize) -> Vec<f64> {
    let (mut low, mut out) = (x, vec![x]);
    let mut high = x;
    for _ in 0..steps {
        low = low.next_down();
        high = high.next_up();
        out.extend([low, high]);
    }
    out
}

/// The specials, every branch edge of fdlibm's arc cosine, then ordinary values of `[-1, 1]`.
fn acos_cases() -> Vec<Vec<Value>> {
    let mut x: Vec<f64> = HOSTILE_F64.to_vec();
    for edge in [0.5, -0.5, 1.0, -1.0, 2f64.powi(-57), -(2f64.powi(-57))] {
        x.extend(around(edge, 3));
    }
    x.extend((0..128).map(|i| ordinary(i) / 100.0));
    x.into_iter().map(|v| f64s(&[v])).collect()
}

/// Zeros, subnormals, the specials, each threshold of the reduction, then ordinary angles.
fn sin_cases() -> Vec<Vec<Value>> {
    let mut x = vec![
        0.0,
        -0.0,
        5e-324,
        -1e-320,
        f64::NAN,
        f64::INFINITY,
        f64::NEG_INFINITY,
    ];
    for high in [
        0x3e500000u64,
        0x3fe921fb,
        0x4002d97c,
        0x400f6a7a,
        0x4012d97c,
        0x401921fb,
    ] {
        x.extend(around(f64::from_bits(high << 32), 2));
    }
    x.extend((1..=9).map(|m| f64::from(m) * core::f64::consts::FRAC_PI_4));
    x.extend((0..128).map(|i| ordinary(i) / 100.0 * core::f64::consts::PI));
    x.into_iter().map(|v| f64s(&[v])).collect()
}

#[test]
fn golden_twins() {
    run(&twins());
}
