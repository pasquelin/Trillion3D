//! Transparency of a Blender material, as glTF carries it: a factor, a mode, and sometimes a
//! cut-off threshold.
//!
//! Nothing here looks at the object type or the scene name. The factor comes from the shader's
//! `Alpha` input; the image that carries it only passes if it is the alpha channel of the image
//! the base colour already holds, because glTF only reads opacity there. Another image, another
//! channel or a computation cannot be reduced to that without recomposing bytes: they are counted
//! by their name, and the declared value takes over, exact.
//!
//! The mode depends on the age of the file. Until Blender 4.1, the material declared its blend
//! method, cut-off included, and glTF takes it as-is. Since 4.2, the field that describes surface
//! rendering replaces that declaration: there is no cut-off any more, and alpha alone says
//! whether the surface blends. It is the file's SDNA that says which of the two cases applies,
//! never a version number written here.
use super::*;

/// The image channel glTF reads as opacity: the alpha of the base-colour texture.
const ALPHA_CHANNEL: &str = "Alpha";
/// The field by which Blender 4.2 and later describe their surface rendering.
const RENDER_METHOD: &str = "surface_render_method";
/// Blend methods an older file declares itself.
const SOLID: i64 = 0;
const CLIP: i64 = 3;
/// Opacity taken from an image the base colour does not hold, or from a computation.
const ALPHA_TEXTURE: &str = "blend-alpha-texture-unsupported";
/// Opacity taken from a channel of that image that glTF does not read at this place.
const TEXTURE_CHANNEL: &str = "blend-texture-channel-unsupported";

/// What the `Alpha` input gave: the factor that enters `baseColorFactor`, and whether an image's
/// alpha still modulates it.
pub(super) struct Alpha {
    pub(super) factor: f32,
    textured: bool,
}

/// The shader's opacity, knowing the base-colour input and the texture it gave. A linked input
/// wins over the written value: when the alpha of the base-colour texture carries the opacity,
/// the factor is one and lets the image through.
pub(super) fn of(
    node: &At<'_>,
    tree: &shading::Tree<'_>,
    base: Option<&At<'_>>,
    coloured: bool,
    out: &mut Out,
) -> Alpha {
    let Some(socket) = shading::socket(node, "Alpha") else {
        return Alpha {
            factor: 1.0,
            textured: false,
        };
    };
    let declared = Alpha {
        factor: shading::value(&socket, 1.0)[0],
        textured: false,
    };
    let Some(link) = tree.link(&socket) else {
        return declared;
    };
    let same = base
        .and_then(|socket| tree.link(socket))
        .is_some_and(|colour| colour.node.old == link.node.old);
    if !same || !coloured {
        out.report.add(ALPHA_TEXTURE);
        return declared;
    }
    if link.socket != ALPHA_CHANNEL {
        out.report.add(TEXTURE_CHANNEL);
        return declared;
    }
    Alpha {
        factor: 1.0,
        textured: true,
    }
}

/// The material's transparency mode, written in glTF when it is not opaque.
pub(super) fn mode(material: &At<'_>, alpha: &Alpha, gltf: &mut Value) {
    if material.has(RENDER_METHOD) {
        if alpha.textured || alpha.factor < 1.0 {
            gltf["alphaMode"] = json!("BLEND");
        }
        return;
    }
    match material.int("blend_method", SOLID) {
        SOLID => {}
        CLIP => {
            gltf["alphaMode"] = json!("MASK");
            gltf["alphaCutoff"] = json!(material.float("alpha_threshold", 0.5));
        }
        _ => gltf["alphaMode"] = json!("BLEND"),
    }
}
