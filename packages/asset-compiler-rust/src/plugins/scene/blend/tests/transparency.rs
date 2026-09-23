//! Where the transparency of a Blender material comes from: the shader's `Alpha` input, the
//! image that carries it, and the mode the file declares.
use super::*;
use output::{close, factors, material};

// Behaviour: alpha linked on the alpha channel of the image the base colour already holds
// passes as-is — glTF only reads opacity there. The factor is then one, or it would cancel the
// image, and the declared value of the input does not take over.
#[test]
fn an_alpha_on_the_base_colour_image_carries_the_transparency() {
    let (gltf, _) = output::compiled(&surgery::fixture(), "alpha-image");
    let material = material(&gltf, "Transparent");
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

// Behaviour: an alpha taken from another channel of the same image, or from an image the base
// colour does not hold, does not fit in glTF without recomposing bytes. Each is counted by its
// name and the declared value of the input takes over, exact.
#[test]
fn an_alpha_from_another_channel_or_another_image_falls_back_to_the_factor() {
    let mut channel = surgery::fixture();
    let mut elsewhere = surgery::fixture();
    {
        let file = BlendFile::open(&channel, MAX_BYTES).expect("the fixture");
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
        let (gltf, manifest) = output::compiled(&bytes, "alpha-repli");
        let material = material(&gltf, "Transparent");
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

// Behaviour: a file older than Blender 4.2 declares its own transparency mode, and its SDNA does
// not yet describe surface rendering. The cut-off mode becomes a glTF mask, with the threshold
// the file carries.
#[test]
fn an_older_file_takes_its_alpha_mode_from_its_own_blend_method() {
    let mut bytes = surgery::without_field("surface_render_method");
    {
        let file = BlendFile::open(&bytes, MAX_BYTES).expect("the fixture");
        let material = surgery::named(&file, "MATransparent");
        let method = surgery::field(&file, material, &["blend_method"]);
        let threshold = surgery::field(&file, material, &["alpha_threshold"]);
        surgery::put(&mut bytes, method, &[3]);
        surgery::put(&mut bytes, threshold, &0.25f32.to_le_bytes());
    }
    let (gltf, _) = output::compiled(&bytes, "decoupe");
    let material = material(&gltf, "Transparent");
    assert_eq!(material["alphaMode"], json!("MASK"), "{material}");
    assert!(
        (material["alphaCutoff"].as_f64().expect("threshold") - 0.25).abs() < 1e-6,
        "{material}"
    );
}
