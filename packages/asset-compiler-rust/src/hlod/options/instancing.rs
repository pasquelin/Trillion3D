//! An instanced layer's size filter: which objects its cells take by the size of their world box —
//! its largest half extent, its surface or its volume against a least value, metres —, none
//! filtered by default. An object the filter turns away enters no HLOD: it streams in its cell and
//! draws while that cell is loaded, nothing standing for it beyond (`partition`).
use super::fields::{chosen, named, ranged};
use super::*;
use crate::compiler::validate::OPTIONS;

/// What an instanced layer's objects must reach to enter it (`sizeFilter`, `HLOD_SIZE_FILTERS`
/// order), the least value its setting names, 0 by default.
#[derive(Clone, Copy, PartialEq, Debug, Default)]
pub enum HlodSizeFilter {
    /// Every object (`'none'`, the default).
    #[default]
    None,
    /// The box's largest half extent, metres (`'extent'`, `minExtent`).
    Extent(f64),
    /// The box's surface, square metres (`'area'`, `minArea`).
    Area(f64),
    /// The box's volume, cubic metres (`'volume'`, `minVolume`).
    Volume(f64),
}

/// The words `sizeFilter` takes, in `HlodSizeFilter`'s order, and the setting each reads.
pub const HLOD_SIZE_FILTERS: [&str; 4] = ["none", "extent", "area", "volume"];
const SIZE_SETTINGS: [&str; 3] = ["minExtent", "minArea", "minVolume"];

impl HlodSizeFilter {
    /// Whether an object whose world box is `low` to `high` passes it.
    pub fn admits(self, (low, high): ([f64; 3], [f64; 3])) -> bool {
        let half = [0, 1, 2].map(|k| (high[k] - low[k]) * 0.5);
        match self {
            Self::None => true,
            Self::Extent(least) => half[0].max(half[1]).max(half[2]) >= least,
            Self::Area(least) => {
                8.0 * (half[0] * half[1] + half[0] * half[2] + half[1] * half[2]) >= least
            }
            Self::Volume(least) => 8.0 * half[0] * half[1] * half[2] >= least,
        }
    }
}

/// The size filter of instanced layer `map` (`what` naming it): its kind and the one least value
/// that kind reads, any other refused.
pub(super) fn size_filter(map: &Map<String, Value>, what: &str) -> Result<HlodSizeFilter> {
    let kind = chosen(map, "sizeFilter", what, &HLOD_SIZE_FILTERS)?.unwrap_or(0);
    for (rank, &key) in SIZE_SETTINGS.iter().enumerate() {
        if rank + 1 != kind && named(map, key) {
            let word = HLOD_SIZE_FILTERS[kind];
            return Err(OPTIONS.bad(format!("{what}: {key} is no setting of a {word} filter")));
        }
    }
    let least =
        |key: &str| -> Result<f64> { Ok(ranged(map, key, what, (0.0, f64::MAX))?.unwrap_or(0.0)) };
    Ok(match kind {
        0 => HlodSizeFilter::None,
        1 => HlodSizeFilter::Extent(least(SIZE_SETTINGS[0])?),
        2 => HlodSizeFilter::Area(least(SIZE_SETTINGS[1])?),
        _ => HlodSizeFilter::Volume(least(SIZE_SETTINGS[2])?),
    })
}
