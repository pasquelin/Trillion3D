use super::super::mesh_source::test_support::{attribute, read as decode};
use super::*;
const FIXTURE: &[u8] = include_bytes!("../../../../../../tests/fixtures/formats/collada/scene.dae");
#[test]
fn units_hierarchy_matrices_instances_and_equal_material_identities_survive() {
    let scene = decode(&COLLADA, FIXTURE, 1 << 20).unwrap();
    assert_eq!(scene.mesh_triangles, [1, 1]);
    assert_eq!(scene.materials.len(), 2);
    let instances: Vec<_> = scene
        .nodes
        .iter()
        .filter_map(|n| n["mesh"].as_u64())
        .collect();
    assert_eq!(instances, [0, 0, 1]);
    assert_eq!(scene.meshes[0]["primitives"][0]["material"], 0);
    assert_eq!(scene.meshes[1]["primitives"][0]["material"], 1);
    let node = |name| scene.nodes.iter().find(|n| n["name"] == name).unwrap();
    let first = &node("first")["matrix"];
    assert_eq!(first[0], 2.);
    assert_eq!(first[5], 3.);
    assert_eq!(first[10], 4.);
    assert_eq!(first[12], 10.);
    assert_eq!(first[13], 20.);
    assert_eq!(first[14], 30.);
    let second = &node("second")["matrix"];
    assert_eq!(second[12], 5.);
    assert_eq!(second[13], 6.);
    assert_eq!(second[14], 7.);
    let root = &node("COLLADA coordinate system")["matrix"];
    assert!((root[9].as_f64().unwrap() - 0.01).abs() < 1e-10);
    assert!((root[6].as_f64().unwrap() + 0.01).abs() < 1e-10);
    assert_eq!(
        attribute(&scene, &scene.meshes[0]["primitives"][0], "POSITION"),
        [0., 0., 0., 100., 0., 0., 0., 100., 0.]
    );
}
#[test]
fn bad_accessors_missing_bindings_and_unsupported_semantics_are_refused() {
    let text = std::str::from_utf8(FIXTURE).unwrap();
    for changed in [
        text.replace("<p>0 1 2</p>", "<p>0 1 9</p>"),
        text.replace("target=\"#b\"", "target=\"#missing\""),
        text.replace("count=\"9\"", "count=\"999999999\""),
        text.replace("semantic=\"POSITION\"", "semantic=\"TANGENT\""),
        text.replace("100 0 0", "NaN 0 0"),
    ] {
        assert!(decode(&COLLADA, changed.as_bytes(), 1 << 20).is_err());
    }
}
#[test]
fn dtds_and_node_cycles_are_rejected() {
    let text = std::str::from_utf8(FIXTURE).unwrap();
    let dtd = text.replace(
        "<COLLADA xmlns",
        "<!DOCTYPE COLLADA [<!ENTITY x SYSTEM 'file:///etc/passwd'>]><COLLADA xmlns",
    );
    assert!(decode(&COLLADA, dtd.as_bytes(), 1 << 20).is_err());
    let cyclic = text.replace(
        "<node id=\"first\">",
        "<node id=\"first\"><instance_node url=\"#first\"/>",
    );
    assert!(decode(&COLLADA, cyclic.as_bytes(), 1 << 20).is_err());
}
#[test]
fn vertex_alpha_derives_traceable_materials_and_negative_scale_is_retained() {
    let text = std::str::from_utf8(FIXTURE).unwrap();
    let colors="<source id=\"colors\"><float_array id=\"rgba\" count=\"12\">1 0 0 0.5 0 1 0 1 0 0 1 1</float_array><technique_common><accessor source=\"#rgba\" count=\"3\" stride=\"4\"><param name=\"R\" type=\"float\"/><param name=\"G\" type=\"float\"/><param name=\"B\" type=\"float\"/><param name=\"A\" type=\"float\"/></accessor></technique_common></source>";
    let text = text
        .replace("<vertices id=", &format!("{colors}<vertices id="))
        .replace(
            "<p>0 1 2</p>",
            "<input semantic=\"COLOR\" source=\"#colors\" offset=\"0\"/><p>0 1 2</p>",
        )
        .replace("<scale>2 3 4</scale>", "<scale>-2 3 4</scale>");
    let scene = decode(&COLLADA, text.as_bytes(), 1 << 20).unwrap();
    for (mesh, source_id) in [(0, 0), (1, 1)] {
        let primitive = &scene.meshes[mesh]["primitives"][0];
        let material = &scene.materials[primitive["material"].as_u64().unwrap() as usize];
        assert_eq!(material["alphaMode"], "BLEND");
        assert_eq!(material["extras"]["sourceMaterial"], source_id);
        assert_eq!(attribute(&scene, primitive, "COLOR_0")[3], 0.5);
    }
    assert_eq!(
        scene.nodes.iter().find(|n| n["name"] == "first").unwrap()["matrix"][0],
        -2.
    );
}
