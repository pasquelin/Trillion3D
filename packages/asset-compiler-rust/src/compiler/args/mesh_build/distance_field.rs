//! The distance field settings of a mesh's build (`meshBuild`, `MeshDistanceFieldSettingsWire`):
//! whether the field is built, its resolution scale, whether it is built as two-sided, the voxel
//! density and the most voxels along an axis (`distance_field::DistanceFieldSettings`). Each source
//! names them as it names the others (`mesh_build.rs`); the reference's default where none does.
use super::read::Reader;
use crate::distance_field::abi::{
    DISTANCE_FIELD_DENSITY_RANGE, DISTANCE_FIELD_DENSITY_SETTING,
    DISTANCE_FIELD_MAX_RESOLUTION_SETTING, DISTANCE_FIELD_SCALE_SETTING, DISTANCE_FIELD_SETTING,
    DISTANCE_FIELD_TWO_SIDED_SETTING,
};
use crate::distance_field::DistanceFieldSettings;
use crate::Result;

/// The distance field settings one source names, each none where it names none.
#[derive(Clone, Copy, Debug, Default)]
pub(super) struct NamedDistanceField {
    generate: Option<bool>,
    scale: Option<f64>,
    as_if_two_sided: Option<bool>,
    density: Option<f64>,
    max_resolution: Option<u32>,
}

impl NamedDistanceField {
    /// The settings `read` holds: the scale a finite number of at least 0, the density within its
    /// range, the resolution a whole number of at least 1, the others booleans.
    pub(super) fn of(read: &Reader<'_>) -> Result<Self> {
        let density = DISTANCE_FIELD_DENSITY_RANGE;
        let takes = format!("a number from {} to {}", density.0, density.1);
        let resolution = read.whole(
            DISTANCE_FIELD_MAX_RESOLUTION_SETTING,
            (1, i64::MAX),
            "a whole number of at least 1",
        )?;
        Ok(Self {
            generate: read.boolean(DISTANCE_FIELD_SETTING)?,
            scale: read.number(
                DISTANCE_FIELD_SCALE_SETTING,
                (0.0, f64::MAX),
                "a finite number of at least 0",
            )?,
            as_if_two_sided: read.boolean(DISTANCE_FIELD_TWO_SIDED_SETTING)?,
            density: read.number(DISTANCE_FIELD_DENSITY_SETTING, density, &takes)?,
            max_resolution: resolution.map(|n| u32::try_from(n).unwrap_or(u32::MAX)),
        })
    }

    /// These settings, each that names none taken from `lower`.
    pub(super) fn or(self, lower: Self) -> Self {
        Self {
            generate: self.generate.or(lower.generate),
            scale: self.scale.or(lower.scale),
            as_if_two_sided: self.as_if_two_sided.or(lower.as_if_two_sided),
            density: self.density.or(lower.density),
            max_resolution: self.max_resolution.or(lower.max_resolution),
        }
    }

    /// Every setting, the default where none was named.
    pub(super) fn resolved(self) -> DistanceFieldSettings {
        let default = DistanceFieldSettings::default();
        DistanceFieldSettings {
            generate: self.generate.unwrap_or(default.generate),
            scale: self.scale.unwrap_or(default.scale),
            as_if_two_sided: self.as_if_two_sided.unwrap_or(default.as_if_two_sided),
            density: self.density.unwrap_or(default.density),
            max_resolution: self.max_resolution.unwrap_or(default.max_resolution),
        }
    }
}
