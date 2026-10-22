//! A translucent source seen through, as both bakes read one by default (`translucency`,
//! `HlodTranslucency::SeenThrough`), on the GPU: the capture along each view's ray
//! (`gpu/capture.wgsl`'s `view_pixel`), the merged atlas behind each texel of a translucent part
//! (`gpu/tile.wgsl`'s `seen_behind`). A source is translucent when it transmits light
//! (`KHR_materials_transmission`) or draws alpha-blended (`translucent`).
//!
//! The engine draws such a surface as a layer over what lies behind it (sdk-browser
//! `blend/shader.ts`'s `blendFragment`, `blend/transmission/transmitWgsl.ts`'s `thinLayer`): its own
//! lit layer covers a share of the pixel (`gpu/shade.wgsl`'s `covers`) — its opacity where it draws
//! blended, times, where it transmits, the larger of the share it does not transmit, its metallic
//! and its roughness: a metal transmits nothing, a rough surface scatters —, and what lies behind
//! it shows through the rest. A baked texel is one opaque surface, so each of its channels — base
//! colour, roughness, metallic — holds that share of the surface's own value and the rest of the
//! value of what lies behind it; behind a translucent layer the next one composes the same way,
//! front to back, until an opaque surface, which covers all that is left, or `LAYERS` layers. Where
//! nothing opaque lies behind, the last layer met stands for it: a pane against the sky keeps its
//! own colour. The normal is the outermost surface's: the shape the eye meets first.
//!
//! Why this rule: from far, the eye sees the share of the pane's lit layer it covers and, through
//! the rest, what lies behind it; a texture holding both at the same shares keeps the tint a glass
//! tower has up close — neither the dark core behind the panes alone, nor the pale panes alone —,
//! and the capture and the merge bake it by this one rule, so no level differs from the next.
//! What the engine lays on the light passing through — the absorption colour, the base colour times
//! the transmission, and the Fresnel at both faces — tints light, which no material channel
//! holds: the baked surface is lit as an opaque one, its light its own.
use crate::trace::surface::material::Surface;

/// The most layers a texel composes, front to back: past them, the last stands for what lies
/// behind. The shaders read it from the prelude (`gpu/layout.rs`).
pub(crate) const LAYERS: usize = 8;

/// Whether `surface` is translucent: it transmits light, or draws alpha-blended.
pub(crate) fn translucent(surface: &Surface) -> bool {
    surface.blend || surface.transmission > 0.0
}
