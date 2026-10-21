//! How an `approximate`, `merge` or `simplify` layer's atlas bakes a translucent source — one that transmits
//! light (`KHR_materials_transmission`) or one drawn alpha-blended —: the layer's `translucency`,
//! one of `HLOD_TRANSLUCENCIES` (`compilerAbi.ts`), read by `translucency` alone. The layer's JSON
//! is the cache's identity (`Hlod::named`): a value named changes the key, one left out keeps it.
use super::fields::{default_rank, level};
use super::*;

/// How a translucent source shows in a flattened material's images (`translucency`,
/// `HLOD_TRANSLUCENCIES` order), carried with the maps it shows in (`bake::Maps`).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum HlodTranslucency {
    /// Its surface alone (`'surfaceOnly'`, what `false` names): the approximation's views never
    /// draw it, so what lies behind it shows, and a merged atlas bakes its own colour.
    SurfaceOnly,
    /// As it is seen through (`'seenThrough'`, the default, what `true` names): each channel the
    /// share its own layer covers of its value, the rest the value of what lies behind it, front to
    /// back to the first opaque surface, the normal the outermost's (`bake::seen`).
    SeenThrough,
}

impl HlodTranslucency {
    const ALL: [Self; 2] = [Self::SurfaceOnly, Self::SeenThrough];
}

impl Default for HlodTranslucency {
    /// The one `DEFAULT_HLOD_TRANSLUCENCY` names.
    fn default() -> Self {
        Self::ALL[default_rank(&HLOD_TRANSLUCENCIES, DEFAULT_HLOD_TRANSLUCENCY)]
    }
}

/// The translucency layer `map` names, `what` naming it (`level`): a word of
/// `HLOD_TRANSLUCENCIES`, `true` the default (`DEFAULT_HLOD_TRANSLUCENCY`), `false` the first,
/// `surfaceOnly`; the default when absent or null; refused otherwise, naming the values.
pub(super) fn translucency(map: &Map<String, Value>, what: &str) -> Result<HlodTranslucency> {
    let levels = (&HLOD_TRANSLUCENCIES[..], DEFAULT_HLOD_TRANSLUCENCY);
    Ok(HlodTranslucency::ALL[level(map, "translucency", what, levels)?])
}
