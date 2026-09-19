//! Diffuse albedo of a glTF material, in linear, shared by the proxy and the oracle.
//!
//! Both read the same material and must draw exactly the same colour from it: if
//! one counted metal and the other did not, the oracle comparison would measure
//! two material reads instead of light transport. Only a texture average separates
//! them — the proxy reads it in the preview the compiler already reduced, the
//! oracle remakes it on the source image — and the caller supplies it.
use serde_json::Value;
use std::collections::BTreeMap;

/// Diffuse albedo of each material, packed RGBA8 linear, in glTF order.
pub struct Palette {
    colours: Vec<u32>,
    default: u32,
}
impl Palette {
    /// Albedo of a primitive by its `material` field. A primitive with no material
    /// takes glTF's default opaque material, i.e. a diffuse white.
    pub fn of(&self, material: Option<&Value>) -> u32 {
        material
            .and_then(Value::as_u64)
            .and_then(|id| self.colours.get(id as usize).copied())
            .unwrap_or(self.default)
    }
}

/// A linear colour in four bytes. Alpha is always 255: neither transparency nor
/// emission travels here, and that is said in the report rather than guessed.
pub fn pack(colour: [f64; 3]) -> u32 {
    let byte = |value: f64| (value.clamp(0.0, 1.0) * 255.0).round() as u32;
    byte(colour[0]) | (byte(colour[1]) << 8) | (byte(colour[2]) << 16) | (255 << 24)
}

/// An sRGB byte brought back to linear, the same curve as the rest of the chain (P1).
///
/// Two other copies of this curve exist, and neither is this one: the table in
/// `texture_preview/curves.rs::srgb_table` computes it in `f32` — 214 of the 256
/// entries differ from rounded `f64`, so the table is not built from here — and
/// `deferredLightingShaders.ts` carries it on the engine side. Three precisions,
/// three locations, no sharing.
pub fn srgb_to_linear(byte: u8) -> f64 {
    let value = byte as f64 / 255.0;
    if value <= 0.04045 {
        value / 12.92
    } else {
        ((value + 0.055) / 1.055).powf(2.4)
    }
}

fn factor(material: &Value) -> [f64; 3] {
    material
        .pointer("/pbrMetallicRoughness/baseColorFactor")
        .and_then(Value::as_array)
        .map(|values| {
            let read = |axis: usize| values.get(axis).and_then(Value::as_f64).unwrap_or(1.0);
            [read(0), read(1), read(2)]
        })
        .unwrap_or([1.0, 1.0, 1.0])
}

/// A pure metal has no diffuse albedo: what it reflects is specular, and this
/// lot's diffuse bounce does not carry it. The diffuse share is therefore
/// `1 - metallic`, exactly like the shader.
fn diffuse_share(material: &Value) -> f64 {
    1.0 - material
        .pointer("/pbrMetallicRoughness/metallicFactor")
        .and_then(Value::as_f64)
        .unwrap_or(1.0)
        .clamp(0.0, 1.0)
}

/// Palette of a scene. `mean` returns the linear mean colour of a base-colour
/// texture, or nothing when it is unreadable; the material factor then stands
/// alone.
///
/// A texture is averaged only once: without this memory, a scene of thousands of
/// materials that share a few textures would pay the product of both sizes.
pub fn palette(g: &Value, mut mean: impl FnMut(u64) -> Option<[f64; 3]>) -> Palette {
    let mut known: BTreeMap<u64, Option<[f64; 3]>> = BTreeMap::new();
    let materials = g
        .get("materials")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or(&[]);
    let mut colours = Vec::with_capacity(materials.len());
    for material in materials {
        let base = factor(material);
        let share = diffuse_share(material);
        let tint = material
            .pointer("/pbrMetallicRoughness/baseColorTexture/index")
            .and_then(Value::as_u64)
            .and_then(|texture| *known.entry(texture).or_insert_with(|| mean(texture)))
            .unwrap_or([1.0, 1.0, 1.0]);
        colours.push(pack([
            base[0] * tint[0] * share,
            base[1] * tint[1] * share,
            base[2] * tint[2] * share,
        ]));
    }
    Palette {
        colours,
        default: pack([1.0, 1.0, 1.0]),
    }
}
