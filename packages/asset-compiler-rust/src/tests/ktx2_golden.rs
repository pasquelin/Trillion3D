//! Doré du pilote `ktx2` : la seule couverture du chemin complet glTF réel → `compile()` → cache →
//! sidecar binaire pour des textures KTX 2.0. Les tests en éprouvette de `plugins/tests/ktx2/`
//! fixent ce que le pilote rend texel par texel ; celui-ci fixe les octets qu'un moteur lira
//! vraiment, une fois les trois chemins du conteneur passés par le compilateur entier.
//!
//! Trois quads, trois matériaux, trois textures : un niveau non compressé écrit depuis la
//! spécification, une charge UASTC LDR découpée au coin du corpus, et une charge ETC1S sous
//! supercompression BasisLZ telle que l'encodeur de Khronos l'a écrite. La provenance de chacune est
//! dans `fixtures/ktx2/README.md`.
//!
//! Régénération de la scène et de son attendu, depuis la racine du dépôt :
//!
//! ```text
//! cargo test --release --manifest-path packages/asset-compiler-rust/Cargo.toml \
//!   -- --ignored regenere_la_fixture_ktx2 --nocapture
//! npx prettier --write packages/asset-compiler-rust/fixtures/ktx2/expected.json
//! ```
//!
//! Ignorée par défaut : elle écrit dans `fixtures/`. Le diff qu'elle produit se relit avant d'être
//! commité — un attendu régénéré sans lecture ne surveille plus rien.
use super::apercus_golden::previews_digest;
use super::*;

/// Un quad par texture, écartés sur trois profondeurs pour qu'aucune paire ne soit coplanaire.
const QUADS: usize = 3;
const POSITION_BYTES: usize = QUADS * 4 * 12;
const TEXCOORD_BYTES: usize = QUADS * 4 * 8;
const INDEX_BYTES: usize = 24;
/// Les trois textures de la scène, dans l'ordre des matériaux : les trois chemins du pilote.
const TEXTURES: [&str; QUADS] = ["base.ktx2", "uastc.ktx2", "basis.ktx2"];
const CASE: &str = "Trois quads, trois matériaux opaques, une texture KTX 2.0 chacun : un niveau R8G8B8A8 sRGB non compressé de 4 × 4, une charge UASTC LDR 4 × 4 de 16 × 16, et une charge ETC1S de 256 × 256 sous supercompression BasisLZ.";
const RULE: &str = "Chaque texture couleur porte la queue sans perte de sa chaîne de mips, du premier niveau dont aucun côté ne dépasse 64 jusqu'au 1×1, en RGBA8 sRGB à alpha droit. Le conteneur KTX2 n'ajoute aucune perte : ce que le pilote rend est la reconstruction que la spécification du codec définit, et rien d'autre.";

// Comportement 26 : la fixture dorée à textures KTX 2.0 passe par le compilateur et chaque octet de
// ses aperçus est comparé à expected.json — provenance, géométrie des niveaux, pixels et couverture.
#[test]
fn ktx2_texture_previews_match_their_golden_expected_json() {
    let dir = golden_dir("ktx2");
    let run = compile_golden(&dir, "scene");
    assert_eq!(
        previews_digest(&run),
        golden_expected(&dir),
        "fixture ktx2 : les aperçus de texture divergent de expected.json"
    );
}

#[test]
#[ignore = "écrit dans fixtures/ ; se relance à la main, et son diff se relit"]
fn regenere_la_fixture_ktx2() {
    let dir = golden_dir("ktx2");
    let bin = scene_bytes();
    fs::write(dir.join("scene.bin"), &bin).expect("binaire");
    let gltf = serde_json::to_vec_pretty(&scene(bin.len())).expect("glTF");
    fs::write(dir.join("scene.gltf"), &gltf).expect("scène");
    let run = compile_golden(&dir, "scene");
    write_expected(&dir, previews_digest(&run), CASE, RULE);
}

/// Positions, coordonnées de texture puis indices : les trois vues du binaire, dans cet ordre.
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

/// La scène : une seule vue par attribut, un accesseur d'indices par quad à son décalage dans la
/// vue commune, et un matériau opaque par texture.
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
