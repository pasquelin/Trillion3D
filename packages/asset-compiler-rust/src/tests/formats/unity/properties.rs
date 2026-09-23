//! Properties a Unity project declares and that the driver must read as-is: a
//! material's alpha mode, a texture's import settings, and the report of the driver
//! that read a model. Instance and mesh cases are in `instances.rs`.
use super::project::{cube, instance_of, mat, material_named, white_mat, UnityProject};
use super::*;

/// GUID of the model of each case.
const MODEL: &str = "0000000000000000000000000000000a";

/// A one-pixel image, written here: the image registry recognises it by its extension.
const PIXEL: [u8; 70] = [
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
    0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0xf8, 0xcf, 0xc0, 0xf0,
    0x1f, 0x00, 0x05, 0x00, 0x01, 0xff, 0x89, 0x99, 0x3d, 0x1d, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45,
    0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
];

// Finding 33: a material's alpha mode comes from its render properties, never from
// the alpha of its colour. `_Mode: 0` declares an opaque material: the alpha stays
// in the base-colour factor, and the material does not become blended because that
// value is less than one.
#[test]
fn an_opaque_material_stays_opaque_whatever_the_alpha_of_its_colour() {
    let projet = UnityProject::new("opaque");
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
        "a material declared opaque stays so"
    );
    assert_eq!(
        plein["pbrMetallicRoughness"]["baseColorFactor"][3],
        json!(0.5),
        "the colour's alpha remains the base colour factor"
    );
}

// Finding 34: URP and HDRP declare the render mode under `_SurfaceType` rather than
// `_Mode`. The driver reads both names as the same quantity: transparent gives
// `BLEND`, cut-out alone `MASK` with its `_AlphaCutoff` threshold, and a material
// that declares neither stays opaque.
#[test]
fn the_surface_type_of_an_hdrp_material_declares_its_alpha_mode() {
    let projet = UnityProject::new("surface-type");
    let (fondu, masque, plein) = (
        "000000000000000000000000000000d2",
        "000000000000000000000000000000d3",
        "000000000000000000000000000000d4",
    );
    projet.data(
        "Materials/Fondu.mat",
        fondu,
        &white_mat("Fondu", "    - _SurfaceType: 1\n"),
    );
    projet.data(
        "Materials/Masque.mat",
        masque,
        &white_mat(
            "Masque",
            "    - _SurfaceType: 0\n    - _AlphaCutoffEnable: 1\n    - _AlphaCutoff: 0.3\n",
        ),
    );
    projet.data(
        "Materials/Plein.mat",
        plein,
        &white_mat("Plein", "    - _Metallic: 0.5\n"),
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
        "neither `_Mode` nor `_SurfaceType`: the material is opaque"
    );
}

// Finding 51: the model a scene cites is read by the driver of its format, which
// also counts what it could not yield. That report belongs to the Unity scene: its
// codes rise there under their own name, and two models that miss the same thing add up.
#[test]
fn the_report_of_the_model_driver_reaches_the_unity_report() {
    let projet = UnityProject::new("rapport-modele");
    let obj = b"mtllib absente.mtl\nv 0 0 0\nv 1 0 0\nv 0 1 0\nusemtl Uni\nf 1 2 3\n";
    projet.model_bytes("Models/Triangle.obj", MODEL, obj, "");
    projet.scene(&instance_of(
        "Socle",
        &format!("{{fileID: 4300000, guid: {MODEL}, type: 3}}"),
    ));
    let (manifest, _) = projet.compile("unity-rapport-modele").prepared("unity");
    assert_eq!(
        manifest["unsupported"]["material-library-missing"],
        json!(1),
        "the model driver's report comes up as-is: {}",
        manifest["unsupported"]
    );
}

// Finding 52: a texture's `.meta` declares how to sample it — wrap of each axis and
// filtering. The glTF sampler carries them: a texture clamped on one axis and
// repeated on the other keeps both modes, and nearest filtering is not smoothed.
#[test]
fn the_texture_importer_of_a_meta_gives_the_sampler_its_wrap_and_filter() {
    let projet = UnityProject::new("sampler");
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
        &white_mat_texture("Peinte", image),
    );
    projet.scene(&cube(100, "Boite", matiere));
    let (_, gltf) = projet.compile("unity-sampler").prepared("unity");
    let sampler = &gltf["samplers"][0];
    assert_eq!(
        sampler["wrapS"],
        json!(33071),
        "`wrapU: 1` clamps the S axis"
    );
    assert_eq!(
        sampler["wrapT"],
        json!(10497),
        "`wrapV: 0` repeats the T axis"
    );
    assert_eq!(
        sampler["magFilter"],
        json!(9728),
        "`filterMode: 0` samples nearest"
    );
    assert_eq!(sampler["minFilter"], json!(9984));
}

/// A white `.mat` whose base colour carries the texture of this GUID.
fn white_mat_texture(name: &str, image: &str) -> String {
    let body = white_mat(name, "");
    body.replace(
        "m_TexEnvs: []",
        &format!("m_TexEnvs:\n    - _MainTex:\n        m_Texture: {{fileID: 2800000, guid: {image}, type: 3}}\n        m_Scale: {{x: 1, y: 1}}\n        m_Offset: {{x: 0, y: 0}}"),
    )
}
