//! The reference values of the compiler's mirrored encodings (`trillion3d_math::golden`): the
//! albedo bytes here. The octahedral normal, the quantization and the proxy BVH's child boxes are
//! the codec's.

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
        Twin {
            file: "preview_levels",
            name: "preview_levels",
            about: "previewFirstLevel and previewLastLevel (sdk-core texture/previewLevels.ts), preview_first_level and preview_last_level (asset-compiler-rust texture_preview/levels.rs): the finest level carried, the first whose sides fit PREVIEW_BASE, and the last, where both sides are one texel",
            inputs: "width: u32, height: u32",
            outputs: "first level: u32, last level: u32",
            cases: || {
                let sides = [
                    1u32, 2, 3, 63, 64, 65, 100, 127, 128, 129, 255, 256, 257, 1000, 1024, 4096, 4097,
                    16384, 32768,
                ];
                sides
                    .iter()
                    .flat_map(|&w| sides.iter().map(move |&h| vec![Value::U32(w), Value::U32(h)]))
                    .collect()
            },
            compute: |v| {
                let (w, h) = (v[0].u32(), v[1].u32());
                vec![
                    Value::U32(crate::texture_preview::preview_first_level(w, h)),
                    Value::U32(crate::texture_preview::preview_last_level(w, h)),
                ]
            },
        },
    ]
}

#[test]
fn golden_twins() {
    run(&twins());
}
