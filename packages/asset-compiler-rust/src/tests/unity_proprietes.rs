//! Les propriétés qu'un projet Unity déclare et que le pilote doit lire telles quelles : le mode
//! alpha d'un matériau, les réglages d'import d'une texture, et le rapport du pilote qui a lu un
//! modèle. Les cas d'instances et de maillages sont dans `unity_instances.rs`.
use super::*;
use unity_projet::{cube, mat, mat_blanc, material_named, Projet};

// Constat 33 : le mode alpha d'un matériau vient de ses propriétés de rendu, jamais de l'alpha de sa
// couleur. `_Mode: 0` déclare un matériau opaque : l'alpha reste dans le facteur de couleur de base,
// et le matériau ne devient pas fondu parce que cette valeur est inférieure à un.
#[test]
fn an_opaque_material_stays_opaque_whatever_the_alpha_of_its_colour() {
    let projet = Projet::new("opaque");
    let guid = "000000000000000000000000000000d1";
    projet.data(
        "Materials/Plein.mat",
        guid,
        &mat(
            "Plein",
            "    - _Mode: 0\n",
            "    - _Color: {r: 1, g: 1, b: 1, a: 0.5}\n",
        ),
    );
    projet.scene(&cube(100, "Boite", guid));
    let (_, gltf) = projet.compile("unity-opaque").prepared("unity");
    let plein = material_named(&gltf, "Plein");
    assert_eq!(
        plein["alphaMode"],
        Value::Null,
        "un matériau déclaré opaque le reste"
    );
    assert_eq!(
        plein["pbrMetallicRoughness"]["baseColorFactor"][3],
        json!(0.5),
        "l'alpha de la couleur reste le facteur de couleur de base"
    );
}

// Constat 34 : URP et HDRP déclarent le mode de rendu sous `_SurfaceType` plutôt que `_Mode`. Le
// pilote lit les deux noms de la même grandeur : transparent donne `BLEND`, la découpe seule `MASK`
// avec son seuil `_AlphaCutoff`, et un matériau qui ne déclare ni l'un ni l'autre reste opaque.
#[test]
fn the_surface_type_of_an_hdrp_material_declares_its_alpha_mode() {
    let projet = Projet::new("surface-type");
    let (fondu, masque, plein) = (
        "000000000000000000000000000000d2",
        "000000000000000000000000000000d3",
        "000000000000000000000000000000d4",
    );
    projet.data(
        "Materials/Fondu.mat",
        fondu,
        &mat_blanc("Fondu", "    - _SurfaceType: 1\n"),
    );
    projet.data(
        "Materials/Masque.mat",
        masque,
        &mat_blanc(
            "Masque",
            "    - _SurfaceType: 0\n    - _AlphaCutoffEnable: 1\n    - _AlphaCutoff: 0.3\n",
        ),
    );
    projet.data(
        "Materials/Plein.mat",
        plein,
        &mat_blanc("Plein", "    - _Metallic: 0.5\n"),
    );
    projet.scene(&format!(
        "{}{}{}",
        cube(100, "Vitre", fondu),
        cube(200, "Grille", masque),
        cube(300, "Mur", plein)
    ));
    let (_, gltf) = projet.compile("unity-surface-type").prepared("unity");
    assert_eq!(material_named(&gltf, "Fondu")["alphaMode"], "BLEND");
    assert_eq!(material_named(&gltf, "Masque")["alphaMode"], "MASK");
    assert_eq!(material_named(&gltf, "Masque")["alphaCutoff"], json!(0.3));
    assert_eq!(
        material_named(&gltf, "Plein")["alphaMode"],
        Value::Null,
        "ni `_Mode` ni `_SurfaceType` : le matériau est opaque"
    );
}
