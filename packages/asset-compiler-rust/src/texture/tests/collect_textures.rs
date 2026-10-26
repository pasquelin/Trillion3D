use super::*;
use crate::texture::collect::{atlas_textures, AtlasTexture};

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
    let found = atlas_textures(&g, &used(&g, 0));
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
    let found = atlas_textures(&g, &used(&g, 0));
    assert_eq!(
        found,
        vec![
            AtlasTexture {
                texture: 0,
                kind: AtlasKind::Color,
                channels: [true; 4],
                normal_only: false,
                cutoffs: vec![(0.3, 1.0), (0.5, 1.0)],
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
    let found = atlas_textures(&opaque, &used(&opaque, 0));
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
    let found = atlas_textures(&g, &used(&g, 0));
    let keys: Vec<_> = found.iter().map(|t| (t.texture, t.kind)).collect();
    assert_eq!(keys, [(4, AtlasKind::Color), (4, AtlasKind::Data)]);
}

// The base colour of a masked or blended material, an opaque one and an emissive read the same
// colour chain: no reader takes a chain of its own for its alpha.
#[test]
fn a_masked_or_blended_base_colour_takes_the_colour_chain() {
    let base = |index: u64, mode: &str| json!({"pbrMetallicRoughness": {"baseColorTexture": {"index": index}}, "alphaMode": mode});
    let g = json!({
        "materials": [base(0, "MASK"), base(1, "BLEND"), base(1, "OPAQUE")],
        "meshes": meshes_using(&[0, 1, 2]),
    });
    let found = atlas_textures(&g, &used(&g, 0));
    let keys: Vec<_> = found.iter().map(|t| (t.texture, t.kind)).collect();
    assert_eq!(keys, [(0, AtlasKind::Color), (1, AtlasKind::Color)]);
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
    let found = atlas_textures(&g, &used(&g, 1));
    let keys: Vec<_> = found.iter().map(|t| (t.texture, t.kind)).collect();
    assert_eq!(keys, [(1, AtlasKind::Color)]);
}

// A texture's compression setting is its glTF `extras.compression`: absent is the default, a name of
// the list is that setting, any other is refused by name and cooked as the default.
#[test]
fn a_texture_names_its_compression_setting_in_its_extras() {
    use crate::texture::blocks::Layout;
    use crate::texture::setting::{Compression, Route, UNKNOWN};
    let g = json!({"textures": [
        {"source": 0},
        {"source": 0, "extras": {"compression": "alpha"}},
        {"source": 0, "extras": {"compression": "hdrCompressed"}},
        {"source": 0, "extras": {"compression": "normalmap"}},
        {"source": 0, "extras": {"compression": "sparkles"}},
        {"source": 0, "extras": {"compression": 3}},
    ]});
    let of = |texture| Compression::of(&g, texture);
    assert_eq!(of(0), Ok(Compression::Default));
    assert_eq!(of(1).map(Compression::route), Ok(Route::OneChannel));
    assert_eq!(of(2).map(Compression::route), Ok(Route::FloatBlocks));
    assert_eq!(
        of(3).map(Compression::route),
        Ok(Route::Gated(Some(Layout::TwoChannel)))
    );
    assert_eq!(of(4), Err(UNKNOWN));
    assert_eq!(of(5), Err(UNKNOWN));
    assert_eq!(of(9), Ok(Compression::Default));
}
