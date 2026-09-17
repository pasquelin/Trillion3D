use super::*;

fn meshes_using(materials: &[i64]) -> Value {
    let primitives: Vec<Value> = materials
        .iter()
        .map(|m| json!({"attributes":{},"material":m}))
        .collect();
    json!([{"primitives": primitives}])
}

// Comportement 5 (a) : seules la couleur de base et l'émissif d'un matériau alimentent l'atlas —
// les deux textures d'un même matériau OPAQUE ressortent, sans seuil de découpe.
#[test]
fn base_color_and_emissive_are_the_only_textures_collected() {
    let g = json!({
        "materials": [{
            "pbrMetallicRoughness": {"baseColorTexture": {"index": 2}},
            "emissiveTexture": {"index": 5},
            "normalTexture": {"index": 9},
        }],
        "meshes": meshes_using(&[0]),
    });
    let found =
        crate::texture_preview::collect::color_textures(&g, &BTreeSet::from([0]), &BTreeSet::new())
            .expect("collect");
    let mut textures: Vec<usize> = found.iter().map(|c| c.texture).collect();
    textures.sort();
    assert_eq!(textures, vec![2, 5]);
    assert!(found.iter().all(|c| c.cutoff.is_none()));
}

// Comportement 5 (b) : quand plusieurs matériaux MASK partagent la même texture de couleur de
// base, c'est le plus petit de leurs seuils qui doit être préservé.
#[test]
fn a_shared_base_texture_keeps_the_smallest_mask_cutoff() {
    let g = json!({
        "materials": [
            {"alphaMode":"MASK","alphaCutoff":0.7,"pbrMetallicRoughness":{"baseColorTexture":{"index":1}}},
            {"alphaMode":"MASK","alphaCutoff":0.3,"pbrMetallicRoughness":{"baseColorTexture":{"index":1}}},
        ],
        "meshes": meshes_using(&[0, 1]),
    });
    let found =
        crate::texture_preview::collect::color_textures(&g, &BTreeSet::from([0]), &BTreeSet::new())
            .expect("collect");
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].texture, 1);
    assert_eq!(found[0].cutoff, Some(0.3));
}

// Comportement 5 (c) : la moindre liaison qui n'est pas la couleur de base d'un matériau MASK —
// ici un second matériau OPAQUE partageant la même texture — laisse l'alpha intact (`plain`).
#[test]
fn a_plain_binding_wins_over_a_mask_binding_on_a_shared_texture() {
    let g = json!({
        "materials": [
            {"alphaMode":"MASK","alphaCutoff":0.5,"pbrMetallicRoughness":{"baseColorTexture":{"index":4}}},
            {"pbrMetallicRoughness":{"baseColorTexture":{"index":4}}},
        ],
        "meshes": meshes_using(&[0, 1]),
    });
    let found =
        crate::texture_preview::collect::color_textures(&g, &BTreeSet::from([0]), &BTreeSet::new())
            .expect("collect");
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].texture, 4);
    assert_eq!(found[0].cutoff, None);
}
