//! The reference values of the single-number twins: the mip level's side, the sRGB decoding, the
//! Hermite basis and the seeded 32-bit steps (`golden.rs`, `golden_tests.rs`).

use crate::golden::{f64s, ordinary, Twin, Value, HOSTILE_F64};
use crate::random::{lcg32, xorshift32};
use crate::scalar::{hermite_basis, lerp, mip_size, mix};

pub(crate) fn twins() -> Vec<Twin> {
    vec![
        Twin {
            file: "mip_size",
            name: "mip_size",
            about: "mipSize (math scalar/integers.ts, WGSL mipSize in wgsl/integer.ts), mip_size (math/rust scalar.rs): the side halved level times by integer division, one texel at least",
            inputs: "size: u32 (an int32), level: u32",
            outputs: "1 u32",
            cases: mip_cases,
            compute: |v| vec![Value::U32(mip_size(v[0].u32(), v[1].u32()))],
        },
        Twin {
            file: "srgb_to_linear",
            name: "srgb_to_linear",
            about: "srgbToLinear (math color/color.ts), srgb_to_linear (math/rust color.rs): the sRGB decoding of the 256 bytes, the thresholds' neighbours, then ordinary values",
            inputs: "c: f64",
            outputs: "1 f64",
            cases: srgb_cases,
            compute: |v| f64s(&[crate::color::srgb_to_linear(v[0].f64())]),
        },
        Twin {
            file: "hermite_basis",
            name: "hermite_basis",
            about: "hermiteBasis (math scalar/hermite.ts), hermite_basis (math/rust scalar.rs): the four weights at w, by w2 = w*w and w3 = w2*w",
            inputs: "w: f64",
            outputs: "4 f64",
            cases: hermite_cases,
            compute: |v| f64s(&hermite_basis(v[0].f64())),
        },
        Twin {
            file: "interpolation",
            name: "lerp",
            about: "lerp (math scalar/reals.ts), lerp (math/rust scalar.rs): a + (b - a) * t, exact at t = 0",
            inputs: "a: f64, b: f64, t: f64",
            outputs: "1 f64",
            cases: interpolation_cases,
            compute: |v| f64s(&[lerp(v[0].f64(), v[1].f64(), v[2].f64())]),
        },
        Twin {
            file: "interpolation",
            name: "mix",
            about: "mix (math scalar/reals.ts), mix (math/rust scalar.rs): a * (1 - t) + b * t, exact at both ends",
            inputs: "a: f64, b: f64, t: f64",
            outputs: "1 f64",
            cases: interpolation_cases,
            compute: |v| f64s(&[mix(v[0].f64(), v[1].f64(), v[2].f64())]),
        },
        Twin {
            file: "xorshift32",
            name: "xorshift32",
            about: "xorshiftRandom (math sequence/random.ts), xorshift32 (math/rust random.rs): one step of the 32-bit xorshift from a nonzero state",
            inputs: "state: u32",
            outputs: "1 u32",
            cases: step_cases,
            compute: |v| {
                let mut state = v[0].u32();
                vec![Value::U32(xorshift32(&mut state))]
            },
        },
        Twin {
            file: "lcg32",
            name: "lcg32",
            about: "lcgRandom (math sequence/random.ts), lcg32 (math/rust random.rs): one step of the 32-bit congruential generator",
            inputs: "state: u32",
            outputs: "1 u32",
            cases: step_cases,
            compute: |v| {
                let mut state = v[0].u32();
                vec![Value::U32(lcg32(&mut state))]
            },
        },
    ]
}

/// Every side from zero to a few texels, the powers of two and their neighbours, the largest
/// int32, against every level through 33 and two far past it.
fn mip_cases() -> Vec<Vec<Value>> {
    let mut sizes: Vec<u32> = (0..=9).collect();
    for shift in 4..31 {
        sizes.extend([(1u32 << shift) - 1, 1 << shift, (1 << shift) + 1]);
    }
    sizes.extend([1000, 1920, 4095, 0x7fff_ffff]);
    let levels: Vec<u32> = (0..=33).chain([40, 1000]).collect();
    sizes
        .iter()
        .flat_map(|&s| {
            levels
                .iter()
                .map(move |&l| vec![Value::U32(s), Value::U32(l)])
        })
        .collect()
}

/// The 256 bytes on the unit interval, both sides of the threshold, the specials, then ordinary
/// values.
fn srgb_cases() -> Vec<Vec<Value>> {
    let mut x: Vec<f64> = (0..=255).map(|b| f64::from(b) / 255.0).collect();
    x.extend(HOSTILE_F64);
    x.extend([0.04045, 0.04044999999999999, 0.04045000000000001, 1.0, 0.5]);
    x.extend((0..128).map(|i| ordinary(i) / 100.0));
    x.into_iter().map(|v| f64s(&[v])).collect()
}

/// The ends and the middle of the interval, the specials, then ordinary values.
fn hermite_cases() -> Vec<Vec<Value>> {
    let mut x: Vec<f64> = HOSTILE_F64.to_vec();
    x.extend([0.25, 0.5, 0.75, 1.0 / 3.0]);
    x.extend((0..128).map(|i| ordinary(i) / 100.0));
    x.extend((0..64).map(|i| f64::from(i) / 63.0));
    x.into_iter().map(|v| f64s(&[v])).collect()
}

/// The specials against each other, the ends and the middle of `t`, then ordinary triples.
fn interpolation_cases() -> Vec<Vec<Value>> {
    let h = |i: usize| HOSTILE_F64[i % 16];
    let mut cases: Vec<Vec<Value>> = (0..256)
        .map(|i| f64s(&[h(i), h(i / 16), h(i * 5 + 2)]))
        .collect();
    for t in [0.0, 1.0, 0.5, 0.1, 1.0 / 3.0, -0.5, 1.5] {
        cases.push(f64s(&[0.1, 0.7, t]));
        cases.push(f64s(&[-3.0e8, 1.0e-3, t]));
    }
    cases.extend((0..128u64).map(|i| {
        f64s(&[
            ordinary(3 * i),
            ordinary(3 * i + 1),
            ordinary(3 * i + 2) / 100.0,
        ])
    }));
    cases
}

/// Chains of states, each next state from the one before, and the extreme words.
fn step_cases() -> Vec<Vec<Value>> {
    let mut states: Vec<u32> = vec![1, 2, 0xffff_ffff, 0x8000_0000, 0x2545_f491, 957];
    for seed in [1u32, 0xdead_beef, 12345] {
        let mut state = seed;
        for _ in 0..40 {
            states.push(state);
            xorshift32(&mut state);
        }
    }
    states.into_iter().map(|s| vec![Value::U32(s)]).collect()
}
