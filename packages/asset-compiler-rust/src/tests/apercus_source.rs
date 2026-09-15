//! Provenance de la fixture dorée des aperçus : le code qui a produit ses images, sa scène et son
//! `expected.json`. Rien n'y est copié d'un banc ni d'un dossier d'assets — tout se recalcule.
//!
//! Régénération, depuis la racine du dépôt :
//!
//! ```text
//! cargo test --release --manifest-path packages/asset-compiler-rust/Cargo.toml \
//!   -- --ignored regenere_la_fixture_des_apercus --nocapture
//! npx prettier --write packages/asset-compiler-rust/fixtures/apercus/atlas-couleur/expected.json
//! ```
//!
//! Ignorée par défaut : elle écrit dans `fixtures/`. Le diff qu'elle produit se relit avant d'être
//! commité — un attendu régénéré sans lecture ne surveille plus rien.
use super::apercus_golden::previews_digest;
use super::*;

/// Quatre quads côte à côte, un par matériau : de la vraie géométrie, assez petite pour tenir en
/// une page, et assez écartée pour qu'aucune paire ne soit coplanaire.
const QUADS: u32 = 4;
const CASE: &str = "Quatre quads, quatre matériaux qui se partagent trois textures couleur : un OPAQUE à baseColorTexture PNG 40×24 liée par uri, un MASK à alphaCutoff 0,25 sur un PNG 24×16 à alpha binaire embarqué en bufferView, et un BLEND dont la baseColorTexture JPEG 80×48 sert aussi d'emissiveTexture à un quatrième matériau.";
const RULE: &str = "Chaque texture couleur porte la queue sans perte de sa chaîne de mips, du premier niveau dont aucun côté ne dépasse 64 jusqu'au 1×1, en RGBA8 sRGB à alpha droit. Seule la texture dont toutes les liaisons sont des couleurs de base MASK voit son alpha remis à l'échelle pour préserver la couverture de la source au seuil du matériau ; les deux autres gardent leur alpha intact.";

#[test]
#[ignore = "écrit dans fixtures/ ; se relance à la main, et son diff se relit"]
fn regenere_la_fixture_des_apercus() {
    let dir = golden_dir("apercus/atlas-couleur");
    fs::create_dir_all(&dir).expect("dossier de fixture");
    let mask = encode_mask();
    let bin = scene_bytes(&mask);
    fs::write(dir.join("base-degrade.png"), encode_gradient()).expect("png de base");
    fs::write(dir.join("lueur.jpg"), encode_glow()).expect("jpeg partagé");
    fs::write(dir.join("atlas-couleur.bin"), &bin).expect("binaire");
    let gltf = serde_json::to_vec_pretty(&scene(bin.len(), mask.len())).expect("glTF");
    fs::write(dir.join("atlas-couleur.gltf"), &gltf).expect("scène");
    let previous: Option<Value> = fs::read(dir.join("expected.json"))
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok());
    let run = compile_golden(&dir, "atlas-couleur");
    let mut expected = previews_digest(&run);
    let object = expected.as_object_mut().expect("attendu");
    for (field, fallback) in [("case", CASE), ("rule", RULE)] {
        let kept = previous
            .as_ref()
            .and_then(|value| value.get(field))
            .cloned()
            .unwrap_or_else(|| json!(fallback));
        object.insert(field.into(), kept);
    }
    let text = serde_json::to_vec_pretty(&expected).expect("attendu");
    fs::write(dir.join("expected.json"), &text).expect("expected.json");
    println!("fixture écrite dans {}", dir.display());
}

/// Dégradé opaque 40×24 : ni carré, ni multiple de seize, pour que la boîte de réduction tombe sur
/// des cases de tailles inégales et que le dernier niveau soit atteint par troncature.
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

/// Masque 24×16 à alpha strictement binaire : une ellipse centrée de demi-axes 0,8 en coordonnées
/// normalisées, dont la couverture de la source est ce que les niveaux réduits doivent retrouver.
fn encode_mask() -> Vec<u8> {
    encode(image::RgbaImage::from_fn(24, 16, |x, y| {
        let dx = (2 * x as i32 + 1 - 24) as f32 / 24.0;
        let dy = (2 * y as i32 + 1 - 16) as f32 / 16.0;
        let inside = dx * dx + dy * dy <= 0.64;
        image::Rgba([200, 160, 120, if inside { 255 } else { 0 }])
    }))
}

/// Dégradé lisse 80×48 en JPEG : le second décodeur, et le seul côté qui dépasse 64 — son premier
/// niveau porté est donc le mip 1, pas le mip 0.
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

/// Positions, coordonnées de texture, indices des quatre quads, puis les octets du PNG embarqué.
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

/// Les quatre octets d'un sommet fois trois composantes : la scène en dépend pour ses vues.
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
