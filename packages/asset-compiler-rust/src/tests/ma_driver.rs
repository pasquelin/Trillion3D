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

/// Écrit une scène jetable sous l'entête du format et la compile par le harnais commun des dorées.
pub(super) fn compile_ma(tag: &str, body: &str) -> GoldenRun {
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("clock")
        .as_nanos();
    let dir = std::env::temp_dir().join(format!("wg-ma-{tag}-{}-{stamp}", std::process::id()));
    fs::create_dir_all(&dir).expect("dossier");
    let source = dir.join("scene.ma");
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
