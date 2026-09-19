//! Provenance of the preview golden fixture: the code that produced its images,
//! its scene and its `expected.json`. Nothing is copied from a bench or an assets
//! folder — everything is recomputed.
//!
//! Regeneration, from the repository root:
//!
//! ```text
//! cargo test --release --manifest-path packages/asset-compiler-rust/Cargo.toml \
//!   -- --ignored regenere_la_fixture_des_apercus --nocapture
//! npx prettier --write packages/asset-compiler-rust/fixtures/apercus/atlas-couleur/expected.json
//! ```
//!
//! Ignored by default: it writes into `fixtures/`. The diff it produces is
//! re-read before being committed — an expected regenerated without reading no
//! longer watches anything.
use super::apercus_golden::previews_digest;
use super::*;

/// Four quads side by side, one per material: real geometry, small enough to fit
/// in one page, and far enough apart that no pair is coplanar.
const QUADS: u32 = 4;
const CASE: &str = "Four quads, four materials that share three colour textures: an OPAQUE with a 40×24 PNG baseColorTexture linked by uri, a MASK at alphaCutoff 0.25 on a 24×16 PNG with binary alpha embedded in a bufferView, and a BLEND whose 80×48 JPEG baseColorTexture also serves as emissiveTexture to a fourth material.";
const RULE: &str = "Each colour texture carries the lossless tail of its mip chain, from the first level whose neither side exceeds 64 through 1×1, in RGBA8 sRGB with straight alpha. Only the texture whose every binding is a MASK base colour has its alpha rescaled to preserve source coverage at the material threshold; the other two keep their alpha intact.";

#[test]
#[ignore = "writes into fixtures/; rerun by hand, and its diff is re-read"]
fn regenere_la_fixture_des_apercus() {
    let dir = golden_dir("apercus/atlas-couleur");
    fs::create_dir_all(&dir).expect("dossier de fixture");
    let mask = encode_mask();
    let bin = scene_bytes(&mask);
    fs::write(dir.join("base-degrade.png"), encode_gradient()).expect("png de base");
    fs::write(dir.join("lueur.jpg"), encode_glow()).expect("shared jpeg");
    fs::write(dir.join("atlas-couleur.bin"), &bin).expect("binaire");
    let gltf = serde_json::to_vec_pretty(&scene(bin.len(), mask.len())).expect("glTF");
    fs::write(dir.join("atlas-couleur.gltf"), &gltf).expect("scene");
    let run = compile_golden(&dir, "atlas-couleur");
    write_expected(&dir, previews_digest(&run), CASE, RULE);
}

/// Opaque 40×24 gradient: neither square nor a multiple of sixteen, so the
/// reduction box lands on unequal cells and the last level is reached by truncation.
fn encode_gradient() -> Vec<u8> {
    encode(image::RgbaImage::from_fn(40, 24, |x, y| {
        image::Rgba([
            (x * 255 / 39) as u8,
            (y * 255 / 23) as u8,
            ((x + y) * 255 / 62) as u8,
            255,
        ])
    }))
}

/// 24×16 mask with strictly binary alpha: a centred ellipse of half-axes 0.8 in
/// normalised coordinates, whose source coverage is what the reduced levels must find again.
fn encode_mask() -> Vec<u8> {
    encode(image::RgbaImage::from_fn(24, 16, |x, y| {
        let dx = (2 * x as i32 + 1 - 24) as f32 / 24.0;
        let dy = (2 * y as i32 + 1 - 16) as f32 / 16.0;
        let inside = dx * dx + dy * dy <= 0.64;
        image::Rgba([200, 160, 120, if inside { 255 } else { 0 }])
    }))
}

/// Smooth 80×48 JPEG gradient: the second decoder, and the only side that exceeds
/// 64 — its first carried level is therefore mip 1, not mip 0.
fn encode_glow() -> Vec<u8> {
    let image = image::RgbImage::from_fn(80, 48, |x, y| {
        image::Rgb([(x * 255 / 79) as u8, (y * 255 / 47) as u8, 128])
    });
    let mut out = Vec::new();
    image
        .write_to(
            &mut std::io::Cursor::new(&mut out),
            image::ImageFormat::Jpeg,
        )
        .expect("jpeg");
    out
}

