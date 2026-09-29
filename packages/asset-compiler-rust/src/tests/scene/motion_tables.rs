//! A skinned, morphed and animated primitive (#357): it joins the DAG, its pages carry its joints,
//! weights and targets, and the scene tables carry its skin and its clip, so the runtime deforms
//! it on the GPU without reading the scene's binary.
use super::*;
use crate::tests::scene::scene_tables::tables_of;

/// Appends `values` to the fixture's binary as one view and one accessor of `kind`.
fn push(gltf: &mut Value, bin: &mut Vec<u8>, values: &[f32], kind: &str, count: usize) -> usize {
    let offset = bin.len();
    for value in values {
        bin.extend_from_slice(&value.to_le_bytes());
    }
    let views = gltf["bufferViews"].as_array_mut().expect("views");
    views.push(json!({"buffer":0,"byteOffset":offset,"byteLength":values.len() * 4}));
    let view = views.len() - 1;
    let accessors = gltf["accessors"].as_array_mut().expect("accessors");
    accessors.push(json!({"bufferView":view,"componentType":5126,"type":kind,"count":count}));
    accessors.len() - 1
}

#[test]
fn a_skinned_morphed_animated_primitive_is_paged_and_its_motion_tabled() {
    let (root, mut options) = fixture();
    options.scope = "full".into();
    let mut bin = fs::read(options.source.join("mesh.bin")).expect("read bin");
    let mut gltf = read_gltf(&options);
    let joints = push(
        &mut gltf,
        &mut bin,
        &[0., 1., 0., 0., 1., 0., 0., 0., 0., 0., 0., 0.],
        "VEC4",
        3,
    );
    let weights = push(
        &mut gltf,
        &mut bin,
        &[0.5, 0.5, 0., 0., 1., 0., 0., 0., 1., 0., 0., 0.],
        "VEC4",
        3,
    );
    let target = push(
        &mut gltf,
        &mut bin,
        &[0., 0., 1., 0., 0., 1., 0., 0., 1.],
        "VEC3",
        3,
    );
    let mut ibm = [0.0f32; 32];
    for joint in 0..2 {
        for d in 0..4 {
            ibm[joint * 16 + d * 5] = 1.0;
        }
    }
    let ibm = push(&mut gltf, &mut bin, &ibm, "MAT4", 2);
    let times = push(&mut gltf, &mut bin, &[0.0, 1.0], "SCALAR", 2);
    let turns = push(
        &mut gltf,
        &mut bin,
        &[0., 0., 0., 1., 0., 0.707_106_77, 0., 0.707_106_77],
        "VEC4",
        2,
    );
    gltf["buffers"][0]["byteLength"] = json!(bin.len());
    fs::write(options.source.join("mesh.bin"), &bin).expect("write bin");
    gltf["meshes"][0]["primitives"][0]["attributes"]["JOINTS_0"] = json!(joints);
    gltf["meshes"][0]["primitives"][0]["attributes"]["WEIGHTS_0"] = json!(weights);
    gltf["meshes"][0]["primitives"][0]["targets"] = json!([{"POSITION":target}]);
    gltf["nodes"] = json!([{"mesh":0,"skin":0},{"name":"hip","children":[2]},{"name":"knee"}]);
    gltf["scenes"] = json!([{"nodes":[0,1]}]);
    gltf["skins"] = json!([{"inverseBindMatrices":ibm,"joints":[1,2],"skeleton":1}]);
    gltf["animations"] = json!([{"name":"bend","samplers":[{"input":times,"output":turns}],
        "channels":[{"sampler":0,"target":{"node":2,"path":"rotation"}}]}]);
    write_gltf(&options, &gltf, Some(&bin));
    let result = compile(&options, |_| {}).expect("compile");
    let primitive = &result["primitives"][0];
    assert_eq!(
        primitive["pass"], "exact-clusters",
        "skinned geometry joins the DAG"
    );
    let flags = primitive["pages"][0]["geometry"]["flags"]
        .as_u64()
        .expect("flags");
    assert_eq!(
        flags & 48,
        48,
        "the page carries the skin and the morph target"
    );
    let tables = tables_of(&options);
    assert_eq!(tables["nodes"][0]["skin"], json!(0));
    assert_eq!(tables["skins"][0]["joints"], json!([1, 2]));
    assert_eq!(tables["skins"][0]["skeleton"], json!(1));
    assert_eq!(tables["skins"][0]["inverseBindMatrices"][5], json!(1.0));
    let channel = &tables["animations"][0]["channels"][0];
    assert_eq!(tables["animations"][0]["name"], "bend");
    assert_eq!(
        (channel["node"].clone(), channel["path"].clone()),
        (json!(2), json!("rotation"))
    );
    assert_eq!(channel["interpolation"], "LINEAR");
    assert_eq!(channel["times"], json!([0.0, 1.0]));
    assert_eq!(
        channel["values"][5],
        json!(0.70710677),
        "the shortest decimal of the f32"
    );
    fs::remove_dir_all(root).expect("cleanup");
}
