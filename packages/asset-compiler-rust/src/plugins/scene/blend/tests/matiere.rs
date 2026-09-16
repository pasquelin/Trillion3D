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
