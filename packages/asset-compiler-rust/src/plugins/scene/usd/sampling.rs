//! What a `UsdUVTexture` declares around its file: wrap of each of its two axes, the `scale` and
//! `bias` it applies to the bytes read, and the colour space in which it reads them.
//!
//! glTF carries none of that on the texture: wrap goes to the sampler, scale to the material
//! factor when it folds into it, and what does not fit is counted by name. Nothing is re-encoded
//! here — a driver that recomputed bytes would invent the image.
use super::*;

/// The three glTF wrap modes: repeat, clamp, mirror.
const REPEAT: u32 = 10497;
const CLAMP: u32 = 33071;
const MIRROR: u32 = 33648;

/// The two colour spaces a `UsdUVTexture` names plainly; `auto` lets the file say.
const RAW: &str = "raw";
const SRGB: &str = "sRGB";

/// Sampler of this texture: one mode per axis, never a single one for both — a format that
/// clamps one axis and repeats the other would fold its image if they were mixed up.
pub(super) fn sampler(world: &mut World<'_>, shader: &usd::Prim) -> usize {
    let across = wrap(world, shader, "inputs:wrapS");
    let along = wrap(world, shader, "inputs:wrapT");
    world.scene.sampler_uv(across, along)
}

/// Wrap mode of one axis. `black` borders the image with transparent and `useMetadata` lets the
/// file decide: glTF has neither, the texture repeats and the count says so.
fn wrap(world: &mut World<'_>, shader: &usd::Prim, axis: &str) -> u32 {
    let mode = read::first(&shader.attribute(axis))
        .and_then(|(value, _)| read::text(&value))
        .unwrap_or_default();
    match mode.as_str() {
        "clamp" => CLAMP,
        "mirror" => MIRROR,
        "" | "repeat" => REPEAT,
        _ => {
            world.refuse(world::TEXTURE_WRAP);
            REPEAT
        }
    }
}

/// Unique factor that `scale` and `bias` fold into, or `None` when they do not fit. glTF
/// multiplies its texture by a factor and adds nothing: so `bias` must be zero and `scale` equal
/// on the three colour channels, the fourth — alpha — remaining one.
pub(super) fn scale(shader: &usd::Prim) -> Option<f64> {
    let scale = channels(shader, "inputs:scale", 1.0);
    let bias = channels(shader, "inputs:bias", 0.0);
    let uniform = scale[..3].windows(2).all(|pair| pair[0] == pair[1]);
    (uniform && bias == [0.0; 4] && scale[3] == 1.0).then_some(scale[0])
}

/// Four channels of an input the specification writes as `float4`: a single value applies to the
/// three colour channels, and any channel the layer does not write takes the neutral value.
fn channels(shader: &usd::Prim, name: &str, neutral: f64) -> [f64; 4] {
    let written = read::first(&shader.attribute(name))
        .and_then(|(value, _)| read::components(&value))
        .unwrap_or_default();
    match written.as_slice() {
        [] => [neutral; 4],
        [one] => [*one, *one, *one, neutral],
        parts => std::array::from_fn(|axis| parts.get(axis).copied().unwrap_or(neutral)),
    }
}

/// Declared colour space, compared to the role of the input that reads the texture: a colour
/// read as linear lightens the surface, a datum read as a colour curves it. The driver does not
/// re-encode the bytes; it counts the mismatch.
pub(super) fn colour_space(world: &mut World<'_>, shader: &usd::Prim, colour: bool) {
    let declared = read::first(&shader.attribute("inputs:sourceColorSpace"))
        .and_then(|(value, _)| read::text(&value));
    let contrary = match declared.as_deref() {
        Some(RAW) => colour,
        Some(SRGB) => !colour,
        _ => false,
    };
    if contrary {
        world.refuse(world::TEXTURE_COLOUR_SPACE);
    }
}
