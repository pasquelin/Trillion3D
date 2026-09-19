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
    assert_eq!(
        found,
        expected.map(|(texture, kind)| AtlasTexture { texture, kind })
    );
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
    assert_eq!(
        found,
        vec![
            AtlasTexture {
                texture: 4,
                kind: AtlasKind::Color
            },
            AtlasTexture {
                texture: 4,
                kind: AtlasKind::Data
            },
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
    assert_eq!(
        found,
        vec![AtlasTexture {
            texture: 1,
            kind: AtlasKind::Color
        }]
    );
}
