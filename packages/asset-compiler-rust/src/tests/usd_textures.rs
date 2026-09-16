//! Ce qu'un `UsdUVTexture` déclare autour de son fichier, à commencer par le dossier contre lequel
//! ce fichier se résout.
use super::*;
use usd_matiere::{layer, texture, unsupported};

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

// Comportement 53 : un chemin d'asset s'ancre sur le dossier de la couche qui l'écrit, pas sur la
// couche racine : une référence rangée dans un sous-dossier y trouve ses images.
#[test]
fn a_texture_of_a_referenced_layer_resolves_against_the_directory_of_that_layer() {
    let root = "#usda 1.0\n(\n    defaultPrim = \"Root\"\n)\n\ndef Xform \"Root\" (\n    prepend references = @./sous/piece.usda@</Root>\n)\n{\n}\n";
    let inputs = "            color3f inputs:diffuseColor.connect = </Root/M/T.outputs:rgb>";
    let piece = layer(inputs, &texture("T", "checker.png"));
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
