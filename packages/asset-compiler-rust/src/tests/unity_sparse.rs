//! A07 : ce qu'un modèle versé dans une scène Unity garde de ses renvois de table. La fusion
//! décalait le `bufferView` direct d'un accesseur, et lui seul : les deux vues d'un accesseur creux
//! et les cibles de morphing d'une primitive continuaient de désigner les rangs du modèle. Un
//! modèle seul compilait donc, et le même modèle posé après un cube intégré — dont les vues
//! prennent les premiers rangs — était refusé ou lisait les octets d'un autre.
use super::*;
use unity_projet::{cube, mat_blanc, objet, Projet};

const MAT: &str = "000000000000000000000000000000a1";
const MODEL: &str = "0000000000000000000000000000000a";
/// Les positions écrites en clair dans le modèle, avant l'accesseur creux.
const DENSE: [[f32; 3]; 3] = [[0., 0., 0.], [1., 0., 0.], [0., 1., 0.]];
/// Ce que l'accesseur creux remplace : le troisième sommet, et lui seul.
const SPARSE_POINT: [f32; 3] = [0., 5., 0.];
/// Le déplacement que la cible de morphing porte sur chaque sommet.
const DELTA: [f32; 3] = [0., 0., 1.];

/// Le glTF binaire du modèle et son binaire : un triangle dont le troisième sommet est écrit dans
/// un accesseur creux, et dont la primitive porte une cible de morphing.
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

/// Compile une scène où un cube intégré précède le modèle : ses vues prennent les premiers rangs de
/// la scène, ce qui décale tous ceux du modèle.
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
    let uri = merged["buffers"][0]["uri"].as_str().expect("le binaire");
    let bytes = fs::read(run.prepared_dir("unity").join(uri)).expect("le sidecar");
    (merged, bytes)
}

/// Les octets d'une vue.
fn view_bytes<'a>(gltf: &Value, bin: &'a [u8], view: usize) -> &'a [u8] {
    let view = &gltf["bufferViews"][view];
    let at = view["byteOffset"].as_u64().unwrap_or(0) as usize;
    let length = view["byteLength"].as_u64().expect("byteLength") as usize;
    &bin[at..at + length]
}

/// Les `count` premiers triplets de flottants de ces octets.
fn triples(bytes: &[u8], count: usize) -> Vec<[f32; 3]> {
    bytes[..count * 12]
        .as_chunks::<12>()
        .0
        .iter()
        .map(|word| {
            let read = |axis: usize| {
                f32::from_le_bytes(word[axis * 4..axis * 4 + 4].try_into().expect("flottant"))
            };
            [read(0), read(1), read(2)]
        })
        .collect()
}

/// Les points d'un accesseur, son remplacement creux appliqué : ce que le format déclare, et ce
/// qu'aucune fusion n'a le droit de changer.
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

/// La primitive du maillage versé par le modèle, dans la scène fusionnée.
fn merged_primitive(gltf: &Value) -> Value {
    gltf["meshes"]
        .as_array()
        .expect("meshes")
        .iter()
        .find(|mesh| mesh["name"] == "Creux")
        .expect("le maillage du modèle")["primitives"][0]
        .clone()
}

// Constat A07 : les positions du modèle sont les mêmes qu'il soit seul ou versé derrière un autre.
#[test]
fn les_vues_dun_accesseur_creux_suivent_le_modele_dans_la_scene() {
    let (gltf, bin) = model();
    let seul = resolved(&gltf, &bin, 0);
    assert_eq!(
        seul,
        vec![DENSE[0], DENSE[1], SPARSE_POINT],
        "le modèle seul : le creux remplace le troisième sommet"
    );
    let (merged, bytes) = compile_after_cube("unity-creux");
    let position = merged_primitive(&merged)["attributes"]["POSITION"]
        .as_u64()
        .expect("POSITION") as usize;
    assert_eq!(
        resolved(&merged, &bytes, position),
        seul,
        "versé derrière un cube, le modèle garde ses positions"
    );
}

// L'autre renvoi que la fusion oubliait : les cibles de morphing d'une primitive, dont les rangs
// d'accesseur appartiennent au modèle comme les autres.
#[test]
fn les_cibles_de_morphing_suivent_le_modele_dans_la_scene() {
    let (merged, bytes) = compile_after_cube("unity-morphing");
    let target = merged_primitive(&merged)["targets"][0]["POSITION"]
        .as_u64()
        .expect("cible POSITION") as usize;
    assert_eq!(
        resolved(&merged, &bytes, target),
        vec![DELTA; 3],
        "la cible désigne bien les déplacements du modèle"
    );
}
