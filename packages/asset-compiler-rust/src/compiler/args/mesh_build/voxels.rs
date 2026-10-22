//! The voxel settings of a mesh's build (`meshBuild`, `MeshVoxelSettingsWire`): how many rays a
//! voxel casts, the level from which every group is voxels, how far back a ray starts, whether the
//! rays run along the axes alone, whether a voxel keeps its normals' spread and its coverage as
//! opacity (`voxel::VoxelSampling`). Each source names them as it names the others
//! (`mesh_build.rs`): a rule's, the scene's, the mesh's own `extras`; the reference's default
//! where none does.
use super::read::Reader;
use crate::shared_math::abi::{
    VOXEL_BACK_UP_SETTING, VOXEL_LEVEL_SETTING, VOXEL_NDF_SETTING, VOXEL_OPACITY_SETTING,
    VOXEL_RAYS_SETTING, VOXEL_SEPARABLE_SETTING,
};
use crate::voxel::VoxelSampling;
use crate::Result;

/// The voxel settings one source names, each none where it names none.
#[derive(Clone, Copy, Debug, Default)]
pub(super) struct NamedVoxels {
    rays: Option<u32>,
    level: Option<i32>,
    back_up: Option<f64>,
    separable: Option<bool>,
    ndf: Option<bool>,
    opacity: Option<bool>,
}

impl NamedVoxels {
    /// The voxel settings `read` holds: `voxelRays` a whole number of at least 0, `voxelLevel` a
    /// whole number a 32-bit signed word holds, `voxelBackUp` a finite number, the others
    /// booleans.
    pub(super) fn of(read: &Reader<'_>) -> Result<Self> {
        let level = (i64::from(i32::MIN), i64::from(i32::MAX));
        let takes = format!("a whole number from {} to {}", level.0, level.1);
        let rays = read.whole(
            VOXEL_RAYS_SETTING,
            (0, i64::MAX),
            "a whole number of at least 0",
        )?;
        Ok(Self {
            // More rays than the most a voxel casts cast that many: no bound but a word's.
            rays: rays.map(|n| u32::try_from(n).unwrap_or(u32::MAX)),
            level: (read.whole(VOXEL_LEVEL_SETTING, level, &takes)?).map(|n| n as i32),
            back_up: read.number(
                VOXEL_BACK_UP_SETTING,
                (f64::MIN, f64::MAX),
                "a finite number",
            )?,
            separable: read.boolean(VOXEL_SEPARABLE_SETTING)?,
            ndf: read.boolean(VOXEL_NDF_SETTING)?,
            opacity: read.boolean(VOXEL_OPACITY_SETTING)?,
        })
    }

    /// These settings, each that names none taken from `lower`.
    pub(super) fn or(self, lower: Self) -> Self {
        Self {
            rays: self.rays.or(lower.rays),
            level: self.level.or(lower.level),
            back_up: self.back_up.or(lower.back_up),
            separable: self.separable.or(lower.separable),
            ndf: self.ndf.or(lower.ndf),
            opacity: self.opacity.or(lower.opacity),
        }
    }

    /// Every setting, the default where none was named.
    pub(super) fn resolved(self) -> VoxelSampling {
        let default = VoxelSampling::default();
        VoxelSampling {
            asked_rays: self.rays.unwrap_or(default.asked_rays),
            level: self.level.unwrap_or(default.level),
            back_up: self.back_up.unwrap_or(default.back_up),
            separable: self.separable.unwrap_or(default.separable),
            ndf: self.ndf.unwrap_or(default.ndf),
            opacity: self.opacity.unwrap_or(default.opacity),
        }
    }
}
