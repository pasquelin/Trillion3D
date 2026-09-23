//! The channel an `UsdPreviewSurface`'s opacity really comes from.
//!
//! glTF only reads an image's opacity in the alpha of its base-colour texture. An
//! `opacity` wired to another channel of that same image — red, green, blue —
//! does not fit there: carrying it anyway yields a transparency read elsewhere
//! than written. On a one-pixel RGBA image `[0, 255, 0, 255]`, `outputs:r` is
//! zero — the face vanishes — and `outputs:a` is one — it stays full: two
//! opposite scenes, and the compiler used to yield a single one.
use super::material::{compile as compile_layer, layer, pbr, texture, unsupported};
use super::*;

/// Layer of a quad whose base colour comes from `T` and opacity from `T`'s named channel.
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

// Behaviour: only the alpha of the base-colour texture carries opacity through
// to glTF. Another channel of the same image used to be accepted as if it were
// alpha — same material, same blend mode, factor one, nothing counted — and the
// served scene read alpha in place of the requested channel. It is now counted
// by name, and the written factor takes over.
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
        "a channel glTF does not read must be counted"
    );
    let (_, gltf) = red.prepared("usd");
    assert_eq!(
        gltf["materials"][0]["alphaMode"], "OPAQUE",
        "the fallback is the written value, not the image alpha"
    );
    assert_eq!(pbr(&gltf)["baseColorFactor"], json!([1.0, 1.0, 1.0, 1.0]));
    assert_eq!(
        pbr(&gltf)["baseColorTexture"]["index"],
        0,
        "the base colour stays carried by its image"
    );
}
