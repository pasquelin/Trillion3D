use super::*;
use crate::texture_preview::collect::{atlas_textures, AtlasTexture};

fn meshes_using(materials: &[i64]) -> Value {
    let primitives: Vec<Value> = materials
        .iter()
        .map(|m| json!({"attributes":{},"material":m}))
        .collect();
    json!([{"primitives": primitives}])
}

// Behavior 5 (a): each binding goes to its atlas, as `collectWebgpuMaterialTextures` —
// base color and emissive to color atlas; metallic-roughness, normal, occlusion to
// data atlas. Sorted by texture then atlas.
#[test]
fn every_binding_goes_to_its_atlas() {
    let g = json!({
        "materials": [{
            "pbrMetallicRoughness": {"baseColorTexture": {"index": 2}, "metallicRoughnessTexture": {"index": 7}},
            "emissiveTexture": {"index": 5},
            "normalTexture": {"index": 9},
            "occlusionTexture": {"index": 1},
        }],
        "meshes": meshes_using(&[0]),
    });
    let found = atlas_textures(&g, &BTreeSet::from([0])).expect("collect");
    let expected = [
        (1, AtlasKind::Data),
        (2, AtlasKind::Color),
        (5, AtlasKind::Color),
        (7, AtlasKind::Data),
        (9, AtlasKind::Data),
    ];
    let keys: Vec<_> = found.iter().map(|t| (t.texture, t.kind)).collect();
    assert_eq!(keys, expected);
}

// Behaviour: what the gate measures of an entry follows the roles that read it —
// an opaque base colour's alpha is not read, a normal map alone is two channels,
// a texture a normal map and an occlusion share reads every channel of both —
// and a masked material hands its cutoff to the base colour it reads, once.
#[test]
fn an_entry_reads_the_channels_and_cutoffs_of_its_roles() {
    let g = json!({
        "materials": [
            {"pbrMetallicRoughness": {"baseColorTexture": {"index": 0}}, "normalTexture": {"index": 1}},
            {"pbrMetallicRoughness": {"baseColorTexture": {"index": 0}}, "alphaMode": "MASK", "alphaCutoff": 0.3,
             "normalTexture": {"index": 2}, "occlusionTexture": {"index": 2}},
            {"pbrMetallicRoughness": {"baseColorTexture": {"index": 0}}, "alphaMode": "MASK"},
            {"pbrMetallicRoughness": {"baseColorTexture": {"index": 0}}, "alphaMode": "MASK"},
        ],
        "meshes": meshes_using(&[0, 1, 2, 3]),
    });
    let found = atlas_textures(&g, &BTreeSet::from([0])).expect("collect");
    assert_eq!(
        found,
        vec![
            AtlasTexture {
                texture: 0,
                kind: AtlasKind::Color,
                channels: [true; 4],
                normal_only: false,
                cutoffs: vec![0.3, 0.5],
            },
            AtlasTexture {
                texture: 1,
                kind: AtlasKind::Data,
                channels: [true, true, true, false],
                normal_only: true,
                cutoffs: vec![],
            },
            AtlasTexture {
                texture: 2,
                kind: AtlasKind::Data,
                channels: [true, true, true, false],
                normal_only: false,
                cutoffs: vec![],
            },
        ]
    );
    let opaque = json!({
        "materials": [{"pbrMetallicRoughness": {"baseColorTexture": {"index": 0}}}],
        "meshes": meshes_using(&[0]),
    });
    let found = atlas_textures(&opaque, &BTreeSet::from([0])).expect("collect");
    assert_eq!(found[0].channels, [true, true, true, false]);
}

// Behavior 5 (b): texture read by both atlases — same image as base color
// here and occlusion there — has entry PER ATLAS, because each atlas reduces by
// own curve; two materials sharing binding count it once.
#[test]
fn a_texture_read_by_both_atlases_has_one_entry_per_atlas() {
    let g = json!({
        "materials": [
            {"pbrMetallicRoughness": {"baseColorTexture": {"index": 4}}},
            {"pbrMetallicRoughness": {"baseColorTexture": {"index": 4}}, "occlusionTexture": {"index": 4}},
        ],
        "meshes": meshes_using(&[0, 1]),
    });
    let found = atlas_textures(&g, &BTreeSet::from([0])).expect("collect");
    let keys: Vec<_> = found.iter().map(|t| (t.texture, t.kind)).collect();
    assert_eq!(keys, [(4, AtlasKind::Color), (4, AtlasKind::Data)]);
}

// #42: a colour texture takes the `Coverage` chain, the one weighted by alpha, only when
// every reader takes its alpha for coverage — MASK or BLEND base colours. One opaque base
// colour or one emissive among its readers and it keeps the plain chain, which that reader
// draws as before; so do a MASK cutoff of 0 and a mode glTF does not name, which the engine
// draws opaque; the data atlas never weighs.
#[test]
fn only_a_texture_every_reader_takes_for_coverage_is_weighted() {
    let base = |index: u64, mode: &str| json!({"pbrMetallicRoughness": {"baseColorTexture": {"index": index}}, "alphaMode": mode});
    let g = json!({
        "materials": [
            base(0, "MASK"), base(0, "BLEND"),
            base(1, "OPAQUE"),
            base(2, "MASK"), base(2, "OPAQUE"),
            {"pbrMetallicRoughness": {"baseColorTexture": {"index": 3}}, "alphaMode": "MASK",
             "emissiveTexture": {"index": 3}},
            {"pbrMetallicRoughness": {"baseColorTexture": {"index": 4}}, "alphaMode": "BLEND",
             "occlusionTexture": {"index": 4}},
            {"pbrMetallicRoughness": {"baseColorTexture": {"index": 5}}, "alphaMode": "MASK",
             "alphaCutoff": 0.0},
            base(6, "blend"),
        ],
        "meshes": meshes_using(&[0, 1, 2, 3, 4, 5, 6, 7, 8]),
    });
    let found = atlas_textures(&g, &BTreeSet::from([0])).expect("collect");
    let keys: Vec<_> = found.iter().map(|t| (t.texture, t.kind)).collect();
    assert_eq!(
        keys,
        [
            (0, AtlasKind::Coverage),
            (1, AtlasKind::Color),
            (2, AtlasKind::Color),
            (3, AtlasKind::Color),
            (4, AtlasKind::Coverage),
            (4, AtlasKind::Data),
            (5, AtlasKind::Color),
            (6, AtlasKind::Color),
        ]
    );
}

// Behavior 5 (c): only materials of retained meshes count.
#[test]
fn only_materials_of_selected_meshes_are_collected() {
    let g = json!({
        "materials": [
            {"pbrMetallicRoughness": {"baseColorTexture": {"index": 0}}},
            {"pbrMetallicRoughness": {"baseColorTexture": {"index": 1}}},
        ],
        "meshes": [
            {"primitives": [{"attributes": {}, "material": 0}]},
            {"primitives": [{"attributes": {}, "material": 1}]},
        ],
    });
    let found = atlas_textures(&g, &BTreeSet::from([1])).expect("collect");
    let keys: Vec<_> = found.iter().map(|t| (t.texture, t.kind)).collect();
    assert_eq!(keys, [(1, AtlasKind::Color)]);
}
