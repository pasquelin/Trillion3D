//! The reference values of the compiler's mirrored encodings (`trillion3d_math::golden`): the
//! albedo bytes here, the proxy BVH's child boxes (`proxy/wide_tests.rs`). The octahedral normal
//! and the quantization are the codec's.

use trillion3d_math::golden::{f64s, run, Twin, Value, HOSTILE_F64};

fn twins() -> [Twin; 2] {
    [
        Twin {
            file: "albedo_pack",
            name: "albedo_pack",
            about: "a linear colour to four bytes, each channel clamped to [0, 1], times 255 and rounded half away from zero, alpha 255 (asset-compiler-rust albedo.rs pack; read by sdk-browser bounce nodeWgsl.ts proxyAlbedoOf)",
            inputs: "colour: 3 f64",
            outputs: "1 u32",
            cases: || {
                let hostile = (0..48).map(|i| [i, i * 5 + 1, i * 7 + 2].map(|k| HOSTILE_F64[k % 16]));
                let halves = (0..=255).map(|b| [(b as f64 + 0.5) / 255.0, b as f64 / 255.0, -1e-300]);
                hostile.chain(halves).map(|c| f64s(&c)).collect()
            },
            compute: |v| vec![Value::U32(crate::albedo::pack([0, 1, 2].map(|c| v[c].f64())))],
        },
        crate::proxy::wide::tests::twin(),
    ]
}

#[test]
fn golden_twins() {
    run(&twins());
}
