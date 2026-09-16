//! Le canal d'où l'opacité d'un `UsdPreviewSurface` sort vraiment.
//!
//! glTF ne lit l'opacité d'une image que dans l'alpha de sa texture de couleur de base. Une
//! `opacity` branchée sur un autre canal de cette même image — le rouge, le vert, le bleu — ne s'y
//! range pas : la porter quand même donne une transparence lue ailleurs qu'écrite. Sur une image
//! RGBA d'un pixel `[0, 255, 0, 255]`, `outputs:r` vaut zéro — la face disparaît — et `outputs:a`
//! vaut un — elle reste pleine : deux scènes opposées, et le compilateur en rendait une seule.
use super::*;
use usd_matiere::{compile as compile_layer, layer, pbr, texture, unsupported};

/// La couche d'un quad dont la couleur de base vient de `T` et l'opacité du canal nommé de `T`.
fn carried_by(channel: &str) -> GoldenRun {
    let inputs = format!(
        "            color3f inputs:diffuseColor.connect = </Root/M/T.outputs:rgb>\n            float inputs:opacity.connect = </Root/M/T.{channel}>"
    );
    let tag = format!("opacite-canal-{}", &channel["outputs:".len()..]);
    compile_layer(
        &tag,
        &layer(&inputs, &texture("T", "checker.png", "")),
        &["checker.png"],
    )
}

// Comportement : seul l'alpha de la texture de couleur de base porte l'opacité jusqu'à glTF. Un
// autre canal de la même image était accepté comme s'il était l'alpha — même matériau, même mode de
// mélange, facteur un, rien de compté —, et la scène servie lisait l'alpha à la place du canal
// demandé. Il est maintenant compté par son nom, et le facteur écrit reprend la main.
#[test]
fn only_the_alpha_channel_of_the_base_colour_texture_carries_the_opacity() {
    let alpha = carried_by("outputs:a");
    let (_, gltf) = alpha.prepared("usd");
    assert_eq!(gltf["materials"][0]["alphaMode"], "BLEND");
    assert_eq!(pbr(&gltf)["baseColorFactor"], json!([1.0, 1.0, 1.0, 1.0]));
    assert_eq!(
        unsupported(&alpha)["usd-texture-channel-unsupported"],
        Value::Null
    );

    let red = carried_by("outputs:r");
    assert_eq!(
        unsupported(&red)["usd-texture-channel-unsupported"],
        1,
        "un canal que glTF ne lit pas doit être compté"
    );
    let (_, gltf) = red.prepared("usd");
    assert_eq!(
        gltf["materials"][0]["alphaMode"], "OPAQUE",
        "le repli est la valeur écrite, pas l'alpha de l'image"
    );
    assert_eq!(pbr(&gltf)["baseColorFactor"], json!([1.0, 1.0, 1.0, 1.0]));
    assert_eq!(
        pbr(&gltf)["baseColorTexture"]["index"],
        0,
        "la couleur de base reste portée par son image"
    );
}
