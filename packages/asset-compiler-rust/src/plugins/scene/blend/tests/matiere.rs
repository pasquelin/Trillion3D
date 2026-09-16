//! Quel nuanceur le pilote lit dans un graphe de matériau, et ce que vaut une émission texturée.
use super::*;
use sortie::{close, factors, material};

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

// Comportement : quand une image alimente la couleur d'émission, c'est elle qui porte la couleur et
// l'intensité qui la multiplie ; la valeur déclarée de l'entrée, que Blender ignore alors, ne doit
// pas éteindre l'émission.
#[test]
fn a_textured_emission_is_scaled_by_its_strength_not_by_the_replaced_colour() {
    let mut bytes = surgery::fixture();
    {
        let file = BlendFile::open(&bytes, MAX_BYTES).expect("la fixture");
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
