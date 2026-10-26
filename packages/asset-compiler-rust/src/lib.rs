//! Native exact-cluster compiler. Rendering, UI and platform IPC do not belong here.
pub(crate) mod card_representation;
pub mod coplanar;
mod dag;
pub(crate) mod displace;
pub(crate) mod distance_field;
mod manifest_binary;
#[cfg(any(test, feature = "oracle"))]
pub mod oracle;
pub mod physics_cook;
pub mod plugins;
pub mod proxy;
pub mod shared_math;
mod simplify;
pub mod texture;
pub mod volumetric_lightmap;
mod voxel;
use rayon::prelude::*;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
pub use shared_math::abi::*;
use std::{
    collections::{BTreeMap, BTreeSet},
    fmt::Display,
    fs::{self, File},
    io::{BufWriter, Read, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Instant,
};
use trillion3d_page_codec::encode;
pub const COMPILER_VERSION: &str = env!("CARGO_PKG_VERSION");
/// Per-cluster DAG identity: the group error is the simplifier's own — positions, normals and every
/// texture set at their quadric weights — never below the children's, so the error grows
/// monotonically up the DAG and a cut stays consistent, projected through the group bounding
/// sphere. v1 measured positions only, v2 published the quadric error alone at our weights, v3
/// raised it to the measured Hausdorff distance and removed parts; their caches are refused, never
/// reinterpreted.
pub const DAG_ERROR_MODEL: &str = "dag-group-qem-v4";
pub const DAG_CLUSTER_STRATEGY: &str = "dag-groups";
/// The most bytes of one streaming page — the unit a runtime reads, installs, keeps and drops, one
/// geometry pool slot (`compiler/pages/bundles.rs`) —, resident in the pool once installed, and of
/// one file of the scene index's cells.
pub const STREAM_BUNDLE_BYTES: usize = 128 * 1024;
pub const STRUCTURE_VERSION: u32 = 1;
/// The root of the manifest, of fixed size: its pages lie beside it (`compiler/pages/manifest.rs`).
pub const MANIFEST_FILE: &str = "clusters.json";
/// Code of a job stopped on a cancel request: what the batch counts and the event reports.
pub const CANCELLED: &str = "CANCELLED";
/// The file that names a directory's product — a source, a converted scene, a published scope:
/// one name for every writer and reader.
pub const MANIFEST_POINTER: &str = "manifest.json";
#[derive(Clone)]
pub struct Options {
    pub source: PathBuf,
    pub cache: PathBuf,
    pub resource_base: String,
    pub scope: String,
    pub triangle_budget: usize,
    pub threads: usize,
    pub ram_budget_mb: usize,
    pub simplification: String,
    /// Texture block families (`--textures-format`), the stored one first, the stored one alone by
    /// default.
    pub texture_formats: Vec<texture::BlockFormat>,
    /// The HLOD layers and the rules assigning objects to them (`hlod`, `Hlod::read`): none when
    /// the job names none; `Err` with the job's refusal when they do not read.
    pub hlod: std::result::Result<Hlod, String>,
    /// The temporal anti-aliasing settings — the scene's level, the responsive match and the
    /// settings by material name (`temporalAntialiasing`, `responsive`, `materials`,
    /// `MaterialOptions::read`): none when the job names none;
    /// `Err` with the job's refusal when they do not read.
    pub materials: std::result::Result<MaterialOptions, String>,
    /// The voxelized objects (`voxelize`, `VoxelizeOptions::read`): none when the job names none;
    /// `Err` with the job's refusal when they do not read.
    pub voxelize: std::result::Result<VoxelizeOptions, String>,
    /// The partition's main grid (`partitionGrid`, `PartitionGrid::read`): the reference's when
    /// the job names none; `Err` with the job's refusal when it does not read.
    pub partition_grid: std::result::Result<PartitionGrid, String>,
    /// The mesh build settings — the scene's and the rules by object (`meshBuild`,
    /// `MeshBuildOptions::read`): none when the job names none; `Err` with the job's refusal when
    /// they do not read.
    pub mesh_build: std::result::Result<MeshBuildOptions, String>,
    /// Each object's settings — the scene's and the rules by object: whether it streams, whether
    /// a skinned one is an instanced skinned object (`objectSettings`, `ObjectSettings::read`):
    /// none when the job names none; `Err` with the job's refusal when they do not read.
    pub object_settings: std::result::Result<ObjectSettings, String>,
    /// The volumetric lightmap's bake (`lightmapBake`, `LightmapBakeOptions::read`): none when the
    /// job names none; `Err` with the job's refusal when it does not read.
    pub lightmap_bake: std::result::Result<LightmapBakeOptions, String>,
    pub cancelled: Arc<AtomicBool>,
}
fn check(o: &Options) -> Result<()> {
    plugins::scene::cancel::check(&o.cancelled)
}
/// The compiler's content key: the hash of every source its products depend on (`build.rs`), the same
/// for two builds of the same sources, whatever their dates. A host keys its caches by it.
pub fn implementation_hash() -> &'static str {
    include_str!(concat!(env!("OUT_DIR"), "/implementation_hash.txt"))
}
pub mod compiler;
pub(crate) mod geometry_page;
pub(crate) mod hlod;
pub mod support;
#[cfg(test)]
mod tests;
pub(crate) mod trace;
use compiler::accessor::create::*;
use compiler::accessor::types::*;
pub use compiler::args::{
    job_options, machine_threads, parse_compiler_args, positive, Hlod, HlodBuilder, HlodLayer,
    HlodLodSelection, JobDefaults, LightmapBakeOptions, MaterialOptions, MeshBuildOptions,
    ObjectSettings, PartitionGrid, VoxelizeOptions, ID_FIELD,
};
pub use compiler::build::compile;
use compiler::build::progress::with_ratio;
use compiler::cache::digest::*;
use compiler::cache::lock::CacheLock;
use compiler::cache::prune::*;
pub use compiler::cache::publish::scope_pointer;
use compiler::cache::publish::{publish, Publication};
use compiler::cache::storage::*;
pub use compiler::error::{CompilerError, Result};
use compiler::lights::stage_scene_lights;
use compiler::materials::textures::*;
use compiler::materials::*;
use compiler::pages::containers::write_geometry_files;
use compiler::pages::dependencies::*;
use compiler::pages::manifest::write_mesh_pages;
use compiler::plan::*;
use compiler::primitive::dag::*;
use compiler::primitive::pages::*;
use compiler::primitive::*;
use compiler::source::buffers::*;
use compiler::source::copy::*;
use compiler::source::instancing::expand_gpu_instances;
use compiler::source::load::*;
use compiler::source::mapped::*;
use compiler::source::safe_path::*;
use compiler::source::scene::*;
use compiler::source::*;
use compiler::tables::stage_scene_tables;
use compiler::validate::*;
use hlod::chain::stage_world_roots;
use physics_cook::stage_physics;
use plugins::scene::{PreparedScene, RoutedSource};