fn encode(image: image::RgbaImage) -> Vec<u8> {
    let mut out = Vec::new();
    image
        .write_to(&mut std::io::Cursor::new(&mut out), image::ImageFormat::Png)
        .expect("png");
    out
}

/// Positions, texture coordinates, indices of the four quads, then the embedded PNG bytes.
fn scene_bytes(mask: &[u8]) -> Vec<u8> {
    let mut bin = Vec::new();
    for quad in 0..QUADS {
        let left = quad as f32 * 3.0;
        for (x, y) in [
            (left, 0.0),
            (left + 2.0, 0.0),
            (left + 2.0, 2.0),
            (left, 2.0),
        ] {
            for value in [x, y, 0.0] {
                bin.extend_from_slice(&value.to_le_bytes());
            }
        }
    }
    for _ in 0..QUADS {
        for value in [0f32, 0., 1., 0., 1., 1., 0., 1.] {
            bin.extend_from_slice(&value.to_le_bytes());
        }
    }
    for quad in 0..QUADS {
        let first = quad * 4;
        for index in [first, first + 1, first + 2, first, first + 2, first + 3] {
            bin.extend_from_slice(&index.to_le_bytes());
        }
    }
    bin.extend_from_slice(mask);
    bin
}

/// Four bytes of a vertex times three components: the scene depends on them for its views.
const POSITION_BYTES: usize = 192;
const TEXCOORD_BYTES: usize = 128;
const INDEX_BYTES: usize = 24;

fn scene(buffer_bytes: usize, mask_bytes: usize) -> Value {
    let vertices = (QUADS * 4) as usize;
    let indices_at = POSITION_BYTES + TEXCOORD_BYTES;
    let mut views = vec![
        json!({"buffer":0,"byteOffset":0,"byteLength":POSITION_BYTES}),
        json!({"buffer":0,"byteOffset":POSITION_BYTES,"byteLength":TEXCOORD_BYTES}),
    ];
    let mut accessors = vec![
        json!({"bufferView":0,"componentType":5126,"type":"VEC3","count":vertices,
            "min":[0.0,0.0,0.0],"max":[(QUADS - 1) as f32 * 3.0 + 2.0, 2.0, 0.0]}),
        json!({"bufferView":1,"componentType":5126,"type":"VEC2","count":vertices,
            "min":[0.0,0.0],"max":[1.0,1.0]}),
    ];
    let mut primitives = Vec::new();
    for quad in 0..QUADS as usize {
        views.push(
            json!({"buffer":0,"byteOffset":indices_at + quad * INDEX_BYTES,"byteLength":INDEX_BYTES}),
        );
        accessors
            .push(json!({"bufferView":2 + quad,"componentType":5125,"type":"SCALAR","count":6}));
        primitives.push(
            json!({"attributes":{"POSITION":0,"TEXCOORD_0":1},"indices":2 + quad,"material":quad}),
        );
    }
    views.push(
        json!({"buffer":0,"byteOffset":indices_at + QUADS as usize * INDEX_BYTES,
        "byteLength":mask_bytes}),
    );
    json!({"asset":{"version":"2.0"},
      "buffers":[{"uri":"atlas-couleur.bin","byteLength":buffer_bytes}],
      "bufferViews":views,"accessors":accessors,
      "images":[{"uri":"base-degrade.png"},
        {"bufferView":2 + QUADS as usize,"mimeType":"image/png"},{"uri":"lueur.jpg"}],
      "textures":[{"source":0},{"source":1},{"source":2}],
      "materials":[
        {"name":"beton","pbrMetallicRoughness":{"baseColorTexture":{"index":0}}},
        {"name":"grille","alphaMode":"MASK","alphaCutoff":0.25,
          "pbrMetallicRoughness":{"baseColorTexture":{"index":1}}},
        {"name":"vitre","alphaMode":"BLEND",
          "pbrMetallicRoughness":{"baseColorTexture":{"index":2}}},
        {"name":"lampe","emissiveTexture":{"index":2},"emissiveFactor":[1.0,0.9,0.6]}],
      "meshes":[{"primitives":primitives}],"nodes":[{"mesh":0}],"scenes":[{"nodes":[0]}],"scene":0})
}
