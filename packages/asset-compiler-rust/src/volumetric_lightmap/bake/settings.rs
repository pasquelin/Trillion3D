//! What a bake is asked to do: the reference's settings of its volumetric lightmap and of the
//! path tracing that fills it, in the engine's unit, the metre. The defaults are the reference's
//! (`abi.rs`, written from `lightmapBakeAbi.ts`).
use super::abi::*;
use super::sampling::Vec3;

/// Samples along a brick's unique side; a padded brick is one wider. Written in the file's head.
pub const BRICK_SIZE: u32 = 4;

/// The sky light a bake shines (`skyLight`): a flat sky, as a compile job holds no captured one — a
/// cube of one over the horizon and `lower_hemisphere_color` under it, times the colour and the
/// intensity. The bake treats it as every one of its lights: a stationary light, whose direct
/// light the engine draws itself.
#[derive(Clone, Debug, PartialEq)]
pub struct SkySettings {
    pub intensity: f64,
    /// The light's linear colour.
    pub color: Vec3,
    /// The cube's colour under the horizon.
    pub lower_hemisphere_color: Vec3,
    /// Whether the scene's geometry shadows the sky, which fills the layer of the sky's bent
    /// normal.
    pub casts_shadows: bool,
}

impl Default for SkySettings {
    fn default() -> Self {
        Self {
            intensity: DEFAULT_SKY_LIGHT_INTENSITY,
            color: DEFAULT_SKY_LIGHT_COLOR,
            lower_hemisphere_color: DEFAULT_SKY_LIGHT_LOWER_HEMISPHERE_COLOR,
            casts_shadows: DEFAULT_SKY_LIGHT_CAST_SHADOWS,
        }
    }
}

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
    /// The memory the finest bricks may take where the volume is one piece, in megabytes
    /// (`maximumBrickMemory`).
    pub maximum_brick_memory: f64,
    /// How much the spherical harmonics of a sample are smoothed where they ring, 0 none to 1
    /// strong (`sphericalHarmonicSmoothing`).
    pub spherical_harmonic_smoothing: f64,
    /// The size of a cell of the grid the finest bricks stream by, in metres; 0 keeps the volume
    /// in one piece (`loadingCellSize`).
    pub loading_cell_size: f64,
    /// The error under which a finest brick is dropped for the brick over it (`minBrickError`).
    pub min_brick_error: f64,
    /// The boxes the volume covers: lower then upper corner, in metres; none, the scene's own
    /// (`volumes`).
    pub volumes: Vec<(Vec3, Vec3)>,
    /// The sky light the bake shines; none, no sky and no bent normal layer (`skyLight`).
    pub sky_light: Option<SkySettings>,
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
            maximum_brick_memory: DEFAULT_MAXIMUM_BRICK_MEMORY,
            spherical_harmonic_smoothing: DEFAULT_SPHERICAL_HARMONIC_SMOOTHING,
            loading_cell_size: DEFAULT_LOADING_CELL_SIZE,
            min_brick_error: DEFAULT_MIN_BRICK_ERROR,
            volumes: Vec::new(),
            sky_light: None,
        }
    }
}

impl BakeSettings {
    /// The passes of the bake: the paths of every probe, then the cache's building passes.
    pub fn total_passes(&self) -> u32 {
        self.gi_samples * self.quality_multiplier + self.building_passes()
    }

    /// The side of a cell of the finest bricks' grid in finest bricks, none where the volume is one
    /// piece or has a single level (its only bricks are the finest, which the base must hold).
    pub fn cell_texels(&self) -> Option<u32> {
        let brick = f64::from(BRICK_SIZE) * self.detail_cell_size;
        (self.loading_cell_size > 0.0 && self.max_refinement_levels > 1)
            .then(|| ((self.loading_cell_size / brick).round() as u32).max(1))
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
