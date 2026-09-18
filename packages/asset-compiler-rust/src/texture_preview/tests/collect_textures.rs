use super::*;
use crate::texture_preview::collect::{atlas_textures, AtlasTexture};

fn meshes_using(materials: &[i64]) -> Value {
    let primitives: Vec<Value> = materials
        .iter()
        .map(|m| json!({"attributes":{},"material":m}))
        .collect();
    json!([{"primitives": primitives}])
}

// Comportement 5 (a) : chaque liaison va à son atlas, comme `collectWebgpuMaterialTextures` — la
// couleur de base et l'émissif à l'atlas couleur ; métal-rugosité, normale et occlusion à celui
// des données. Triées par texture puis par atlas.
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

// Comportement 5 (b) : une texture lue par les deux atlas — la même image comme couleur de base
// ici et comme occlusion là — a une entrée PAR ATLAS, parce que chaque atlas la réduit par sa
// propre courbe ; et deux matériaux qui partagent une liaison ne la comptent qu'une fois.
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

// Comportement 5 (c) : seuls les matériaux des maillages retenus comptent.
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
