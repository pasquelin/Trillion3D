//! The octahedral normal both ways (`bits/oct.rs`): a normal to two bytes, two bytes back to a
//! unit normal, and a normal through both.

use crate::bits::{oct_decode, oct_encode};
use crate::min_ball::xorshift;
use trillion3d_math::golden::{f32s, Twin, Value};

pub(super) fn twins() -> [Twin; 3] {
    [
        Twin {
            file: "oct",
            name: "oct_encode",
            about: "a normal to two octahedral bytes, x low and y high, the best of the four neighbouring cells; a zero or non-finite one +z (page-codec-wasm bits/oct.rs oct_encode, the compiler's)",
            inputs: "normal: 3 f32",
            outputs: "1 u32",
            cases: normal_cases,
            compute: |v| vec![Value::U32(oct_encode(normal(v)))],
        },
        Twin {
            file: "oct",
            name: "oct_decode",
            about: "two octahedral bytes, x low and y high, back to a unit normal (page-codec-wasm bits/oct.rs oct_decode, sdk-browser cluster decode WGSL)",
            inputs: "q: u32",
            outputs: "3 f32",
            cases: code_cases,
            compute: |v| f32s(&oct_decode(v[0].u32())),
        },
        Twin {
            file: "oct",
            name: "oct_round_trip",
            about: "a normal encoded then decoded, the normal a page reader draws (oct_decode of oct_encode)",
            inputs: "normal: 3 f32",
            outputs: "3 f32",
            cases: normal_cases,
            compute: |v| f32s(&oct_decode(oct_encode(normal(v)))),
        },
    ]
}

fn normal(v: &[Value]) -> [f32; 3] {
    [0, 1, 2].map(|c| v[c].f32())
}

/// Axes, folds, zeros, non-finite and subnormal normals, then drawn ones.
fn normal_cases() -> Vec<Vec<Value>> {
    let mut normals: Vec<[f32; 3]> = vec![
        [0.0, 0.0, 0.0],
        [-0.0, -0.0, -0.0],
        [1.0, 0.0, 0.0],
        [0.0, -1.0, 0.0],
        [0.0, 0.0, -1.0],
        [-0.0, 0.0, 1.0],
        [1.0, 1.0, -1.0],
        [-1.0, 1e-45, -0.0],
        [f32::NAN, 0.0, 1.0],
        [f32::INFINITY, 0.0, 0.0],
        [3.0e38, 3.0e38, -3.0e38],
        [1e-40, -1e-40, 1e-45],
    ];
    let mut state = trillion3d_math::GOLDEN;
    let mut unit = || (xorshift(&mut state) >> 40) as f32 / (1u64 << 24) as f32;
    normals.extend((0..256).map(|_| [0; 3].map(|_| unit() * 2.0 - 1.0)));
    normals.into_iter().map(|n| f32s(&n)).collect()
}

/// Every first byte against the edges of the second, the anti-diagonal, then drawn pairs.
fn code_cases() -> Vec<Vec<Value>> {
    let mut q: Vec<u32> = [0u32, 1, 127, 128, 254, 255]
        .iter()
        .flat_map(|&y| (0..256).map(move |x| x | y << 8))
        .collect();
    q.extend((0..256).map(|x| x | (255 - x) << 8));
    let mut state = trillion3d_math::GOLDEN;
    q.extend((0..256).map(|_| (xorshift(&mut state) & 0xffff) as u32));
    q.into_iter().map(|q| vec![Value::U32(q)]).collect()
}
