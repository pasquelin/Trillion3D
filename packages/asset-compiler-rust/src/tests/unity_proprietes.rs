//! Les propriétés qu'un projet Unity déclare et que le pilote doit lire telles quelles : le mode
//! alpha d'un matériau, les réglages d'import d'une texture, et le rapport du pilote qui a lu un
//! modèle. Les cas d'instances et de maillages sont dans `unity_instances.rs`.
use super::*;
use unity_projet::{cube, mat, material_named, Projet};

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
