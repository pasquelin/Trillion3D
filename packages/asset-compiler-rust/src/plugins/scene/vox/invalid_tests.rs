//! Scene corruption must fail before cache emission, not loop or lose an instance.
use super::*;
use source::test_support::read;
const SCENE: &[u8] = include_bytes!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../tests/fixtures/formats/vox/scene.vox"
));
const BUDGET: usize = 16 * 1024 * 1024;

#[test]
fn vox_rejects_scene_cycles_invalid_axes_and_missing_model_references() {
    let mut cyclic = SCENE.to_vec();
    let trn = cyclic.windows(4).position(|v| v == b"nTRN").unwrap();
    let mut r = Reader::new(&cyclic[trn + 12..]);
    r.i32().unwrap();
    r.dict(&mut Budget::new(BUDGET)).unwrap();
    let child = cyclic.len() - r.remaining();
    cyclic[child..child + 4].copy_from_slice(&0i32.to_le_bytes());
    assert!(read(&VOX, &cyclic, BUDGET).is_err());

    let mut missing = SCENE.to_vec();
    let shape = missing.windows(4).position(|v| v == b"nSHP").unwrap();
    missing[shape + 24..shape + 28].copy_from_slice(&999u32.to_le_bytes());
    assert!(read(&VOX, &missing, BUDGET).is_err());

    let mut invalid_axes = Dict::new();
    invalid_axes.insert("_r".into(), "0".into());
    assert!(graph::matrix(&invalid_axes).is_err());
    invalid_axes.insert("_r".into(), "255".into());
    assert!(graph::matrix(&invalid_axes).is_err());
}

#[test]
fn vox_equal_palette_colours_keep_distinct_authored_material_slots() {
    let mut equal = SCENE.to_vec();
    let palette = equal.windows(4).position(|v| v == b"RGBA").unwrap() + 12;
    let first: [u8; 4] = equal[palette..palette + 4].try_into().unwrap();
    equal[palette + 4..palette + 8].copy_from_slice(&first);
    let scene = read(&VOX, &equal, BUDGET).unwrap();
    assert_eq!(scene.materials.len(), 2);
    assert_eq!(
        scene.materials[0]["pbrMetallicRoughness"]["baseColorFactor"],
        scene.materials[1]["pbrMetallicRoughness"]["baseColorFactor"]
    );
    assert_eq!(scene.meshes[0]["primitives"][0]["material"], 0);
    assert_eq!(scene.meshes[0]["primitives"][1]["material"], 1);
}

#[test]
fn vox_bit_rotation_preserves_reflection_and_signed_integer_translation() {
    let frame = Dict::from([("_r".into(), "20".into()), ("_t".into(), "-2 3 -4".into())]);
    assert_eq!(
        graph::matrix(&frame).unwrap(),
        [-1., 0., 0., 0., 0., 1., 0., 0., 0., 0., 1., 0., -2., 3., -4., 1.]
    );
}

#[test]
fn vox_graph_metadata_has_its_own_cumulative_admission_before_allocation() {
    let mut bytes = include_bytes!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../tests/fixtures/formats/vox/default.vox"
    ))
    .to_vec();
    for id in 0..500i32 {
        bytes.extend(b"nGRP");
        bytes.extend(12u32.to_le_bytes());
        bytes.extend(0u32.to_le_bytes());
        bytes.extend(id.to_le_bytes());
        bytes.extend(0u32.to_le_bytes());
        bytes.extend(0u32.to_le_bytes());
    }
    let payload = (bytes.len() - 20) as u32;
    bytes[16..20].copy_from_slice(&payload.to_le_bytes());
    let budget = 1024 * 1024;
    assert!(
        bytes.len() < budget / 8,
        "passes file-byte admission with only one voxel"
    );
    assert_eq!(
        read(&VOX, &bytes, budget).err().unwrap().code,
        "IMPORT_OUT_OF_MEMORY"
    );
}

#[test]
fn vox_face_winding_matches_outward_normals_on_every_axis() {
    let scene = read(&VOX, SCENE, BUDGET).unwrap();
    for primitive in scene.meshes[0]["primitives"].as_array().unwrap() {
        let positions = source::test_support::attribute(&scene, primitive, "POSITION");
        let normals = source::test_support::attribute(&scene, primitive, "NORMAL");
        let accessor = &scene.accessors[primitive["indices"].as_u64().unwrap() as usize];
        assert_eq!(accessor["componentType"], 5123);
        let view = &scene.bin.views[accessor["bufferView"].as_u64().unwrap() as usize];
        let start = view["byteOffset"].as_u64().unwrap() as usize;
        let count = accessor["count"].as_u64().unwrap() as usize;
        for bytes in scene.bin.bytes[start..start + count * 2]
            .as_chunks::<6>()
            .0
            .iter()
        {
            let indices: Vec<_> = bytes
                .as_chunks::<2>()
                .0
                .iter()
                .map(|v| u16::from_le_bytes(*v) as usize)
                .collect();
            let at = |vertex: usize, axis: usize| positions[indices[vertex] * 3 + axis];
            let a = std::array::from_fn::<_, 3, _>(|i| at(1, i) - at(0, i));
            let b = std::array::from_fn::<_, 3, _>(|i| at(2, i) - at(0, i));
            let cross = [
                a[1] * b[2] - a[2] * b[1],
                a[2] * b[0] - a[0] * b[2],
                a[0] * b[1] - a[1] * b[0],
            ];
            let dot = (0..3)
                .map(|i| cross[i] * normals[indices[0] * 3 + i])
                .sum::<f32>();
            assert_eq!(dot, 1.0, "outward triangle has unit area twice");
        }
    }
}
