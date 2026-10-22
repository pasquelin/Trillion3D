//! How a voxelized mesh's voxels are sampled, as its build names it (`meshBuild`: `voxelRays`,
//! `voxelLevel`, `voxelBackUp`, `voxelSeparable`, `voxelNdf`, `voxelOpacity`, read by
//! `compiler::args::mesh_build`): each setting's default the reference's, and the readings of
//! them the steps of the voxel stage ask — how many rays a voxel casts, whether its coverage is
//! handed over to its neighbours, whether a voxel no ray hit is sampled again a level up, whether
//! a group is voxels whatever its triangles' error. A job naming none samples as the defaults do.
use crate::shared_math::abi::{
    DEFAULT_VOXEL_BACK_UP, DEFAULT_VOXEL_LEVEL, DEFAULT_VOXEL_NDF, DEFAULT_VOXEL_OPACITY,
    DEFAULT_VOXEL_RAYS, DEFAULT_VOXEL_SEPARABLE, MAX_VOXEL_RAYS, VOXEL_RAY_PACKET,
    VOXEL_REMEMBER_BELOW_RAYS,
};

/// One mesh's voxel settings, every one resolved.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct VoxelSettings {
    /// The rays asked for (`voxelRays`); `rays` is the count cast.
    pub asked_rays: u32,
    /// The DAG level from which every group is voxels, 0 for none (`voxelLevel`).
    pub level: i32,
    /// How far back a ray starts before its voxel, in voxel sides (`voxelBackUp`).
    pub back_up: f64,
    /// Whether the rays run along the voxel's axes alone (`voxelSeparable`).
    pub separable: bool,
    /// Whether a voxel keeps the spread of the normals its rays hit (`voxelNdf`).
    pub ndf: bool,
    /// Whether a voxel's record carries its coverage as its opacity (`voxelOpacity`).
    pub opacity: bool,
}

impl Default for VoxelSettings {
    fn default() -> Self {
        Self {
            asked_rays: DEFAULT_VOXEL_RAYS,
            level: DEFAULT_VOXEL_LEVEL,
            back_up: DEFAULT_VOXEL_BACK_UP,
            separable: DEFAULT_VOXEL_SEPARABLE,
            ndf: DEFAULT_VOXEL_NDF,
            opacity: DEFAULT_VOXEL_OPACITY,
        }
    }
}

impl VoxelSettings {
    /// The rays a voxel casts: those asked for, at most `MAX_VOXEL_RAYS`, a count past 1 rounded up
    /// to a whole packet of `VOXEL_RAY_PACKET`. 0 or 1 is one ray (`single`).
    pub(crate) fn rays(&self) -> usize {
        let rays = self.asked_rays.min(MAX_VOXEL_RAYS);
        let cast = match rays > 1 {
            true => rays.next_multiple_of(VOXEL_RAY_PACKET),
            false => rays,
        };
        cast as usize
    }

    /// Whether a voxel casts one ray alone: covered whole or not at all.
    pub(crate) fn single(&self) -> bool {
        self.rays() <= 1
    }

    /// Whether the coverage of the voxels dropped is handed over to their neighbours: with rays
    /// enough to measure it, and no opacity to keep it in.
    pub(crate) fn redistributes(&self) -> bool {
        !self.single() && !self.opacity
    }

    /// Whether a voxel no ray hit is sampled again a level up: only where too few rays were cast
    /// to tell that it holds nothing.
    pub(crate) fn remembers_empty(&self) -> bool {
        self.rays() < VOXEL_REMEMBER_BELOW_RAYS as usize
    }

    /// The part of a ray's run, in voxel sides from its start, where a hit counts: all of it past
    /// the back-up stretch — a hit there is no part of the voxel —, or a separable voxel's depth.
    pub(crate) fn window(&self) -> (f64, f64) {
        match self.separable {
            true => (1.0, 2.0),
            false => (self.back_up, f64::INFINITY),
        }
    }

    /// How many cells away from a voxel's own a triangle can still be met by its rays: a ray
    /// starts `back_up` sides before the cube, a separable one up to a side and a half from the
    /// centre and as far laterally. A voxel casting one ray, or the defaults' rays, reaches none.
    pub(crate) fn reach(&self) -> i32 {
        match (self.single(), self.separable) {
            (true, _) => 0,
            (false, true) => 2,
            (false, false) => self.back_up.max(0.0).ceil() as i32,
        }
    }

    /// Whether the groups of DAG level `level` are voxels whatever their triangles' error: from
    /// `voxelLevel` up, when it names one — a level below 0 acts as the first.
    pub(crate) fn forces(&self, level: usize) -> bool {
        self.level != 0 && i64::from(self.level) <= level as i64
    }
}
