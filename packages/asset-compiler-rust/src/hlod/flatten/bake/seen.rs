//! A translucent source seen through, as both bakes read one by default (`translucency`,
//! `HlodTranslucency::SeenThrough`): the capture along each view's ray (`gpu/capture.wgsl`'s
//! `view_pixel`), the merged atlas behind each texel of a translucent part (`merge/tile.rs`). A
//! source is translucent when it transmits light (`KHR_materials_transmission`) or draws
//! alpha-blended (`translucent`).
//!
//! The engine draws such a surface as a layer over what lies behind it (sdk-browser
//! `blend/shader.ts`'s `blendFragment`, `blend/transmission/transmitWgsl.ts`'s `thinLayer`): its own
//! lit layer covers a share of the pixel (`covers`) — its opacity where it draws blended, times,
//! where it transmits, the larger of the share it does not transmit, its metallic and its roughness:
//! a metal transmits nothing, a rough surface scatters —, and what lies behind it shows through the
//! rest. A baked texel is one opaque surface, so each of its channels — base colour, roughness,
//! metallic — holds that share of the surface's own value and the rest of the value of what lies
//! behind it; behind a translucent layer the next one composes the same way, front to back, until
//! an opaque surface, which covers all that is left, or `LAYERS` layers (`Layers`). Where nothing
//! opaque lies behind, the last layer met stands for it: a pane against the sky keeps its own
//! colour. The normal is the outermost surface's: the shape the eye meets first.
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
/// behind (`Layers`). The capture reads it from the prelude (`gpu/layout.rs`).
pub(crate) const LAYERS: usize = 8;

/// Whether `surface` is translucent: it transmits light, or draws alpha-blended.
pub(crate) fn translucent(surface: &Surface) -> bool {
    surface.blend || surface.transmission > 0.0
}

/// The share of a texel `surface` covers with its own layer, the rest showing what lies behind it,
/// `alpha` the base colour's alpha there (factor, texture and vertex colour) and `[roughness,
/// metallic]` its own: all of it for a surface neither blended nor transmitting; else its opacity
/// where it draws blended, times, where it transmits, the larger of the share it does not
/// transmit, its metallic and its roughness — the engine's thin layer (`thinLayer`). The capture
/// reads a source alike (`gpu/shade.wgsl`'s `covers`).
pub(crate) fn covers(surface: &Surface, alpha: f64, [roughness, metallic]: [f64; 2]) -> f64 {
    let opacity = if surface.blend {
        alpha.clamp(0.0, 1.0)
    } else {
        1.0
    };
    if surface.transmission <= 0.0 {
        return opacity;
    }
    let lit = (1.0 - surface.transmission).max(metallic).max(roughness);
    opacity * lit.clamp(0.0, 1.0)
}

/// One layer a texel meets: its linear base colour, its roughness and metallic, and the share of
/// what is left it covers (`covers`).
#[derive(Clone, Copy, Debug)]
pub(crate) struct Layer {
    pub colour: [f64; 3],
    pub rough_metal: [f64; 2],
    pub covers: f64,
}

/// The layers a texel meets composed front to back (module doc): each channel summed at the share
/// each layer covers of what the layers before it left, the last layer standing for what lies
/// behind where nothing opaque does.
pub(crate) struct Layers {
    colour: [f64; 3],
    rough_metal: [f64; 2],
    left: f64,
    met: usize,
    last: Option<Layer>,
}

impl Default for Layers {
    /// No layer met yet: all of the texel left.
    fn default() -> Self {
        Self {
            colour: [0.0; 3],
            rough_metal: [0.0; 2],
            left: 1.0,
            met: 0,
            last: None,
        }
    }
}

impl Layers {
    /// `layer` laid behind those met; whether what lies behind it still shows and another layer
    /// may be met (`LAYERS`).
    pub(crate) fn add(&mut self, layer: Layer) -> bool {
        let share = self.left * layer.covers;
        for c in 0..3 {
            self.colour[c] += layer.colour[c] * share;
        }
        for k in 0..2 {
            self.rough_metal[k] += layer.rough_metal[k] * share;
        }
        self.left -= share;
        self.met += 1;
        self.last = Some(layer);
        self.left > 0.0 && self.met < LAYERS
    }

    /// The composed base colour and roughness and metallic: what the layers left taken by the last
    /// one met.
    pub(crate) fn value(&self) -> ([f64; 3], [f64; 2]) {
        let Some(last) = self.last else {
            return (self.colour, self.rough_metal);
        };
        let left = self.left;
        (
            std::array::from_fn(|c| self.colour[c] + last.colour[c] * left),
            std::array::from_fn(|k| self.rough_metal[k] + last.rough_metal[k] * left),
        )
    }
}
