//! A07: what a model poured into a Unity scene keeps of its table references. The
//! merge shifted an accessor's direct `bufferView`, and that alone: the two views of
//! a sparse accessor and a primitive's morph targets kept naming the model's ranks.
//! A model alone therefore compiled, and the same model placed after a built-in cube
//! — whose views take the first ranks — was refused or read another mesh's bytes.
use super::project::{cube, mat_blanc, objet, Projet};
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
    let mut bin = Vec::new();
    for point in DENSE {
        for axis in point {
            bin.extend_from_slice(&axis.to_le_bytes());
        }
    }
    for value in [0u32, 1, 2] {
        bin.extend_from_slice(&value.to_le_bytes());
    }
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
    let projet = Projet::new(tag);
    projet.data(
        "Materials/Uni.mat",
        MAT,
        &mat_blanc("Uni", "    - _Metallic: 0\n"),
    );
    projet.model_bytes("Models/Creux.glb", MODEL, &encode_glb(&gltf, &bin), "");
    projet.scene(&format!(
        "{}{}",
        cube(100, "Cube", MAT),
        objet(
            200,
            "Modele",
            &format!("{{fileID: 4300000, guid: {MODEL}, type: 3}}"),
            "[]",
            0
        )
    ));
    let run = projet.compile(tag);
    let (_, merged) = run.prepared("unity");
    let uri = merged["buffers"][0]["uri"].as_str().expect("the binary");
    let bytes = fs::read(run.prepared_dir("unity").join(uri)).expect("the sidecar");
    (merged, bytes)
}

/// Bytes of a view.
fn view_bytes<'a>(gltf: &Value, bin: &'a [u8], view: usize) -> &'a [u8] {
    let view = &gltf["bufferViews"][view];
    let at = view["byteOffset"].as_u64().unwrap_or(0) as usize;
    let length = view["byteLength"].as_u64().expect("byteLength") as usize;
    &bin[at..at + length]
}

/// The first `count` float triples of these bytes.
fn triples(bytes: &[u8], count: usize) -> Vec<[f32; 3]> {
    bytes[..count * 12]
        .as_chunks::<12>()
        .0
        .iter()
        .map(|word| {
            let read = |axis: usize| {
                f32::from_le_bytes(word[axis * 4..axis * 4 + 4].try_into().expect("float"))
            };
            [read(0), read(1), read(2)]
        })
        .collect()
}

/// Points of an accessor, its sparse replacement applied: what the format declares,
/// and what no merge has the right to change.
fn resolved(gltf: &Value, bin: &[u8], accessor: usize) -> Vec<[f32; 3]> {
    let accessor = &gltf["accessors"][accessor];
    let count = accessor["count"].as_u64().expect("count") as usize;
    let view = accessor["bufferView"].as_u64().expect("bufferView") as usize;
    let mut out = triples(view_bytes(gltf, bin, view), count);
    if let Some(sparse) = accessor.get("sparse") {
        let replaced = sparse["count"].as_u64().expect("sparse.count") as usize;
        let ranks = view_bytes(
            gltf,
            bin,
            sparse["indices"]["bufferView"]
                .as_u64()
                .expect("sparse.indices.bufferView") as usize,
        );
        let values = triples(
            view_bytes(
                gltf,
                bin,
                sparse["values"]["bufferView"]
                    .as_u64()
                    .expect("sparse.values.bufferView") as usize,
            ),
            replaced,
        );
        for slot in 0..replaced {
            let rank = u16::from_le_bytes([ranks[slot * 2], ranks[slot * 2 + 1]]) as usize;
            out[rank] = values[slot];
        }
    }
    out
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

// Finding A07: the model's positions are the same whether it is alone or poured behind another.
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
