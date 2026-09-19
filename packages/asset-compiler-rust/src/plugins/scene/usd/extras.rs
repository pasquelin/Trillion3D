//! What a `UsdPreviewSurface` declares outside `pbrMetallicRoughness`: occlusion, which glTF
//! puts in its own map, and inputs for which base glTF has no slot.
//!
//! An input written at its default value changes nothing on the surface: it is not a mismatch
//! and does not enter the report. It is the mismatch that counts, never the presence of the
//! attribute.
use super::*;

/// Implicit index of refraction of a `UsdPreviewSurface`, and its implicit normal: the one that
/// leaves the surface as its geometry gives it.
const DEFAULT_IOR: f64 = 1.5;
const DEFAULT_NORMAL: [f64; 3] = [0.0, 0.0, 1.0];
/// Channel where glTF reads occlusion from its map.
const OCCLUSION_CHANNEL: &str = "outputs:r";

/// Textured occlusion. glTF reads it in the red channel of its own map; another channel of the
/// same image would give an occlusion read elsewhere than written, and the map stays carried as-is.
pub(super) fn occlusion(world: &mut World<'_>, shader: &usd::Prim, out: &mut Value) {
    let Some(target) = material::connection(shader, "inputs:occlusion") else {
        return;
    };
    let Some(bound) = texture::resolve(world, &target, false) else {
        return;
    };
    if !target
        .split_property()
        .is_some_and(|(_, name)| name == OCCLUSION_CHANNEL)
    {
        world.refuse(world::TEXTURE_CHANNEL);
    }
    out["occlusionTexture"] = bound.plain(world);
}

/// What this surface node departs from its default and that base glTF does not carry: the
/// specular workflow, clearcoat, index of refraction, a written rather than textured normal.
/// Nothing is approximated by another input; each is counted by name.
pub(super) fn counted(world: &mut World<'_>, shader: &usd::Prim) {
    if specular(shader) {
        world.refuse(world::SPECULAR_WORKFLOW);
    }
    if material::scalar(shader, "clearcoat").is_some_and(|coat| coat > 0.0) {
        world.refuse(world::CLEARCOAT);
    }
    if material::scalar(shader, "ior").is_some_and(|ior| ior != DEFAULT_IOR) {
        world.refuse(world::IOR);
    }
    if written_normal(shader) {
        world.refuse(world::NORMAL_VALUE);
    }
}

/// Is this surface described by its specular workflow? `useSpecularWorkflow` asks for it, and a
/// written specular colour says so too: neither folds into glTF metal and roughness without
/// reinventing the surface.
fn specular(shader: &usd::Prim) -> bool {
    let asked = material::scalar(shader, "useSpecularWorkflow").is_some_and(|flow| flow != 0.0);
    asked || material::value(shader, "specularColor").is_some()
}

/// A hand-written normal, off its default and with no texture to carry it: glTF has no
/// per-material constant normal.
fn written_normal(shader: &usd::Prim) -> bool {
    if material::connection(shader, "inputs:normal").is_some() {
        return false;
    }
    material::value(shader, "normal")
        .as_ref()
        .and_then(read::triple)
        .is_some_and(|normal| normal != DEFAULT_NORMAL)
}

/// Emission: the connected map wins over the written colour, which glTF would multiply by it,
/// and the written colour travels only when it actually lights.
pub(super) fn emissive(world: &mut World<'_>, shader: &usd::Prim, out: &mut Value) {
    let colour = match material::connected_texture(world, shader, "emissiveColor", true) {
        Some(bound) => {
            let factor = bound.factor(world);
            out["emissiveTexture"] = bound.value;
            Some([factor; 3])
        }
        None => material::value(shader, "emissiveColor")
            .as_ref()
            .and_then(read::triple)
            .filter(|colour| colour.iter().any(|channel| *channel > 0.0)),
    };
    if let Some(colour) = colour {
        out["emissiveFactor"] = json!(colour);
    }
}
