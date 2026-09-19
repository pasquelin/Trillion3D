//! Golden of the `ktx2` driver: the only coverage of the full path real glTF →
//! `compile()` → cache → binary sidecar for KTX 2.0 textures. The in-vitro tests
//! in `plugins/tests/ktx2/` fix what the driver yields texel by texel; this one
//! fixes the bytes an engine will actually read, once the container's three
//! paths have gone through the whole compiler.
//!
//! Three quads, three materials, three textures: an uncompressed level written
//! from the specification, a UASTC LDR payload cut from the corner of the
//! corpus, and an ETC1S payload under BasisLZ supercompression as Khronos's
//! encoder wrote it. Provenance of each is in `fixtures/ktx2/README.md`.
//!
//! Regenerating the scene and its expected, from the repository root:
//!
//! ```text
//! cargo test --release --manifest-path packages/asset-compiler-rust/Cargo.toml \
//!   -- --ignored regenerate_the_ktx2_fixture --nocapture
//! npx prettier --write packages/asset-compiler-rust/fixtures/ktx2/expected.json
//! ```
//!
//! Ignored by default: it writes into `fixtures/`. The diff it produces is
//! re-read before being committed — an expected regenerated without reading no
//! longer watches anything.
use super::apercus_golden::previews_digest;
use super::*;

/// One quad per texture, spaced on three depths so no pair is coplanar.
const QUADS: usize = 3;
const POSITION_BYTES: usize = QUADS * 4 * 12;
const TEXCOORD_BYTES: usize = QUADS * 4 * 8;
const INDEX_BYTES: usize = 24;
/// The scene's three textures, in material order: the driver's three paths.
const TEXTURES: [&str; QUADS] = ["base.ktx2", "uastc.ktx2", "basis.ktx2"];
const CASE: &str = "Three quads, three opaque materials, one KTX 2.0 texture each: an uncompressed 4 × 4 R8G8B8A8 sRGB level, a 16 × 16 UASTC LDR 4 × 4 payload, and a 256 × 256 ETC1S payload under BasisLZ supercompression.";
const RULE: &str = "Each colour texture carries the lossless tail of its mip chain, from the first level whose neither side exceeds 64 through 1×1, in RGBA8 sRGB with straight alpha. The KTX2 container adds no loss: what the driver yields is the reconstruction the codec specification defines, and nothing else.";

// Behaviour 26: the golden KTX 2.0 texture fixture goes through the compiler and
// every byte of its previews is compared to expected.json — provenance, level
// geometry, pixels and coverage.
#[test]
fn ktx2_texture_previews_match_their_golden_expected_json() {
    let dir = golden_dir("ktx2");
    let run = compile_golden(&dir, "scene");
    assert_eq!(
        previews_digest(&run),
        golden_expected(&dir),
        "fixture ktx2: texture previews diverge from expected.json"
    );
}

#[test]
#[ignore = "writes into fixtures/; rerun by hand, and its diff is re-read"]
fn regenerate_the_ktx2_fixture() {
    let dir = golden_dir("ktx2");
    let bin = scene_bytes();
    fs::write(dir.join("scene.bin"), &bin).expect("binary");
    let gltf = serde_json::to_vec_pretty(&scene(bin.len())).expect("glTF");
    fs::write(dir.join("scene.gltf"), &gltf).expect("scene");
    let run = compile_golden(&dir, "scene");
    write_expected(&dir, previews_digest(&run), CASE, RULE);
}

/// Positions, texture coordinates then indices: the three binary views, in that order.
fn scene_bytes() -> Vec<u8> {
    let corners = |quad: usize| {
        let (left, depth) = (quad as f32 * 3.0, quad as f32);
        [
            [left, 0.0, depth],
            [left + 2.0, 0.0, depth],
            [left + 2.0, 2.0, depth],
            [left, 2.0, depth],
        ]
    };
    let positions = (0..QUADS).flat_map(corners).flatten();
    let texcoords = (0..QUADS)
        .flat_map(|_| [[0f32, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]])
        .flatten();
    let floats = positions.chain(texcoords).flat_map(f32::to_le_bytes);
    let indices = (0..QUADS as u32)
        .flat_map(|quad| {
            let first = quad * 4;
            [first, first + 1, first + 2, first, first + 2, first + 3]
        })
        .flat_map(u32::to_le_bytes);
    floats.chain(indices).collect()
}

/// The scene: one view per attribute, one index accessor per quad at its offset
/// in the shared view, and one opaque material per texture.
fn scene(buffer_bytes: usize) -> Value {
    let vertices = QUADS * 4;
    let indices_at = POSITION_BYTES + TEXCOORD_BYTES;
    let far = (QUADS - 1) as f32;
    let mut accessors = vec![
        json!({"bufferView":0,"componentType":5126,"type":"VEC3","count":vertices,
            "min":[0.0,0.0,0.0],"max":[far * 3.0 + 2.0, 2.0, far]}),
        json!({"bufferView":1,"componentType":5126,"type":"VEC2","count":vertices,
            "min":[0.0,0.0],"max":[1.0,1.0]}),
    ];
    let mut primitives = Vec::new();
    for quad in 0..QUADS {
        accessors.push(json!({"bufferView":2,"byteOffset":quad * INDEX_BYTES,
            "componentType":5125,"type":"SCALAR","count":6}));
        primitives.push(
            json!({"attributes":{"POSITION":0,"TEXCOORD_0":1},"indices":2 + quad,"material":quad}),
        );
    }
    let images: Vec<Value> = TEXTURES.iter().map(|uri| json!({"uri": uri})).collect();
    let textures: Vec<Value> = (0..QUADS).map(|index| json!({"source": index})).collect();
    let materials: Vec<Value> = TEXTURES
        .iter()
        .enumerate()
        .map(|(index, name)| {
            json!({"name": name, "pbrMetallicRoughness":{"baseColorTexture":{"index": index}}})
        })
        .collect();
    json!({"asset":{"version":"2.0"},
      "buffers":[{"uri":"scene.bin","byteLength":buffer_bytes}],
      "bufferViews":[
        {"buffer":0,"byteOffset":0,"byteLength":POSITION_BYTES},
        {"buffer":0,"byteOffset":POSITION_BYTES,"byteLength":TEXCOORD_BYTES},
        {"buffer":0,"byteOffset":indices_at,"byteLength":QUADS * INDEX_BYTES}],
      "accessors":accessors,
      "images":images,"textures":textures,"materials":materials,
      "meshes":[{"primitives":primitives}],"nodes":[{"mesh":0}],"scenes":[{"nodes":[0]}],"scene":0})
}
