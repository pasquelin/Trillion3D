//! How one mesh's distance field is built, every setting resolved (`meshBuild`: `distanceField`,
//! `distanceFieldScale`, `distanceFieldTwoSided`, `distanceFieldDensity`,
//! `distanceFieldMaxResolution`, read by `compiler::args::mesh_build`), each default the
//! reference's.
use super::abi::{
    DEFAULT_DISTANCE_FIELD, DEFAULT_DISTANCE_FIELD_DENSITY, DEFAULT_DISTANCE_FIELD_MAX_RESOLUTION,
    DEFAULT_DISTANCE_FIELD_SCALE, DEFAULT_DISTANCE_FIELD_TWO_SIDED,
};

/// One mesh's distance field settings.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct DistanceFieldSettings {
    /// Whether the field is built at all (`distanceField`).
    pub generate: bool,
    /// The mesh's resolution scale (`distanceFieldScale`); 0 builds none.
    pub scale: f64,
    /// Whether every triangle is built as two-sided (`distanceFieldTwoSided`).
    pub as_if_two_sided: bool,
    /// The voxels a unit of a mesh of scale 1 holds (`distanceFieldDensity`).
    pub density: f64,
    /// The most voxels along one axis (`distanceFieldMaxResolution`).
    pub max_resolution: u32,
}

impl Default for DistanceFieldSettings {
    fn default() -> Self {
        Self {
            generate: DEFAULT_DISTANCE_FIELD,
            scale: DEFAULT_DISTANCE_FIELD_SCALE,
            as_if_two_sided: DEFAULT_DISTANCE_FIELD_TWO_SIDED,
            density: DEFAULT_DISTANCE_FIELD_DENSITY,
            max_resolution: DEFAULT_DISTANCE_FIELD_MAX_RESOLUTION,
        }
    }
}

impl DistanceFieldSettings {
    /// Whether a field is built for the mesh: the switch on and a scale above 0.
    pub(crate) fn builds(&self) -> bool {
        self.generate && self.scale > 0.0
    }
}
