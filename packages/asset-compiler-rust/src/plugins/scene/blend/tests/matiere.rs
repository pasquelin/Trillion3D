//! Ce qu'un matériau Blender devient : quel nuanceur le pilote lit, d'où vient la transparence, et
//! ce que vaut une émission texturée.
use super::*;

/// Les facteurs d'un matériau glTF, lus en nombres pour être comparés à la tolérance d'un f32.
fn factors(material: &Value, path: &[&str]) -> Vec<f64> {
    let mut found = material;
    for step in path {
        found = &found[*step];
    }
    found
        .as_array()
        .unwrap_or_else(|| panic!("{path:?} n'est pas un tableau: {material}"))
        .iter()
        .map(|part| part.as_f64().expect("un nombre"))
        .collect()
}

fn close(found: &[f64], wanted: &[f64]) -> bool {
    found.len() == wanted.len()
        && found
            .iter()
            .zip(wanted)
            .all(|(one, other)| (one - other).abs() < 1e-6)
}

// Comportement : c'est le nœud de sortie actif qui désigne le nuanceur du matériau. Un
// `Principled BSDF` que l'entrée `Surface` de cette sortie n'atteint pas ne décrit pas la surface :
// il est compté par son nom, et les grandeurs du bloc de matériau restent, exactes.
#[test]
fn a_principled_the_active_output_does_not_reach_is_counted_not_read() {
    let mut bytes = surgery::fixture();
    let volume = {
        let file = BlendFile::open(&bytes, MAX_BYTES).expect("la fixture");
        let surface = surgery::socket(
            &file,
            "MATransparent",
            "Material Output",
            "inputs",
            "Surface",
        );
        let volume = surgery::socket(
            &file,
            "MATransparent",
            "Material Output",
            "inputs",
            "Volume",
        );
        let at = surgery::link_field(&file, "MATransparent", surface, "tosock");
        (at, volume)
    };
    surgery::put(&mut bytes, volume.0, &volume.1.to_le_bytes());
    let (gltf, manifest) = surgery::compiled(&bytes, "surface");
    let material = surgery::material(&gltf, "Transparent");
    assert!(
        close(
            &factors(material, &["pbrMetallicRoughness", "baseColorFactor"]),
            &[0.8, 0.8, 0.8, 1.0]
        ),
        "{material}"
    );
    assert_eq!(
        material["pbrMetallicRoughness"]["baseColorTexture"],
        json!(null)
    );
    assert_eq!(material["alphaMode"], json!(null), "{material}");
    assert_eq!(
        manifest["unsupported"]["blend-surface-node-unsupported"],
        json!(1),
        "{}",
        manifest["unsupported"]
    );
}

// Comportement : l'alpha branché sur le canal alpha de l'image que porte déjà la couleur de base
// passe tel quel — glTF ne lit l'opacité que là. Le facteur vaut alors un, sans quoi il annulerait
// l'image, et la valeur déclarée de l'entrée ne reprend pas la main.
#[test]
fn an_alpha_on_the_base_colour_image_carries_the_transparency() {
    let (gltf, _) = surgery::compiled(&surgery::fixture(), "alpha-image");
    let material = surgery::material(&gltf, "Transparent");
    assert!(
        close(
            &factors(material, &["pbrMetallicRoughness", "baseColorFactor"]),
            &[1.0, 1.0, 1.0, 1.0]
        ),
        "{material}"
    );
    assert_eq!(
        material["pbrMetallicRoughness"]["baseColorTexture"]["index"],
        json!(0)
    );
    assert_eq!(material["alphaMode"], json!("BLEND"));
}

// Comportement : un alpha pris sur un autre canal de la même image, ou sur une image que la couleur
// de base ne porte pas, ne se range pas dans le glTF sans recomposer des octets. Chacun est compté
// par son nom et la valeur déclarée de l'entrée reprend, exacte.
#[test]
fn an_alpha_from_another_channel_or_another_image_falls_back_to_the_factor() {
    let mut channel = surgery::fixture();
    let mut elsewhere = surgery::fixture();
    {
        let file = BlendFile::open(&channel, MAX_BYTES).expect("la fixture");
        let alpha = surgery::socket(&file, "MATransparent", "Principled BSDF", "inputs", "Alpha");
        let colour = surgery::socket(&file, "MATransparent", "Image Texture", "outputs", "Color");
        let at = surgery::link_field(&file, "MATransparent", alpha, "fromsock");
        surgery::put(&mut channel, at, &colour.to_le_bytes());
        let base = surgery::socket(
            &file,
            "MATransparent",
            "Principled BSDF",
            "inputs",
            "Base Color",
        );
        let metallic = surgery::socket(
            &file,
            "MATransparent",
            "Principled BSDF",
            "inputs",
            "Metallic",
        );
        let at = surgery::link_field(&file, "MATransparent", base, "tosock");
        surgery::put(&mut elsewhere, at, &metallic.to_le_bytes());
    }
    for (bytes, code) in [
        (channel, "blend-texture-channel-unsupported"),
        (elsewhere, "blend-alpha-texture-unsupported"),
    ] {
        let (gltf, manifest) = surgery::compiled(&bytes, "alpha-repli");
        let material = surgery::material(&gltf, "Transparent");
        let colour = factors(material, &["pbrMetallicRoughness", "baseColorFactor"]);
        assert!((colour[3] - 0.4).abs() < 1e-6, "{code}: {material}");
        assert_eq!(material["alphaMode"], json!("BLEND"), "{code}: {material}");
        assert_eq!(
            manifest["unsupported"][code],
            json!(1),
            "{code}: {}",
            manifest["unsupported"]
        );
    }
}

// Comportement : un fichier antérieur à Blender 4.2 déclare lui-même son mode de transparence, et
// son SDNA ne décrit pas encore le rendu de surface. Le mode découpe devient un masque glTF, avec
// le seuil que le fichier porte.
#[test]
fn an_older_file_takes_its_alpha_mode_from_its_own_blend_method() {
    let mut bytes = surgery::without_field("surface_render_method");
    {
        let file = BlendFile::open(&bytes, MAX_BYTES).expect("la fixture");
        let material = surgery::named(&file, "MATransparent");
        let method = surgery::field(&file, material, &["blend_method"]);
        let threshold = surgery::field(&file, material, &["alpha_threshold"]);
        surgery::put(&mut bytes, method, &[3]);
        surgery::put(&mut bytes, threshold, &0.25f32.to_le_bytes());
    }
    let (gltf, _) = surgery::compiled(&bytes, "decoupe");
    let material = surgery::material(&gltf, "Transparent");
    assert_eq!(material["alphaMode"], json!("MASK"), "{material}");
    assert!(
        (material["alphaCutoff"].as_f64().expect("seuil") - 0.25).abs() < 1e-6,
        "{material}"
    );
}
