//! L'opacité d'un FBX classique. `ufbx` ne la range dans `pbr.opacity` que pour les shaders qui
//! déclarent une opacité ; un matériau `phong` la porte dans `fbx.transparency_*`. La fixture
//! `fixtures/import-fbx/riviere.fbx` reproduit cette forme, celle du Village.
use super::*;

/// Copie la fixture FBX dans un dossier jetable avec ses deux images. `shared_texture` rebranche la
/// carte d'opacité sur la texture de couleur de base, le seul cas que glTF sait porter.
pub(super) fn fbx_fixture(shared_texture: bool) -> (PathBuf, Options) {
    let (root, mut options) = fixture();
    let source = root.join("fbx");
    fs::create_dir_all(&source).expect("dossier fbx");
    let mut fbx =
        fs::read_to_string(golden_dir("import-fbx").join("riviere.fbx")).expect("fixture");
    if shared_texture {
        fbx = fbx.replace(
            "C: \"OP\",5000,3000, \"TransparentColor\"",
            "C: \"OP\",4000,3000, \"TransparentColor\"",
        );
    }
    fs::write(source.join("riviere.fbx"), &fbx).expect("fbx");
    for image in ["albedo.png", "opacite.png"] {
        fs::write(source.join(image), b"\x89PNG\r\n\x1a\npas-un-vrai-png").expect("png");
    }
    options.source = source.join("riviere.fbx");
    options.scope = "full".into();
    options.triangle_budget = 150000;
    (root, options)
}

/// Le glTF importé et le manifeste d'import de la fixture.
pub(super) fn import_of(options: &Options) -> (Value, Value) {
    compile(options, |_| {}).expect("compile fbx");
    let imports = options.cache.join("native/imports");
    let entry = fs::read_dir(&imports)
        .expect("imports")
        .map(|e| e.expect("entrée").path())
        .next()
        .expect("un import");
    (
        read_json(&entry.join("model.gltf")),
        read_json(&entry.join("manifest.json")),
    )
}

#[test]
fn la_transparence_fbx_classique_devient_un_materiau_mele() {
    let (root, options) = fbx_fixture(false);
    let (gltf, manifest) = import_of(&options);
    let material = &gltf["materials"][0];
    assert_eq!(material["name"], "M_Riviere");
    // TransparentColor blanc pondéré par TransparencyFactor 0,25 : il reste 0,75 d'opacité.
    assert_eq!(
        material["pbrMetallicRoughness"]["baseColorFactor"][3],
        json!(0.75)
    );
    assert_eq!(material["alphaMode"], "BLEND", "{material}");
    // Jamais de découpe : un transparent masqué serait une perte de fidélité.
    assert!(material["alphaCutoff"].is_null(), "{material}");
    // La carte d'opacité n'est pas celle de la couleur de base : glTF ne peut pas la porter, donc
    // le rapport la signale au lieu de l'avaler.
    assert_eq!(
        manifest["unsupported"]["material-separate-opacity-texture"],
        json!(1),
        "{}",
        manifest["unsupported"]
    );
    fs::remove_dir_all(root).expect("nettoyage");
}

#[test]
fn une_carte_dopacite_partagee_avec_la_couleur_de_base_se_branche_sans_rapport() {
    let (root, options) = fbx_fixture(true);
    let (gltf, manifest) = import_of(&options);
    let material = &gltf["materials"][0];
    assert_eq!(material["alphaMode"], "BLEND", "{material}");
    assert_eq!(
        material["pbrMetallicRoughness"]["baseColorTexture"]["index"],
        json!(0)
    );
    assert!(
        manifest["unsupported"]["material-separate-opacity-texture"].is_null(),
        "{}",
        manifest["unsupported"]
    );
    fs::remove_dir_all(root).expect("nettoyage");
}

/// La convention FBX classique, isolée : `TransparentColor` est une transparence, pas une opacité.
#[test]
fn transparent_color_noir_vaut_opaque() {
    use crate::import::opacity::opacity_from_transparency as opacity;
    // La forme de `M_Water_Ocean` dans le Village : couleur noire, facteur plein.
    assert_eq!(opacity([0.0, 0.0, 0.0], 1.0), 1.0);
    assert_eq!(opacity([1.0, 1.0, 1.0], 0.25), 0.75);
    assert_eq!(opacity([1.0, 1.0, 1.0], 1.0), 0.0);
    // Hors bornes des deux côtés : l'opacité reste entre 0 et 1.
    assert_eq!(opacity([2.0, 2.0, 2.0], 1.0), 0.0);
    assert_eq!(opacity([-1.0, -1.0, -1.0], 1.0), 1.0);
}
