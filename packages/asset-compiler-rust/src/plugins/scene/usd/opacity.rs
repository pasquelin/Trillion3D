//! Transparency of a `UsdPreviewSurface`, as glTF carries it: an alpha factor, a mode, and
//! sometimes a cutoff threshold.
//!
//! Nothing here looks at the object type or the scene name: cutoff comes from
//! `opacityThreshold`, blending from an opacity below one or from an image that carries it, and
//! that is all. glTF reads an image's opacity only in the alpha of `baseColorTexture`: an
//! `opacity` wired onto that texture passes through as-is; another image cannot be folded into
//! it without recomposing a third, which would invent bytes.
use super::*;

/// Channel where glTF reads an image's opacity: the alpha of the base-colour texture, and that
/// alone. Another channel of the same image does not fit there without recomposing bytes.
const ALPHA_CHANNEL: &str = "outputs:a";

/// What the surface opacity yielded: the factor that enters `baseColorFactor`, and whether an
/// image's alpha still modulates it.
#[derive(Clone, Copy)]
pub(super) struct Opacity {
    pub(super) factor: f64,
    textured: bool,
}

/// Surface opacity, given the `diffuseColor` connection and the already filled
/// `pbrMetallicRoughness`. A connected input wins over the written value: when the base-colour
/// texture's alpha carries the opacity, the factor is one and lets the image through.
pub(super) fn of(
    world: &mut World<'_>,
    shader: &usd::Prim,
    pbr: &Value,
    diffuse: Option<&sdf::Path>,
) -> Opacity {
    let factor = material::scalar(shader, "opacity").unwrap_or(1.0);
    let written = Opacity {
        factor,
        textured: false,
    };
    let Some(target) = material::connection(shader, "inputs:opacity") else {
        return written;
    };
    let carried = diffuse.map(sdf::Path::prim_path) == Some(target.prim_path())
        && pbr.get("baseColorTexture").is_some();
    if !carried {
        world.refuse(world::OPACITY_TEXTURE);
        return written;
    }
    // The image is the one glTF will carry; the channel remains, because glTF reads only one.
    // Another channel of this image would give a transparency read elsewhere than written: the
    // value is taken back.
    if !target
        .split_property()
        .is_some_and(|(_, name)| name == ALPHA_CHANNEL)
    {
        world.refuse(world::TEXTURE_CHANNEL);
        return written;
    }
    Opacity {
        factor: 1.0,
        textured: true,
    }
}

/// Transparency mode of this material.
pub(super) fn mode(shader: &usd::Prim, opacity: Opacity) -> &'static str {
    if cutoff(shader).is_some() {
        return "MASK";
    }
    match opacity.textured || opacity.factor < 1.0 {
        true => "BLEND",
        false => "OPAQUE",
    }
}

/// Cutoff threshold, when the surface declares one that actually cuts.
pub(super) fn cutoff(shader: &usd::Prim) -> Option<f64> {
    material::scalar(shader, "opacityThreshold").filter(|threshold| *threshold > 0.0)
}
