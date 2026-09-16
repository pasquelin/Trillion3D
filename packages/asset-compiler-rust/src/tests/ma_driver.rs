//! Ce dont tous les cas du pilote `ma` ont besoin : une scène Maya ASCII jetable écrite ici même,
//! un carré maillé, et la lecture de ce que le pilote en a fait.
//!
//! Une fixture réelle mêlerait dix comportements ; chaque cas écrit donc le minimum qui l'isole.
use super::*;

/// L'entête que tout Maya ASCII porte, et l'unité que ces cas déclarent.
const HEAD: &str = "//Maya ASCII 2024 scene\n//Écrite ici depuis la documentation publique des commandes MEL : CC0-1.0.\nrequires maya \"2024\";\ncurrentUnit -l centimeter -a degree -t film;\n";

/// Un carré maillé — deux triangles — de ce nom, sous le transform de ce chemin.
pub(super) fn quad(name: &str, parent: &str) -> String {
    format!(
        "createNode mesh -n \"{name}\" -p \"{parent}\";\n\
         \tsetAttr -s 4 \".vt[0:3]\" -type \"float3\" 0 0 0  1 0 0  1 1 0  0 1 0;\n\
         \tsetAttr -s 4 \".ed[0:3]\" 0 1 0  1 2 0  2 3 0  3 0 0;\n\
         \tsetAttr -s 1 \".fc[0:0]\" -type \"polyFaces\"\n\
         \t\tf 4 0 1 2 3;\n"
    )
}

/// Un carré nuancé de bout en bout : le transform, la forme, l'ensemble de nuançage et les deux
/// liaisons que Maya écrit entre un nuanceur, son ensemble et le maillage entier.
pub(super) fn shaded(name: &str, shader: &str) -> String {
    format!(
        "createNode transform -n \"{name}\";\n{}\
         createNode shadingEngine -n \"{shader}SG\";\n\
         connectAttr \"{shader}.oc\" \"{shader}SG.ss\";\n\
         connectAttr \"{name}Shape.iog\" \"{shader}SG.dsm\" -na;\n",
        quad(&format!("{name}Shape"), name)
    )
}

/// Écrit une scène jetable sous l'entête du format et la compile par le harnais commun des dorées.
pub(super) fn compile_ma(tag: &str, body: &str) -> GoldenRun {
    let dir = scratch("ma", tag);
    let source = dir.join("scene.ma");
    // Le pilote ne décode pas l'image : il demande au registre si ce nom se lit et si le fichier
    // est là. Un fichier PNG posé à côté suffit donc à ce que les textures d'une scène jetable
    // atteignent la sortie, sans que ces cas portent une image de plus dans le dépôt.
    fs::create_dir_all(dir.join("textures")).expect("dossier d'images");
    fs::write(dir.join("textures/checker.png"), b"\x89PNG\r\n\x1a\n").expect("image");
    fs::write(&source, format!("{HEAD}{body}")).expect("scène");
    let run = compile_golden_source(&source, tag);
    fs::remove_dir_all(&dir).ok();
    run
}

/// La translation de chaque nœud glTF de ce nom, dans l'ordre où le pilote les a écrits.
pub(super) fn translations(gltf: &Value, name: &str) -> Vec<[f64; 3]> {
    gltf["nodes"]
        .as_array()
        .expect("nodes")
        .iter()
        .filter(|node| node["name"] == name)
        .map(|node| matrix(node)[12..15].try_into().expect("translation"))
        .collect()
}

/// La matrice d'un nœud glTF, arrondie au millionième ; l'identité quand il n'en porte pas.
pub(super) fn matrix(node: &Value) -> Vec<f64> {
    let Some(values) = node["matrix"].as_array() else {
        return crate::compiler_world::IDENTITY.to_vec();
    };
    values
        .iter()
        .map(|value| (value.as_f64().expect("nombre") * 1e6).round() / 1e6)
        .collect()
}

/// Les normales d'une primitive de la scène intermédiaire, lues dans le binaire écrit à côté.
pub(super) fn normals(run: &GoldenRun, gltf: &Value, part: &Value) -> Vec<[f32; 3]> {
    let rank = part["attributes"]["NORMAL"].as_u64().expect("NORMAL") as usize;
    let accessor = &gltf["accessors"][rank];
    let view = &gltf["bufferViews"][accessor["bufferView"].as_u64().expect("vue") as usize];
    let uri = gltf["buffers"][0]["uri"].as_str().expect("le binaire");
    let bytes = fs::read(run.prepared_dir("ma").join(uri)).expect("le sidecar");
    let from = (view["byteOffset"].as_u64().unwrap_or(0)
        + accessor["byteOffset"].as_u64().unwrap_or(0)) as usize;
    let count = accessor["count"].as_u64().expect("compte") as usize;
    bytes[from..from + count * 12]
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

/// Deux normales se ressemblent-elles au millionième près ?
pub(super) fn close(found: [f32; 3], wanted: [f32; 3]) -> bool {
    (0..3).all(|axis| (found[axis] - wanted[axis]).abs() < 1e-6)
}
