use super::super::mesh_source::test_support::{attribute, read as decode};
use super::*;
const FIXTURE: &str = include_str!("../../../../../../tests/fixtures/formats/ifc/scene.ifc");
#[test]
fn ifc4_keeps_tessellated_order_extrusions_styles_instances_units_and_product_ids() {
    let scene = decode(&IFC, FIXTURE.as_bytes(), 1 << 20).unwrap();
    assert_eq!(scene.mesh_triangles, [4, 12]);
    assert_eq!(scene.materials.len(), 2);
    assert_eq!(scene.meshes[0]["primitives"][0]["material"], 0);
    assert_eq!(scene.meshes[1]["primitives"][0]["material"], 1);
    assert_eq!(
        &attribute(&scene, &scene.meshes[0]["primitives"][0], "POSITION")[..9],
        &[0., 0., 0., 0., 1000., 0., 1000., 0., 0.]
    );
    let items: Vec<_> = scene
        .nodes
        .iter()
        .filter_map(|n| n["mesh"].as_u64())
        .collect();
    assert_eq!(items, [0, 0, 1]);
    let products: Vec<_> = scene
        .nodes
        .iter()
        .filter_map(|n| n["extras"]["ifcExpressId"].as_u64())
        .collect();
    assert_eq!(products, [24, 25, 35]);
    let positions: Vec<_> = scene
        .nodes
        .iter()
        .filter_map(|n| n["matrix"][12].as_f64())
        .collect();
    assert!(positions.contains(&2000.));
    assert_eq!(scene.nodes.last().unwrap()["matrix"][0], 0.001);
    let positions = attribute(&scene, &scene.meshes[1]["primitives"][0], "POSITION");
    let min = positions
        .as_chunks::<3>()
        .0
        .iter()
        .map(|v| v[2])
        .fold(f32::INFINITY, f32::min);
    let max = positions
        .as_chunks::<3>()
        .0
        .iter()
        .map(|v| v[2])
        .fold(f32::NEG_INFINITY, f32::max);
    assert_eq!((min, max), (0., 3000.));
}
#[test]
fn ifc_invalid_refs_indices_cycles_counts_and_unsupported_solids_are_named_refusals() {
    for text in [
        FIXTURE.replace("(1,3,2)", "(1,9,2)"),
        FIXTURE.replace(
            "#21=IFCTRIANGULATEDFACESET(#20",
            "#21=IFCTRIANGULATEDFACESET(#999",
        ),
        FIXTURE.replace("#7=IFCLOCALPLACEMENT($", "#7=IFCLOCALPLACEMENT(#10"),
        FIXTURE.replace("1000.,2000.", "-1000.,2000."),
        FIXTURE.replace("IFCEXTRUDEDAREASOLID", "IFCREVOLVEDAREASOLID"),
        FIXTURE.replace("END-ISO-10303-21;", ""),
    ] {
        assert!(decode(&IFC, text.as_bytes(), 1 << 20).is_err());
    }
    assert!(decode(&IFC, FIXTURE.as_bytes(), 4096).is_err());
}
