//! The distance field settings of a mesh's build (`meshBuild`, `MeshDistanceFieldSettingsWire`):
//! whether the field is built, its resolution scale, whether it is built as two-sided, the voxel
//! density and the most voxels along an axis (`distance_field::DistanceFieldSettings`). Each source
//! names them as it names the others (`mesh_build.rs`); the reference's default where none does.
use crate::compiler::args::reader::Reader;
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
    /// The settings `read` holds: the scale a finite number of at least 0, the density a finite
    /// number, the resolution a whole number of at least 1, the others booleans.
    pub(super) fn of(read: &Reader<'_>) -> Result<Self> {
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
            density: read.number(
                DISTANCE_FIELD_DENSITY_SETTING,
                DISTANCE_FIELD_DENSITY_RANGE,
                "a finite number",
            )?,
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

impl super::MeshBuildOptions {
    /// The distance field settings of the meshes an HLOD layer builds: the job's own `meshBuild`
    /// ones, the default where it names none — whether a field is built, how dense, how fine at
    /// most, and whether every triangle counts two-sided —, but for the resolution scale, which is
    /// a source mesh's own and the built mesh's default (1) whatever the job names.
    pub(crate) fn hlod_distance_field(&self) -> DistanceFieldSettings {
        DistanceFieldSettings {
            scale: DistanceFieldSettings::default().scale,
            ..self.rules.scene.distance_field.resolved()
        }
    }
}

#[cfg(test)]
mod tests {
    use crate::distance_field::DistanceFieldSettings;
    use crate::MeshBuildOptions;
    use serde_json::{json, Value};

    /// The density a job's `meshBuild` gives the one mesh of a scene.
    fn density(job: Value) -> Result<f64, String> {
        let g = json!({"nodes": [{"name": "Wall", "mesh": 0}], "meshes": [{}]});
        let built = MeshBuildOptions::read(Some(&job))?
            .meshes(&g)
            .map_err(|e| e.message)?;
        Ok(built[0].distance_field.density)
    }

    #[test]
    fn the_field_of_an_hlod_actor_keeps_the_jobs_switches_but_the_default_scale() {
        let job = json!({
            "distanceFieldScale": 0.25, "distanceFieldDensity": 0.3,
            "distanceFieldTwoSided": true, "distanceFieldMaxResolution": 128,
        });
        let read = |job: Value| MeshBuildOptions::read(Some(&job)).expect("reads");
        let field = read(job).hlod_distance_field();
        assert_eq!(field.scale, DistanceFieldSettings::default().scale);
        assert_eq!(
            (field.density, field.max_resolution, field.as_if_two_sided),
            (0.3, 128, true)
        );
        let off = read(json!({"distanceField": false})).hlod_distance_field();
        assert!(!off.generate);
    }

    #[test]
    fn a_distance_field_density_is_any_finite_number() {
        for value in [0.01, 0.2, 0.5, 3.0] {
            assert_eq!(density(json!({"distanceFieldDensity": value})), Ok(value));
        }
        let refusal = density(json!({"distanceFieldDensity": "dense"})).expect_err("a word");
        assert!(refusal.contains("distanceFieldDensity"), "{refusal}");
    }
}
