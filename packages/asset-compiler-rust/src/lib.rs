//! Native exact-cluster compiler. Rendering, UI and platform IPC do not belong here.
mod accessor_validation;
pub mod coplanar;
mod dag;
mod geometry_page;
pub mod import;
mod manifest_binary;
mod perf;
mod qem;
pub mod texture_preview;
mod topology;
use rayon::prelude::*;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    fmt::{Display, Formatter},
    fs::{self, File},
    io::{BufWriter, Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Instant,
};
mod compiler_format;
pub use compiler_format::{CLUSTERED_BLEND_FORMAT_VERSION, FORMAT_VERSION, SOURCE_FORMAT_VERSION};
pub const COMPILER_VERSION: &str = env!("CARGO_PKG_VERSION");
/// Per-cluster DAG identity: group QEM error projected through the group bounding sphere.
pub const DAG_ERROR_MODEL: &str = "dag-group-qem-v1";
pub const DAG_CLUSTER_STRATEGY: &str = "dag-groups";
/// Numbers per culling node: min[3], max[3], sphere[4], maxParentError, firstChild, childCount,
/// firstPage, pageCount. `maxParentError` is -1 when the subtree holds a cluster with no replacement.
pub const CULLING_STRIDE: usize = 15;
/// Target size of one streaming bundle. A bundle is a single request that carries dozens of
/// clusters of the same level that sit next to each other, so filling a cut costs hundreds of
/// requests instead of tens of thousands. Clusters stay individually addressable through their own
/// object and through their offset inside the bundle.
pub const STREAM_BUNDLE_BYTES: usize = 128 * 1024;
pub const STRUCTURE_VERSION: u32 = 1;
/// Target size of one bootstrap object. The root clusters of every primitive share these objects,
/// so the coarsest complete cover of a whole scene is a handful of large requests instead of one
/// small request per primitive — which is what the first image waits on.
pub const BOOTSTRAP_BUNDLE_BYTES: usize = 1024 * 1024;
/// Name of the binary sidecar beside `clusters.json`.
pub const MANIFEST_BINARY_FILE: &str = "clusters.bin";
#[derive(Debug)]
pub struct CompilerError {
    pub code: &'static str,
    pub message: String,
}
impl CompilerError {
    fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}
impl Display for CompilerError {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}
impl std::error::Error for CompilerError {}
impl From<std::io::Error> for CompilerError {
    fn from(value: std::io::Error) -> Self {
        Self::new("IO_ERROR", value.to_string())
    }
}
impl From<serde_json::Error> for CompilerError {
    fn from(value: serde_json::Error) -> Self {
        Self::new("INVALID_JSON", value.to_string())
    }
}
impl From<rayon::ThreadPoolBuildError> for CompilerError {
    fn from(value: rayon::ThreadPoolBuildError) -> Self {
        Self::new("THREAD_POOL_ERROR", value.to_string())
    }
}
pub type Result<T> = std::result::Result<T, CompilerError>;
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
    pub cancelled: Arc<AtomicBool>,
}
pub const CLUSTER_TRIANGLES: usize = 256;
fn check(o: &Options) -> Result<()> {
    if o.cancelled.load(Ordering::Relaxed) {
        return Err(CompilerError::new("CANCELLED", "Compilation cancelled"));
    }
    Ok(())
}
fn implementation_hash() -> &'static str {
    include_str!(concat!(env!("OUT_DIR"), "/implementation_hash.txt"))
}
/// Whole-job completion estimate attached to every progress event, so a host draws one bar without
/// knowing the phases: source import (FBX/OBJ) up to 0.30, glTF import 0.35, clustering 0.35–0.95
/// spread over the primitives announced by the `import` event, root bundles 0.95–0.99, prune 0.99, pointer 1.
fn with_ratio(progress: impl Fn(Value) + Sync) -> impl Fn(Value) + Sync {
    let state = std::sync::Mutex::new((0usize, 0usize));
    move |mut event: Value| {
        let frac = |e: &Value| {
            let total = e["total"].as_f64().unwrap_or(0.0);
            if total > 0.0 {
                (e["completed"].as_f64().unwrap_or(0.0) / total).clamp(0.0, 1.0)
            } else {
                0.0
            }
        };
        // Events come from several threads: counting and forwarding under one lock keeps ratios monotone.
        let mut guard = state.lock().unwrap();
        let ratio = match event["phase"].as_str() {
            Some("import-source") => match event["step"].as_str() {
                Some("parse") => {
                    let files = event["files"].as_f64().unwrap_or(1.0).max(1.0);
                    0.20 * ((event["index"].as_f64().unwrap_or(0.0) + frac(&event)) / files)
                }
                Some("meshes") => 0.20 + 0.08 * frac(&event),
                Some("write") => 0.29,
                _ => 0.30,
            },
            Some("import") => {
                guard.0 = event["primitives"].as_u64().unwrap_or(0) as usize;
                0.35
            }
            Some("primitive") => {
                guard.1 += 1;
                if guard.0 > 0 {
                    0.35 + 0.60 * (guard.1 as f64 / guard.0 as f64).min(1.0)
                } else {
                    0.35
                }
            }
            Some("bootstrap") => 0.95 + 0.02 * frac(&event),
            Some("coplanar") => 0.97 + 0.02 * frac(&event),
            Some("prune") => 0.99,
            Some("complete") => 1.0,
            _ => 0.0,
        };
        if let Some(object) = event.as_object_mut() {
            object.insert("ratio".into(), json!((ratio * 1000.0).round() / 1000.0));
        }
        progress(event);
    }
}
mod compiler_accessor_create;
mod compiler_accessor_decode;
mod compiler_accessor_types;
mod compiler_args;
mod compiler_autonomous;
mod compiler_buffers;
mod compiler_build;
mod compiler_bundles;
mod compiler_coplanar;
mod compiler_copy;
mod compiler_materials;
mod compiler_nodes;
mod compiler_plan;
mod compiler_primitive;
mod compiler_primitive_bundle;
mod compiler_primitive_dag;
mod compiler_prune;
mod compiler_runtime;
mod compiler_scene;
mod compiler_source;
mod compiler_storage;
mod compiler_types;
mod compiler_validate;
mod compiler_world;
#[cfg(test)]
mod tests;
use compiler_accessor_create::*;
use compiler_accessor_types::*;
pub use compiler_args::parse_compiler_args;
use compiler_buffers::*;
pub use compiler_build::compile;
use compiler_bundles::*;
use compiler_copy::*;
use compiler_materials::*;
use compiler_nodes::*;
use compiler_plan::*;
use compiler_primitive::*;
use compiler_primitive_bundle::*;
use compiler_primitive_dag::*;
use compiler_prune::*;
use compiler_runtime::*;
use compiler_scene::*;
use compiler_source::*;
use compiler_storage::*;
use compiler_types::*;
use compiler_validate::*;
