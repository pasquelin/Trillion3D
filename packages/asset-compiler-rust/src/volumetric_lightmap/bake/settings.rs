//! What a bake is asked to do: the reference's settings of its volumetric lightmap and of the
//! path tracing that fills it, in the engine's unit, the metre. The defaults are the reference's
//! (`abi.rs`, written from `lightmapBakeAbi.ts`).
use super::abi::*;
use super::sampling::Vec3;

/// Samples along a brick's unique side; a padded brick is one wider. Written in the file's head.
pub const BRICK_SIZE: u32 = 4;

#[derive(Clone, Debug, PartialEq)]
pub struct BakeSettings {
    /// The size of a cell of the finest level, in metres (`detailCellSize`).
    pub detail_cell_size: f64,
    /// The multiple of `gi_samples` the volume's probes take (`qualityMultiplier`).
    pub quality_multiplier: u32,
    /// The paths a probe takes for a unit of quality (`giSamples`).
    pub gi_samples: u32,
    /// The levels of bricks (`maxRefinementLevels`).
    pub max_refinement_levels: u32,
    /// Whether the paths end in an irradiance cache (`irradianceCaching`).
    pub irradiance_caching: bool,
    /// The passes that build the cache (`irradianceCacheQuality`).
    pub irradiance_cache_quality: u32,
    /// The size of a cache cell, in metres (`irradianceCacheSpacing`).
    pub irradiance_cache_spacing: f64,
    /// How near a hit may be, in spacings, for the cache to be read (`irradianceCacheCornerRejection`).
    pub irradiance_cache_corner_rejection: f64,
    /// How far the box of the scene grows when no volume is named, in metres
    /// (`automaticVolumeExpand`).
    pub automatic_volume_expand: f64,
    /// The half-size past which the scene's box is cut to a cube around its centre, in metres
    /// (`automaticVolumeLimit`).
    pub automatic_volume_limit: f64,
    /// The boxes the volume covers: lower then upper corner, in metres; none, the scene's own
    /// (`volumes`).
    pub volumes: Vec<(Vec3, Vec3)>,
}

impl Default for BakeSettings {
    fn default() -> Self {
        Self {
            detail_cell_size: DEFAULT_DETAIL_CELL_SIZE,
            quality_multiplier: DEFAULT_QUALITY_MULTIPLIER,
            gi_samples: DEFAULT_GI_SAMPLES,
            max_refinement_levels: DEFAULT_MAX_REFINEMENT_LEVELS,
            irradiance_caching: DEFAULT_IRRADIANCE_CACHING,
            irradiance_cache_quality: DEFAULT_IRRADIANCE_CACHE_QUALITY,
            irradiance_cache_spacing: DEFAULT_IRRADIANCE_CACHE_SPACING,
            irradiance_cache_corner_rejection: DEFAULT_IRRADIANCE_CACHE_CORNER_REJECTION,
            automatic_volume_expand: DEFAULT_AUTOMATIC_VOLUME_EXPAND,
            automatic_volume_limit: DEFAULT_AUTOMATIC_VOLUME_LIMIT,
            volumes: Vec::new(),
        }
    }
}

impl BakeSettings {
    /// The passes of the bake: the paths of every probe, then the cache's building passes.
    pub fn total_passes(&self) -> u32 {
        self.gi_samples * self.quality_multiplier + self.building_passes()
    }

    /// The passes that build the irradiance cache, none without one.
    pub fn building_passes(&self) -> u32 {
        if self.irradiance_caching {
            self.irradiance_cache_quality
        } else {
            0
        }
    }
}
