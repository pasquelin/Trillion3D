//! Les propriétés qu'un projet Unity déclare et que le pilote doit lire telles quelles : le mode
//! alpha d'un matériau, les réglages d'import d'une texture, et le rapport du pilote qui a lu un
//! modèle. Les cas d'instances et de maillages sont dans `unity_instances.rs`.
use super::*;
use unity_projet::{cube, instancie, mat, mat_blanc, material_named, Projet};

/// Le GUID du modèle de chaque cas.
const MODEL: &str = "0000000000000000000000000000000a";

/// Une image d'un pixel, écrite ici même : le registre d'images la reconnaît par son extension.
const PIXEL: [u8; 70] = [
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
    0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0xf8, 0xcf, 0xc0, 0xf0,
    0x1f, 0x00, 0x05, 0x00, 0x01, 0xff, 0x89, 0x99, 0x3d, 0x1d, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45,
    0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
];

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

// Constat 51 : le modèle qu'une scène cite est lu par le pilote de son format, qui compte lui aussi
// ce qu'il n'a pas su rendre. Ce rapport appartient à la scène Unity : ses codes y remontent sous
// leur propre nom, et deux modèles qui manquent la même chose s'additionnent.
#[test]
fn the_report_of_the_model_driver_reaches_the_unity_report() {
    let projet = Projet::new("rapport-modele");
    let obj = b"mtllib absente.mtl\nv 0 0 0\nv 1 0 0\nv 0 1 0\nusemtl Uni\nf 1 2 3\n";
    projet.model_bytes("Models/Triangle.obj", MODEL, obj, "");
    projet.scene(&instancie(
        "Socle",
        &format!("{{fileID: 4300000, guid: {MODEL}, type: 3}}"),
    ));
    let (manifest, _) = projet.compile("unity-rapport-modele").prepared("unity");
    assert_eq!(
        manifest["unsupported"]["material-library-missing"],
        json!(1),
        "le rapport du pilote modèle remonte tel quel: {}",
        manifest["unsupported"]
    );
}

// Constat 52 : le `.meta` d'une texture déclare comment l'échantillonner — la répétition de chaque
// axe et le filtrage. L'échantillonneur glTF les porte : une texture bornée sur un axe et répétée
// sur l'autre garde ses deux modes, et un filtrage au plus proche n'est pas lissé.
#[test]
fn the_texture_importer_of_a_meta_gives_the_sampler_its_wrap_and_filter() {
    let projet = Projet::new("sampler");
    let (image, matiere) = (
        "000000000000000000000000000000f1",
        "000000000000000000000000000000f2",
    );
    projet.asset(
        "Textures/pixel.png",
        &PIXEL,
        image,
        "TextureImporter:\n  wrapU: 1\n  wrapV: 0\n  filterMode: 0\n  sRGBTexture: 1\n",
    );
    projet.data(
        "Materials/Peinte.mat",
        matiere,
        &mat_blanc_texture("Peinte", image),
    );
    projet.scene(&cube(100, "Boite", matiere));
    let (_, gltf) = projet.compile("unity-sampler").prepared("unity");
    let sampler = &gltf["samplers"][0];
    assert_eq!(sampler["wrapS"], json!(33071), "`wrapU: 1` borne l'axe S");
    assert_eq!(sampler["wrapT"], json!(10497), "`wrapV: 0` répète l'axe T");
    assert_eq!(
        sampler["magFilter"],
        json!(9728),
        "`filterMode: 0` échantillonne au plus proche"
    );
    assert_eq!(sampler["minFilter"], json!(9984));
}

/// Un `.mat` blanc dont la couleur de base porte la texture de ce GUID.
fn mat_blanc_texture(name: &str, image: &str) -> String {
    let body = mat_blanc(name, "");
    body.replace(
        "m_TexEnvs: []",
        &format!("m_TexEnvs:\n    - _MainTex:\n        m_Texture: {{fileID: 2800000, guid: {image}, type: 3}}\n        m_Scale: {{x: 1, y: 1}}\n        m_Offset: {{x: 0, y: 0}}"),
    )
}
