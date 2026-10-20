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
use crate::plugins::scene::Transparency;

/// The image channel glTF reads as opacity: the alpha of the base-colour texture.
const ALPHA_CHANNEL: &str = "Alpha";
/// The field by which Blender 4.2 and later describe their surface rendering.
const RENDER_METHOD: &str = "surface_render_method";
/// Blend methods an older file declares itself.
const SOLID: i64 = 0;
const CLIP: i64 = 3;
/// Opacity taken from an image the base colour does not hold, or from a computation.
const ALPHA_TEXTURE: &str = "blend-alpha-texture-unsupported";

/// The shader's opacity, knowing the base-colour input and the texture it gave. A linked input
/// wins over the written value: when the alpha of the base-colour texture carries the opacity,
/// the factor is one and lets the image through.
pub(super) fn of(
    node: &At<'_>,
    tree: &shading::Tree<'_>,
    base: Option<&At<'_>>,
    coloured: bool,
    out: &mut Out,
) -> Transparency {
    let Some(socket) = shading::socket(node, "Alpha") else {
        return Transparency {
            factor: 1.0,
            textured: false,
        };
    };
    // Widened from the file's f32: exact, and narrowed back exactly where it is written.
    let declared = Transparency {
        factor: f64::from(shading::value(&socket, 1.0)[0]),
        textured: false,
    };
    let Some(link) = tree.link(&socket) else {
        return declared;
    };
    let same = base
        .and_then(|socket| tree.link(socket))
        .is_some_and(|colour| colour.node.old == link.node.old);
    if !same || !coloured {
        out.scene.report.add(ALPHA_TEXTURE);
        return declared;
    }
    if link.socket != ALPHA_CHANNEL {
        out.scene
            .report
            .add(crate::plugins::scene::codes::TEXTURE_CHANNEL_UNSUPPORTED);
        return declared;
    }
    Transparency {
        factor: 1.0,
        textured: true,
    }
}

/// The material's transparency mode, written in glTF when it is not opaque.
pub(super) fn mode(material: &At<'_>, alpha: Transparency, gltf: &mut Value) {
    if material.has(RENDER_METHOD) {
        if alpha.blends() {
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
