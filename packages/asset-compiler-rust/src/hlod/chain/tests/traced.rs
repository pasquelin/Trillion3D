//! What the ray tracer reads of the world DAG (`../traced.rs`): the flags of the material an actor
//! wears, and the world's tree every world with an actor holds.
use super::{cooked, covers, world};
use crate::hlod::chain::builds::Wears;
use crate::hlod::chain::traced::flags_of;
use crate::hlod::flatten::bake::publish::{coverage_of, Image, Role};
use crate::hlod::flatten::bake::Coverage;
use crate::ray_tracing::abi::{
    RAY_TRACING_FLAG_MASKED, RAY_TRACING_FLAG_SKY, RAY_TRACING_FLAG_TRANSLUCENT,
    RAY_TRACING_FLAG_TWO_SIDED,
};
use serde_json::json;

#[test]
fn an_actor_wears_the_flags_of_its_material() {
    let image = |role, coverage| Image {
        role,
        png: None,
        previews: Vec::new(),
        strength: None,
        coverage,
    };
    let flattened = |coverage, double_sided| Wears::Flattened {
        images: vec![
            image(Role::Base, coverage),
            image(Role::Normal, Coverage::Opaque),
        ],
        double_sided,
        sky: false,
    };
    // A flattened material wears the alpha its base image carries and draws the faces its atlas
    // says, as it is published (`publish::flattened_material`).
    assert_eq!(flags_of(&flattened(Coverage::Opaque, false), &[], &[]), 0);
    assert_eq!(
        flags_of(&flattened(Coverage::Opaque, true), &[], &[]),
        RAY_TRACING_FLAG_TWO_SIDED
    );
    assert_eq!(
        flags_of(&flattened(Coverage::Blend, false), &[], &[]),
        RAY_TRACING_FLAG_TRANSLUCENT
    );
    assert_eq!(
        flags_of(&flattened(Coverage::Mask, true), &[], &[]),
        RAY_TRACING_FLAG_MASKED | RAY_TRACING_FLAG_TWO_SIDED
    );
    // A material of the scene is a primitive's: blended is translucent, a double-sided one two-sided,
    // glTF's default (none, or a rank past the list) neither.
    let materials = [json!({"alphaMode": "BLEND"}), json!({"doubleSided": true})];
    let merged = |rank| flags_of(&Wears::Merged(rank), &materials, &[]);
    assert_eq!(merged(Some(0)), RAY_TRACING_FLAG_TRANSLUCENT);
    assert_eq!(merged(Some(1)), RAY_TRACING_FLAG_TWO_SIDED);
    assert_eq!(merged(None), 0);
    assert_eq!(merged(Some(7)), 0);
}

#[test]
fn an_actor_of_a_sky_material_wears_the_sky_flag_and_equivalent_materials_keep_the_property() {
    let sky = |sky| Wears::Flattened {
        images: Vec::new(),
        double_sided: false,
        sky,
    };
    assert_eq!(flags_of(&sky(true), &[], &[]), RAY_TRACING_FLAG_SKY);
    assert_eq!(flags_of(&sky(false), &[], &[]), 0);
    let materials = [json!({}), json!({})];
    assert_eq!(
        flags_of(&Wears::Merged(Some(1)), &materials, &[false, true]),
        RAY_TRACING_FLAG_SKY
    );
    assert_eq!(
        flags_of(&Wears::Merged(Some(0)), &materials, &[false, true]),
        0
    );
    // Two materials of one definition share a class unless one is a sky material.
    let scene = json!({"materials": [{"name": "a"}, {"name": "b"}]});
    let both = [Some(0), Some(1)].into_iter().collect();
    let same = crate::hlod::flatten::merge::classes(&scene, &both, &[false, false]);
    assert_eq!(same[&Some(1)], Some(0));
    let split = crate::hlod::flatten::merge::classes(&scene, &both, &[false, true]);
    assert_eq!(split[&Some(1)], Some(1));
}

#[test]
fn the_coverage_of_a_material_is_its_first_image_that_reads_alpha() {
    let image = |coverage| Image {
        role: Role::Base,
        png: None,
        previews: Vec::new(),
        strength: None,
        coverage,
    };
    assert_eq!(coverage_of(&[]), Coverage::Opaque);
    assert_eq!(
        coverage_of(&[image(Coverage::Opaque), image(Coverage::Opaque)]),
        Coverage::Opaque
    );
    assert_eq!(
        coverage_of(&[
            image(Coverage::Opaque),
            image(Coverage::Mask),
            image(Coverage::Blend)
        ]),
        Coverage::Mask
    );
}

#[test]
fn a_world_with_actors_holds_a_tree_for_ray_tracing() {
    let covers = covers();
    let instances = world(&covers, 2);
    let cooked = cooked(&instances, 4).expect("cooked");
    assert!(cooked.ray_tracing.is_some(), "the actors' triangles");
}
