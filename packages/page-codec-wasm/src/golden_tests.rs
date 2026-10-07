//! The reference values of the codec's mirrored primitives (`trillion3d_math::golden`): the
//! quaternion normalisation and slerp of the animation sampler here, the octahedral normal
//! (`oct.rs`) and the quantization (`quant.rs`) each with its inverse, and a primitive's grids
//! (`grid.rs`).

use crate::anim::{normalize, sample_tracks, ARC_VALUES, QUATERNION};
use trillion3d_math::golden::{f32s, f64s, run, Twin, Value, HOSTILE_F64};

pub(crate) mod grid;
mod oct;
mod quant;

fn twins() -> [Twin; 2] {
    [
        Twin {
            file: "quaternion_normalize",
            name: "quaternion_normalize",
            about: "normalizeQuaternion (sdk-core quaternion.ts), normalize (page-codec-wasm anim.rs): the compensated squares between 2^-900 and 2^900, Math.hypot outside, a zero or NaN length taken as 1",
            inputs: "q: 4 f64 (x, y, z, w)",
            outputs: "4 f64",
            cases: normalize_cases,
            compute: |v| {
                let mut q: Vec<f64> = v.iter().map(|x| x.f64()).collect();
                normalize(&mut q);
                f64s(&q)
            },
        },
        Twin {
            file: "quaternion_slerp",
            name: "quaternion_slerp",
            about: "the animation sampler's rotation track (sdk-core sample.ts slerpArc and slerpOnArc, page-codec-wasm anim.rs): two linear keys at times 0 and 1 sampled at t, the shorter arc, then normalised",
            inputs: "a: 4 f32, b: 4 f32 (x, y, z, w), t: f64",
            outputs: "4 f64",
            cases: slerp_cases,
            compute: |v| {
                let mut data = vec![0.0f32, 1.0];
                data.extend(v[..8].iter().map(|x| x.f32()));
                let (mut keys, mut arcs, mut out) = ([0u32], [-1.0f64; ARC_VALUES], [0f64; 4]);
                let track = [0, 2, 2, 4, QUATERNION, 0];
                sample_tracks(&track, &data, &mut keys, &mut arcs, &mut out, v[8].f64());
                f64s(&out)
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

/// Pairs of rotations, the shorter arc and the longer, equal and opposite keys, at five times.
fn slerp_cases() -> Vec<Vec<Value>> {
    let h = core::f32::consts::FRAC_1_SQRT_2;
    let rotations: [[f32; 4]; 6] = [
        [0.0, 0.0, 0.0, 1.0],
        [0.0, h, 0.0, h],
        [0.0, -1.0, 0.0, 0.0],
        [0.5, 0.5, 0.5, 0.5],
        [-0.0, 0.0, 1e-7, -1.0],
        [0.1, -0.2, 0.3, 0.9273618],
    ];
    let mut cases = Vec::new();
    for (i, a) in rotations.iter().enumerate() {
        for b in &rotations[i..] {
            for t in [0.0, 0.25, 0.5, 0.75, 1.0 - f64::EPSILON] {
                let mut case = f32s(&[*a, *b].concat());
                case.push(Value::F64(t));
                cases.push(case);
            }
        }
    }
    cases
}

#[test]
fn golden_twins() {
    let twins = twins()
        .into_iter()
        .chain(oct::twins())
        .chain(quant::twins())
        .chain(grid::twins());
    run(&twins.collect::<Vec<_>>());
}
