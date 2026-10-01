use super::super::mesh_source::test_support::{attribute, read as decode};
use super::*;
const FIXTURE: &[u8] = include_bytes!("../../../../../../tests/fixtures/formats/3ds/scene.3ds");
#[test]
fn chunks_keep_face_order_equal_material_slots_uvs_normals_and_master_scale() {
    let scene = decode(&THREEDS, FIXTURE, 1 << 20).unwrap();
    assert_eq!(scene.mesh_triangles, [2]);
    assert_eq!(scene.materials.len(), 2);
    let parts = scene.meshes[0]["primitives"].as_array().unwrap();
    assert_eq!(parts[0]["material"], 1);
    assert_eq!(parts[1]["material"], 0);
    assert_eq!(
        attribute(&scene, &parts[0], "POSITION"),
        [0., 0., 0., 1., 0., 0., 1., 1., 0.]
    );
    assert_eq!(
        attribute(&scene, &parts[0], "TEXCOORD_0"),
        [0., 1., 1., 1., 1., 0.]
    );
    assert_eq!(
        attribute(&scene, &parts[0], "NORMAL"),
        [0., 0., 1., 0., 0., 1., 0., 0., 1.]
    );
    assert_eq!(scene.nodes[0]["extras"]["sourceLocalFrame"][9], 2.);
    assert!((scene.nodes[1]["matrix"][0].as_f64().unwrap() - 0.01).abs() < 1e-9);
}
#[test]
fn chunks_cannot_escape_their_parent_or_claim_unsupported_animation() {
    for end in [0, 5, FIXTURE.len() - 1] {
        assert!(decode(&THREEDS, &FIXTURE[..end], 1 << 20).is_err());
    }
    let mut short = FIXTURE.to_vec();
    short[2..6].copy_from_slice(&5u32.to_le_bytes());
    assert!(decode(&THREEDS, &short, 1 << 20).is_err());
    let mut animation = FIXTURE.to_vec();
    let position = animation
        .windows(2)
        .position(|b| b == [0x3d, 0x3d])
        .unwrap();
    animation[position..position + 2].copy_from_slice(&0xb000u16.to_le_bytes());
    assert!(decode(&THREEDS, &animation, 1 << 20).is_err());
    assert!(decode(&THREEDS, FIXTURE, 64).is_err());
}
