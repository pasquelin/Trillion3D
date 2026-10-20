//! What a model poured into a Unity scene keeps of its table references. The
//! merge shifts every view reference, not only an accessor's direct `bufferView`: the two views
//! of a sparse accessor and a primitive's morph targets would keep naming the model's ranks.
//! A model alone would then compile, and the same model placed after a built-in cube
//! — whose views take the first ranks — would be refused or read another mesh's bytes.
use super::project::{cube, game_object, white_mat, UnityProject};
use super::*;

const MAT: &str = "000000000000000000000000000000a1";
const MODEL: &str = "0000000000000000000000000000000a";
/// Positions written plainly in the model, before the sparse accessor.
const DENSE: [[f32; 3]; 3] = [[0., 0., 0.], [1., 0., 0.], [0., 1., 0.]];
/// What the sparse accessor replaces: the third vertex, and that alone.
const SPARSE_POINT: [f32; 3] = [0., 5., 0.];
/// Displacement the morph target carries on each vertex.
const DELTA: [f32; 3] = [0., 0., 1.];

/// The model's binary glTF and its binary: a triangle whose third vertex is written
/// in a sparse accessor, and whose primitive carries a morph target.
fn model() -> (Value, Vec<u8>) {
    let mut bin = triangle_bin();
    bin.extend_from_slice(&2u16.to_le_bytes());
    bin.extend_from_slice(&[0, 0]);
    for axis in SPARSE_POINT {
        bin.extend_from_slice(&axis.to_le_bytes());
    }
    for axis in DELTA.repeat(3) {
        bin.extend_from_slice(&axis.to_le_bytes());
    }
    let gltf = json!({
        "asset":{"version":"2.0"},
        "buffers":[{"byteLength":bin.len()}],
        "bufferViews":[
            {"buffer":0,"byteOffset":0,"byteLength":36},
            {"buffer":0,"byteOffset":36,"byteLength":12},
            {"buffer":0,"byteOffset":48,"byteLength":2},
            {"buffer":0,"byteOffset":52,"byteLength":12},
            {"buffer":0,"byteOffset":64,"byteLength":36},
        ],
        "accessors":[
            {"bufferView":0,"componentType":5126,"type":"VEC3","count":3,
             "sparse":{"count":1,"indices":{"bufferView":2,"componentType":5123},"values":{"bufferView":3}}},
            {"bufferView":1,"componentType":5125,"type":"SCALAR","count":3},
            {"bufferView":4,"componentType":5126,"type":"VEC3","count":3},
        ],
        "meshes":[{"name":"Creux","primitives":[
            {"attributes":{"POSITION":0},"indices":1,"targets":[{"POSITION":2}]},
        ]}],
        "nodes":[{"name":"Creux","mesh":0}],
    });
    (gltf, bin)
}

/// Compiles a scene where a built-in cube precedes the model: its views take the
/// first ranks of the scene, which shifts all of the model's.
fn compile_after_cube(tag: &str) -> (Value, Vec<u8>) {
    let (gltf, bin) = model();
    let project = UnityProject::new(tag);
    project.data(
        "Materials/Uni.mat",
        MAT,
        &white_mat("Uni", "    - _Metallic: 0\n"),
    );
    project.model_bytes("Models/Creux.glb", MODEL, &encode_glb(&gltf, &bin), "");
    project.scene(&format!(
        "{}{}",
        cube(100, "Cube", MAT),
        game_object(
            200,
            "Modele",
            &format!("{{fileID: 4300000, guid: {MODEL}, type: 3}}"),
            "[]",
            0
        )
    ));
    let run = project.compile(tag);
    let (_, merged) = run.prepared("unity");
    let uri = merged["buffers"][0]["uri"].as_str().expect("the binary");
    let bytes = fs::read(run.prepared_dir("unity").join(uri)).expect("the sidecar");
    (merged, bytes)
}

/// Points of an accessor, its sparse replacement applied by the compiler's one reader: what the
/// format declares, and what no merge has the right to change.
fn resolved(gltf: &Value, bin: &[u8], accessor: usize) -> Vec<[f32; 3]> {
    accessor_floats(gltf, bin, accessor)
        .as_chunks::<3>()
        .0
        .to_vec()
}

/// Primitive of the mesh poured by the model, in the merged scene.
fn merged_primitive(gltf: &Value) -> Value {
    gltf["meshes"]
        .as_array()
        .expect("meshes")
        .iter()
        .find(|mesh| mesh["name"] == "Creux")
        .expect("the model's mesh")["primitives"][0]
        .clone()
}

// The model's positions are the same whether it is alone or poured behind another.
#[test]
fn sparse_accessor_views_follow_the_model_into_the_scene() {
    let (gltf, bin) = model();
    let seul = resolved(&gltf, &bin, 0);
    assert_eq!(
        seul,
        vec![DENSE[0], DENSE[1], SPARSE_POINT],
        "the model alone: the sparse replaces the third vertex"
    );
    let (merged, bytes) = compile_after_cube("unity-creux");
    let position = merged_primitive(&merged)["attributes"]["POSITION"]
        .as_u64()
        .expect("POSITION") as usize;
    assert_eq!(
        resolved(&merged, &bytes, position),
        seul,
        "poured behind a cube, the model keeps its positions"
    );
}

// The other reference the merge forgot: a primitive's morph targets, whose accessor
// ranks belong to the model like the others.
#[test]
fn morph_targets_follow_the_model_into_the_scene() {
    let (merged, bytes) = compile_after_cube("unity-morphing");
    let target = merged_primitive(&merged)["targets"][0]["POSITION"]
        .as_u64()
        .expect("POSITION target") as usize;
    assert_eq!(
        resolved(&merged, &bytes, target),
        vec![DELTA; 3],
        "the target does name the model's displacements"
    );
}
