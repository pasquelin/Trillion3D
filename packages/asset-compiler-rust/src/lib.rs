//! Native exact-cluster compiler. Rendering, UI and platform IPC do not belong here.
mod accessor_validation;
pub mod albedo;
pub mod coplanar;
pub mod cutout;
mod dag;
mod eac_modifiers;
mod geometry_page_deform;
mod geometry_page_quant;
mod gltf_codes;
pub mod import;
mod join;
pub mod json;
mod le;
mod manifest_binary;
#[cfg(any(test, feature = "oracle"))]
pub mod oracle;
mod perf;
pub mod physics_cook;
pub mod plugins;
pub mod proxy;
mod qem;
pub mod shared_math;
mod surface_trace;
pub mod texture_preview;
mod uri;
mod voxel;
use rayon::prelude::*;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
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
mod compiler_format;
mod compiler_identity;
pub use shared_math::abi::*;
pub const COMPILER_VERSION: &str = env!("CARGO_PKG_VERSION");
/// Per-cluster DAG identity: the group error is the simplifier's own — positions, normals and every
/// texture set at their quadric weights — never below the children's, so the error grows
/// monotonically up the DAG and a cut stays consistent, projected through the group bounding
/// sphere. v1 measured positions only, v2 published the quadric error alone at our weights, v3
/// raised it to the measured Hausdorff distance and removed parts; their caches are refused, never
/// reinterpreted.
pub const DAG_ERROR_MODEL: &str = "dag-group-qem-v4";
pub const DAG_CLUSTER_STRATEGY: &str = "dag-groups";
/// Target size of one streaming bundle: a cell of the scene index, a bundle of the world DAG.
pub const STREAM_BUNDLE_BYTES: usize = 128 * 1024;
pub const STRUCTURE_VERSION: u32 = 1;
/// The root of the manifest, of fixed size: its pages lie beside it (`compiler_manifest_pages.rs`).
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
    pub texture_formats: Vec<texture_preview::BlockFormat>,
    /// The HLOD layers and the rules assigning objects to them (`hlod`, `Hlod::read`): none when
    /// the job names none; `Err` with the job's refusal when they do not read.
    pub hlod: std::result::Result<Hlod, String>,
    /// The temporal anti-aliasing settings — the scene's level, the responsive match and the
    /// settings by material name (`temporalAntialiasing`, `responsive`, `materials`,
    /// `MaterialOptions::read`): none when the job names none;
    /// `Err` with the job's refusal when they do not read.
    pub materials: std::result::Result<MaterialOptions, String>,
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
mod compiler_accessor_create;
mod compiler_accessor_decode;
mod compiler_accessor_types;
mod compiler_args;
pub mod compiler_budget;
mod compiler_buffers;
mod compiler_build;
mod compiler_bundle_dependencies;
mod compiler_coplanar;
mod compiler_copy;
mod compiler_digest;
mod compiler_error;
mod compiler_geometry_files;
mod compiler_instancing;
mod compiler_lights;
mod compiler_lock;
mod compiler_manifest_pages;
mod compiler_materials;
mod compiler_mesh_share;
mod compiler_nodes;
mod compiler_page_bundles;
mod compiler_page_record;
mod compiler_plan;
mod compiler_primitive;
mod compiler_primitive_checks;
mod compiler_primitive_dag;
mod compiler_primitive_pages;
mod compiler_primitive_stalls;
mod compiler_primitive_warn;
mod compiler_prune;
mod compiler_prune_textures;
mod compiler_publish;
mod compiler_ratio;
mod compiler_reuse;
mod compiler_reuse_proof;
mod compiler_runtime;
mod compiler_safe_path;
mod compiler_scene;
mod compiler_select;
mod compiler_source;
mod compiler_storage;
mod compiler_tables;
mod compiler_textures;
mod compiler_types;
mod compiler_validate;
mod compiler_world;
mod compiler_world_roots;
#[cfg(test)]
mod shared_math_tests;
#[cfg(test)]
mod tests;
use compiler_accessor_create::*;
use compiler_accessor_types::*;
pub use compiler_args::{
    job_options, machine_threads, parse_compiler_args, positive, Hlod, HlodBuilder, HlodLayer,
    HlodLodSelection, JobDefaults, MaterialOptions, ID_FIELD,
};
use compiler_buffers::*;
pub use compiler_build::compile;
use compiler_bundle_dependencies::*;
use compiler_copy::*;
use compiler_digest::*;
pub use compiler_error::{CompilerError, Result};
use compiler_geometry_files::write_geometry_files;
use compiler_instancing::expand_gpu_instances;
use compiler_lights::stage_scene_lights;
use compiler_lock::CacheLock;
use compiler_manifest_pages::write_mesh_pages;
use compiler_materials::*;
use compiler_plan::*;
use compiler_primitive::*;
use compiler_primitive_dag::*;
use compiler_primitive_pages::*;
use compiler_prune::*;
pub use compiler_publish::scope_pointer;
use compiler_publish::{publish, Publication};
use compiler_ratio::with_ratio;
use compiler_runtime::*;
use compiler_safe_path::*;
use compiler_scene::*;
use compiler_source::*;
use compiler_storage::*;
use compiler_tables::stage_scene_tables;
use compiler_textures::*;
use compiler_types::*;
use compiler_validate::*;
use compiler_world_roots::stage_world_roots;
use physics_cook::stage_physics;
use plugins::scene::{PreparedScene, RoutedSource};
