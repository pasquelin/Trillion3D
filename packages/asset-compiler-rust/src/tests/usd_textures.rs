//! Ce qu'un `UsdUVTexture` déclare autour de son fichier : contre quel dossier ce fichier se
//! résout, comment ses deux axes se répètent, et ce que `scale`, `bias` et `sourceColorSpace`
//! deviennent en glTF.
use super::*;
use usd_matiere::{layer, pbr, texture, unsupported};

/// Écrit une arborescence jetable — des couches et les images qu'elles citent, chacune à son
/// chemin sous la racine — puis compile `scene.usda` par le harnais commun.
pub(super) fn compile_files(tag: &str, layers: &[(&str, &str)], images: &[&str]) -> GoldenRun {
    let dir = usd_driver::temp_dir(tag);
    let checker = golden_dir("usd")
        .join("minuscule")
        .join("textures")
        .join("checker.png");
    for (name, body) in layers {
        write_under(&dir, name, |path| fs::write(path, body).map(|_| ()));
    }
    for file in images {
        write_under(&dir, file, |path| fs::copy(&checker, path).map(|_| ()));
    }
    let run = compile_golden_source(&dir.join("scene.usda"), tag);
    fs::remove_dir_all(&dir).ok();
    run
}

/// Pose un fichier sous la racine jetable, ses dossiers créés d'abord.
fn write_under(root: &Path, name: &str, put: impl FnOnce(&Path) -> std::io::Result<()>) {
    let path = root.join(name);
    fs::create_dir_all(path.parent().expect("dossier")).expect("dossier");
    put(&path).unwrap_or_else(|error| panic!("{name}: {error}"));
}

/// L'échantillonneur de la seule texture de la scène.
fn sampler(gltf: &Value) -> Value {
    let rank = gltf["textures"][0]["sampler"].as_u64().expect("sampler");
    gltf["samplers"][rank as usize].clone()
}

// Comportement 53 : un chemin d'asset s'ancre sur le dossier de la couche qui l'écrit, pas sur la
// couche racine : une référence rangée dans un sous-dossier y trouve ses images.
#[test]
fn a_texture_of_a_referenced_layer_resolves_against_the_directory_of_that_layer() {
    let root = "#usda 1.0\n(\n    defaultPrim = \"Root\"\n)\n\ndef Xform \"Root\" (\n    prepend references = @./sous/piece.usda@</Root>\n)\n{\n}\n";
    let inputs = "            color3f inputs:diffuseColor.connect = </Root/M/T.outputs:rgb>";
    let piece = layer(inputs, &texture("T", "checker.png", ""));
    let run = compile_files(
        "couche-referencee",
        &[("scene.usda", root), ("sous/piece.usda", &piece)],
        &["sous/textures/checker.png"],
    );
    assert_eq!(
        unsupported(&run)["usd-texture-missing"],
        Value::Null,
        "la texture de la couche référencée est trouvée"
    );
    let (_, gltf) = run.prepared("usd");
    assert_eq!(
        gltf["images"][0]["uri"], "sous/textures/checker.png",
        "l'URI reste relative à la racine des images"
    );
}

// Comportement 54 : `wrapS` et `wrapT` sont deux axes, jamais un seul ; un mode que glTF n'a pas
// répète et se compte ; `scale` uniforme sans `bias` entre dans le facteur glTF, et le reste — un
// `scale` qui ne s'y ramène pas, un espace de couleur contraire au rôle de l'entrée — est compté.
#[test]
fn the_wrap_scale_bias_and_colour_space_of_a_uv_texture_are_carried_or_counted() {
    let inputs = "            color3f inputs:diffuseColor.connect = </Root/M/T.outputs:rgb>";
    let axes =
        "            token inputs:wrapS = \"repeat\"\n            token inputs:wrapT = \"clamp\"\n";
    let run = compile_files(
        "axes",
        &[(
            "scene.usda",
            &layer(inputs, &texture("T", "checker.png", axes)),
        )],
        &["textures/checker.png"],
    );
    let (_, gltf) = run.prepared("usd");
    assert_eq!(
        [&sampler(&gltf)["wrapS"], &sampler(&gltf)["wrapT"]],
        [&json!(10497), &json!(33071)],
        "chaque axe garde son propre mode"
    );

    let black = "            token inputs:wrapT = \"black\"\n";
    let run = compile_files(
        "bord-noir",
        &[(
            "scene.usda",
            &layer(inputs, &texture("T", "checker.png", black)),
        )],
        &["textures/checker.png"],
    );
    assert_eq!(unsupported(&run)["usd-texture-wrap-unsupported"], 1);

    let scale = "            float4 inputs:scale = (0.5, 0.5, 0.5, 1)\n";
    let run = compile_files(
        "echelle",
        &[(
            "scene.usda",
            &layer(inputs, &texture("T", "checker.png", scale)),
        )],
        &["textures/checker.png"],
    );
    let (_, gltf) = run.prepared("usd");
    assert_eq!(
        pbr(&gltf)["baseColorFactor"],
        json!([0.5, 0.5, 0.5, 1.0]),
        "un scale uniforme sans bias est porté par le facteur"
    );

    let tilted = "            float4 inputs:scale = (0.5, 1, 1, 1)\n            float4 inputs:bias = (0.1, 0, 0, 0)\n";
    let run = compile_files(
        "echelle-biaisee",
        &[(
            "scene.usda",
            &layer(inputs, &texture("T", "checker.png", tilted)),
        )],
        &["textures/checker.png"],
    );
    assert_eq!(unsupported(&run)["usd-texture-scale-unsupported"], 1);
    let (_, gltf) = run.prepared("usd");
    assert_eq!(
        pbr(&gltf)["baseColorFactor"],
        json!([1.0, 1.0, 1.0, 1.0]),
        "ce que le facteur ne porte pas n'est pas inventé"
    );

    let raw = "            token inputs:sourceColorSpace = \"raw\"\n";
    let run = compile_files(
        "espace",
        &[(
            "scene.usda",
            &layer(inputs, &texture("T", "checker.png", raw)),
        )],
        &["textures/checker.png"],
    );
    assert_eq!(unsupported(&run)["usd-texture-colour-space-unsupported"], 1);
}
