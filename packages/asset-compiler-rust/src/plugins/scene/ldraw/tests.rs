use super::*;
use source::test_support::{attribute, read};
const FIXTURE: &[u8] = include_bytes!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../tests/fixtures/formats/ldraw/two-instances.mpd"
));
#[test]
fn ldraw_mpd_instances_units_colour_and_quad_order_are_preserved() {
    let scene = read(&LDRAW, FIXTURE, 1024 * 1024).unwrap();
    assert_eq!(scene.meshes.len(), 1);
    assert_eq!(scene.mesh_triangles, vec![2]);
    assert_eq!(scene.nodes.len(), 3);
    assert_eq!(scene.nodes[0]["mesh"], scene.nodes[1]["mesh"]);
    assert_eq!(scene.nodes[0]["matrix"][12], json!(0.004));
    assert_eq!(scene.nodes[1]["matrix"][13], json!(0.008));
    assert_eq!(scene.nodes[2]["matrix"][5], json!(-1));
    let p = &scene.meshes[0]["primitives"][0];
    assert_eq!(
        attribute(&scene, p, "POSITION"),
        vec![
            0., 0., 0., 0.004, 0., 0., 0.004, 0.004, 0., 0., 0., 0., 0.004, 0.004, 0., 0., 0.004,
            0.
        ]
    );
    let material = &scene.materials[0];
    assert_eq!(material["alphaMode"], "BLEND");
    let rgb = &material["pbrMetallicRoughness"]["baseColorFactor"];
    assert_eq!(rgb[0], json!(1.0));
    assert!((rgb[1].as_f64().unwrap() - 0.21586).abs() < 0.00001);
    assert!((rgb[3].as_f64().unwrap() - 128. / 255.).abs() < 1e-7);
    assert_eq!(material["doubleSided"], json!(false));
}
#[test]
fn ldraw_bfc_invertnext_changes_only_referenced_winding() {
    let text =
        std::str::from_utf8(FIXTURE)
            .unwrap()
            .replacen("1 100", "0 BFC INVERTNEXT\n1 100", 1);
    let scene = read(&LDRAW, text.as_bytes(), 1024 * 1024).unwrap();
    assert_eq!(scene.meshes.len(), 2);
    let normals: Vec<_> = scene
        .meshes
        .iter()
        .map(|m| attribute(&scene, &m["primitives"][0], "NORMAL"))
        .collect();
    assert!(normals[0]
        .as_chunks::<3>()
        .0
        .iter()
        .all(|n| *n == [0., 0., -1.]));
    assert!(normals[1]
        .as_chunks::<3>()
        .0
        .iter()
        .all(|n| *n == [0., 0., 1.]));
}
#[test]
fn ldraw_refuses_cycles_escape_unknown_colours_and_texture_commands() {
    let text = std::str::from_utf8(FIXTURE).unwrap();
    for invalid in [
        text.replace("panel.dat", "../panel.dat"),
        text.replace("panel.dat", "/etc/passwd"),
        text.replace("4 16", "4 999"),
        text.replace("0 BFC CERTIFY CCW", "0 !TEXMAP START PLANAR"),
        text.replace(
            "4 16 0 0 0 10 0 0 10 10 0 0 10 0",
            "1 16 0 0 0 1 0 0 0 1 0 0 0 1 model.ldr",
        ),
        text.replace("4 16 0", "4 16 NaN"),
    ] {
        assert!(
            read(&LDRAW, invalid.as_bytes(), 1024 * 1024).is_err(),
            "must refuse {invalid}"
        );
    }
    assert!(read(&LDRAW, FIXTURE, 512).is_err());
}
