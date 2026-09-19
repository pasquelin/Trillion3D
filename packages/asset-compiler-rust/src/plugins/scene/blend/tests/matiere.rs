//! Which shader the driver reads in a material graph, and what a textured emission is worth.
use super::*;
use sortie::{close, factors, material};

// Behaviour: it is the active output node that designates the material's shader. A
// `Principled BSDF` that this output's `Surface` input does not reach does not describe the
// surface: it is counted by its name, and the material block's quantities stay, exact.
#[test]
fn a_principled_the_active_output_does_not_reach_is_counted_not_read() {
    let mut bytes = surgery::fixture();
    let volume = {
        let file = BlendFile::open(&bytes, MAX_BYTES).expect("the fixture");
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
    let (gltf, manifest) = sortie::compiled(&bytes, "surface");
    let material = material(&gltf, "Transparent");
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

// Behaviour: when an image feeds the emission colour, it is the image that carries the colour
// and the strength that multiplies it; the declared value of the input, which Blender then
// ignores, must not extinguish the emission.
#[test]
fn a_textured_emission_is_scaled_by_its_strength_not_by_the_replaced_colour() {
    let mut bytes = surgery::fixture();
    {
        let file = BlendFile::open(&bytes, MAX_BYTES).expect("the fixture");
        let base = surgery::socket(&file, "MAOpaque", "Principled BSDF", "inputs", "Base Color");
        let emission = surgery::socket(
            &file,
            "MAOpaque",
            "Principled BSDF",
            "inputs",
            "Emission Color",
        );
        let strength = surgery::socket(
            &file,
            "MAOpaque",
            "Principled BSDF",
            "inputs",
            "Emission Strength",
        );
        let at = surgery::link_field(&file, "MAOpaque", base, "tosock");
        surgery::put(&mut bytes, at, &emission.to_le_bytes());
        let at = surgery::declared_field(&file, strength, "value");
        surgery::put(&mut bytes, at, &0.5f32.to_le_bytes());
    }
    let (gltf, _) = sortie::compiled(&bytes, "emission");
    let material = material(&gltf, "Opaque");
    assert_eq!(material["emissiveTexture"]["index"], json!(0), "{material}");
    assert!(
        close(&factors(material, &["emissiveFactor"]), &[0.5, 0.5, 0.5]),
        "{material}"
    );
}
