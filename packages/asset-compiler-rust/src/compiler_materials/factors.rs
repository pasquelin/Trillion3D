//! How a material draws, as glTF declares it: its alpha mode and its PBR factors, each read once.
use super::*;
use crate::compiler_validate::number_or;

/// How a material's alpha draws, as glTF names it: a mode glTF does not name draws opaque, and a
/// `MASK` that declares no cutoff cuts at glTF's own half (`CUTOUT_ALPHA`). The one reading of
/// `alphaMode` and `alphaCutoff`: the material table, the coverage test, the cutout decisions and
/// the blended pass all judge by it.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) enum AlphaMode {
    Opaque,
    Mask(f64),
    Blend,
}
impl AlphaMode {
    pub(crate) fn of(material: &Value) -> Self {
        match material.get("alphaMode").and_then(Value::as_str) {
            Some("MASK") => Self::Mask(number_or(
                material.get("alphaCutoff"),
                crate::cutout::CUTOUT_ALPHA,
            )),
            Some("BLEND") => Self::Blend,
            _ => Self::Opaque,
        }
    }
    /// The glTF name the engine record carries.
    pub(crate) fn name(self) -> &'static str {
        match self {
            Self::Opaque => "OPAQUE",
            Self::Mask(_) => "MASK",
            Self::Blend => "BLEND",
        }
    }
}
/// The `pbrMetallicRoughness` factors of a material, each at glTF's default of one when silent:
/// the base colour (linear RGBA), the metalness and the roughness, unclamped as declared; and
/// its `KHR_materials_transmission` factor, zero when silent.
pub(crate) struct MaterialFactors {
    pub(crate) base_colour: [f64; 4],
    pub(crate) metallic: f64,
    pub(crate) roughness: f64,
    pub(crate) transmission: f64,
}
impl MaterialFactors {
    pub(crate) fn of(material: &Value) -> Self {
        let pbr = material.get("pbrMetallicRoughness");
        let of = |name: &str| pbr.and_then(|p| p.get(name));
        let colour = of("baseColorFactor").and_then(Value::as_array);
        Self {
            base_colour: [0, 1, 2, 3].map(|c| number_or(colour.and_then(|f| f.get(c)), 1.0)),
            metallic: number_or(of("metallicFactor"), 1.0),
            roughness: number_or(of("roughnessFactor"), 1.0),
            transmission: number_or(
                material.pointer("/extensions/KHR_materials_transmission/transmissionFactor"),
                0.0,
            ),
        }
    }
}
