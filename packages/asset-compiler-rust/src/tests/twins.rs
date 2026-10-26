//! The reference values of the compiler's mirrored encodings (`trillion3d_math::golden`): the
//! preview levels here. The octahedral normal and the culling hierarchy are the codec's.

use trillion3d_math::golden::{run, Twin, Value};

fn twins() -> [Twin; 1] {
    [
        Twin {
            file: "preview_levels",
            name: "preview_levels",
            about: "previewFirstLevel and previewLastLevel (sdk-core texture/previewLevels.ts), preview_first_level and preview_last_level (asset-compiler-rust texture/levels.rs): the finest level carried, the first whose sides fit PREVIEW_BASE, and the last, where both sides are one texel",
            inputs: "width: u32, height: u32",
            outputs: "first level: u32, last level: u32",
            ulps: 0,
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
                    Value::U32(crate::texture::preview_first_level(w, h)),
                    Value::U32(crate::texture::preview_last_level(w, h)),
                ]
            },
        },
    ]
}

#[test]
fn golden_twins() {
    run(&twins());
}
