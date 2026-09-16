//! Doré du pilote `obj`. Une fixture écrite à la main, et sa bibliothèque de matériaux.
//!
//! `minuscule/scene.obj` tient deux groupes — un quadrilatère et un pentagone —, deux matériaux, et
//! un `.mtl` qui décrit tout ce qu'une bibliothèque sait déclarer et que glTF ne sait pas toujours
//! porter : couleur ambiante, spéculaire, indice de réfraction, exposant, opacité et sa carte à
//! part, émission, normale et relief distincts, et les options de map `-s`, `-o`, `-bm`, `-clamp`.
//! Elle fixe ce que le pilote produit, jusqu'aux octets du sidecar, et ce qu'il compte sans le
//! rendre.
use super::*;

const CASE: &str = "Un OBJ et son MTL : deux groupes nuancés par deux matériaux, un quadrilatère et un pentagone, une couleur ambiante et sa carte, une couleur spéculaire, un exposant, un indice de réfraction, une opacité de 0,5 avec sa carte à part, une émission texturée, une normale et un relief qui visent deux fichiers différents, et les options de map -s, -o, -bm et -clamp.";
const RULE: &str = "Le pilote rend ce que la bibliothèque déclare et compte le reste par son nom : la normale l'emporte sur le relief, l'opacité reste un mélange et jamais une découpe, -clamp devient le mode de bord de l'échantillonneur, et couleur ambiante, spéculaire, indice de réfraction, décalage, échelle et force de relief sont comptés faute de place dans le modèle métal-rugosité de glTF.";

// Comportement : la fixture passe par le compilateur, et sa scène intermédiaire comme sa sortie
// compilée sont comparées à expected.json.
#[test]
fn the_obj_fixture_compiles_to_its_golden_expected_json() {
    let dir = golden_dir("obj");
    let run = compile_golden_source(&fixture(&dir), "obj-minuscule");
    assert_eq!(
        digest(&run),
        golden_expected(&dir),
        "fixture obj : la sortie compilée diverge de expected.json"
    );
}

#[test]
#[ignore = "écrit dans fixtures/ ; se relance à la main, et son diff se relit"]
fn regenere_la_fixture_obj() {
    let dir = golden_dir("obj");
    let run = compile_golden_source(&fixture(&dir), "obj-minuscule");
    write_expected(&dir, digest(&run), CASE, RULE);
}

/// Le fichier de la fixture minuscule.
fn fixture(dir: &Path) -> PathBuf {
    dir.join("minuscule").join("scene.obj")
}

/// Le relevé par fichier, sans ses durées : une dorée fixe une scène, jamais une horloge.
fn files_without_timings(files: &Value) -> Value {
    let mut listed = files.clone();
    for file in listed.as_array_mut().into_iter().flatten() {
        for timing in ["ms", "parseMs"] {
            if let Some(object) = file.as_object_mut() {
                object.remove(timing);
            }
        }
    }
    listed
}

/// Ce que la dorée fixe : le pilote retenu, la scène intermédiaire qu'il a écrite — nœuds,
/// maillages, matériaux, images, échantillonneurs, rapport — et la scène compilée qui en sort.
fn digest(run: &GoldenRun) -> Value {
    let (digest, manifest, gltf) = scene_digest(run, "obj");
    let mut out = digest;
    for (field, value) in [
        ("scenePlugin", run.result["scenePlugin"].clone()),
        ("meshes", gltf["meshes"].clone()),
        ("materials", gltf["materials"].clone()),
        ("images", gltf["images"].clone()),
        ("samplers", gltf["samplers"].clone()),
        ("textures", gltf["textures"].clone()),
        ("accessors", gltf["accessors"].clone()),
        ("files", files_without_timings(&manifest["source"]["files"])),
        ("external", manifest["source"]["external"].clone()),
        ("sidecarSha256", json!(hash(&run.binary))),
        ("selectedNodes", run.result["selectedNodes"].clone()),
        ("sourceTriangles", run.result["sourceTriangles"].clone()),
    ] {
        out[field] = value;
    }
    out
}
