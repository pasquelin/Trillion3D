//! A masked material's alpha cut: the cutoff and `baseColorFactor` alpha under which it keeps a
//! texel (glTF 2.0), which the quality gate holds a block-compressed chain to and the compiler's own
//! tracer reads.

/// A masked material's cut: its `alphaCutoff`, then its `baseColorFactor` alpha.
pub(crate) type Cut = (f32, f32);

/// Whether a masked material keeps a texel of alpha `alpha` under its `cut`:
/// `alpha / 255 × factor >= cutoff` in `f32`.
pub(crate) fn keeps(alpha: u8, (cutoff, factor): Cut) -> bool {
    trillion3d_math::scalar::byte_to_unit_f32(alpha) * factor >= cutoff
}

/// A masked material's cut at `cutoff`, under its `baseColorFactor` alpha (1
/// when absent), clamped to [0, 1] as the engine's (`surfaceOpacity`).
pub(crate) fn material_cut(material: &serde_json::Value, cutoff: f32) -> Cut {
    let factor = crate::compiler::materials::MaterialFactors::of(material).base_colour[3] as f32;
    (cutoff, factor.clamp(0.0, 1.0))
}
