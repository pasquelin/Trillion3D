//! ufbx conversion, shared by the scene drivers served by ufbx (FBX, OBJ). A ufbx
//! scene becomes a glTF 2.0 pair (`model.gltf` + `model.bin`) and its manifest in
//! the cache, which `compile` consumes exactly like a hand-written glTF. Textures
//! are referenced relative to the source folder (served under `resourceBaseUrl`)
//! or embedded as binary views when the file carries their bytes. Nothing is ever
//! written next to the source.
//!
//! This module is not a driver: it has neither a format name nor a version. The
//! driver that calls it gives its own, and those enter the cache key and the
//! manifest.
use crate::plugins::scene::{ScenePlugin, SceneRequest};
use crate::{atomic, hash, runtime_manifest, CompilerError, Result};
use serde_json::{json, Value};
use std::{
    collections::{BTreeMap, HashMap},
    fs,
    path::{Path, PathBuf},
    sync::atomic::{AtomicBool, Ordering},
};

const PROGRESS_INTERVAL_BYTES: u64 = 8 * 1024 * 1024;
fn import_error(error: &ufbx::Error) -> CompilerError {
    if error.type_ == ufbx::ErrorType::Cancelled {
        return CompilerError::new(crate::CANCELLED, "Import cancelled");
    }
    let code = match error.type_ {
        ufbx::ErrorType::UnsupportedVersion => "IMPORT_UNSUPPORTED_VERSION",
        ufbx::ErrorType::OutOfMemory | ufbx::ErrorType::MemoryLimit => "IMPORT_OUT_OF_MEMORY",
        ufbx::ErrorType::Io | ufbx::ErrorType::FileNotFound => "IMPORT_IO_ERROR",
        _ => "IMPORT_ERROR",
    };
    CompilerError::new(
        code,
        format!("{} {}", &*error.description, error.info())
            .trim()
            .to_string(),
    )
}

/// Values of a corner — position, normal, uv, colour, and on a deformed mesh the file's vertex:
/// thirteen words, zero when the attribute is missing. Two corners with the same bits are one vertex, whatever
/// index the file gives them. Hashing walks word by word: the key has neither a
/// length to hash nor bytes to walk.
const CORNER_VALUES: usize = 13;
const CORNER_POSITION: std::ops::Range<usize> = 0..3;
const CORNER_NORMAL: std::ops::Range<usize> = 3..6;
const CORNER_UV: std::ops::Range<usize> = 6..8;
const CORNER_COLOR: std::ops::Range<usize> = 8..12;
/// The file's own vertex, on a deformed mesh: its bones and shape offsets are the vertex's.
const CORNER_VERTEX: usize = 12;
#[derive(PartialEq, Eq)]
struct CornerKey([u32; CORNER_VALUES]);
impl std::hash::Hash for CornerKey {
    fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
        for word in self.0 {
            state.write_u32(word);
        }
    }
}
type CornerMap = crate::shared_math::WordMap<CornerKey, u32>;
/// Binary of an intermediate scene under construction, shared with scene drivers
/// that write their own glTF: one view per byte block, aligned to four.
#[derive(Default)]
pub(crate) struct Bin {
    pub(crate) bytes: Vec<u8>,
    pub(crate) views: Vec<Value>,
}
impl Bin {
    pub(crate) fn view(&mut self, data: &[u8], target: Option<u32>) -> usize {
        let pad = crate::shared_math::pad_to_4(self.bytes.len());
        self.bytes.extend(std::iter::repeat_n(0u8, pad));
        let offset = self.bytes.len();
        self.bytes.extend_from_slice(data);
        let mut view = json!({"buffer":0,"byteOffset":offset,"byteLength":data.len()});
        if let Some(t) = target {
            view["target"] = json!(t);
        }
        self.views.push(view);
        self.views.len() - 1
    }
}
pub(crate) fn f32_bytes(values: &[f32]) -> Vec<u8> {
    let mut out = Vec::with_capacity(values.len() * 4);
    for v in values {
        out.extend_from_slice(&v.to_le_bytes());
    }
    out
}

/// What a conversion could not deliver: named and counted reasons, never a silent
/// failure. Shared with scene drivers, whose manifests publish the same fields.
#[derive(Default)]
pub(crate) struct Report {
    pub(crate) unsupported: BTreeMap<String, usize>,
    pub(crate) notes: Vec<String>,
}
impl Report {
    pub(crate) fn add(&mut self, kind: &str) {
        self.add_count(kind, 1);
    }
    pub(crate) fn add_count(&mut self, kind: &str, count: usize) {
        if count > 0 {
            *self.unsupported.entry(kind.to_string()).or_insert(0) += count;
        }
    }
}

/// Absolute, lexically normalised path (no `.`/`..`), symlinks untouched so linked source folders keep working.
pub(crate) fn normalise(path: &Path) -> PathBuf {
    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()
            .map(|c| c.join(path))
            .unwrap_or_else(|_| path.to_path_buf())
    };
    let mut out = PathBuf::new();
    for component in absolute.components() {
        match component {
            std::path::Component::CurDir => {}
            std::path::Component::ParentDir => {
                out.pop();
            }
            other => out.push(other.as_os_str()),
        }
    }
    out
}
struct Importer<'a> {
    nodes: Vec<Value>,
    meshes: Vec<Value>,
    mesh_triangles: Vec<usize>,
    materials: Vec<Value>,
    accessors: Vec<Value>,
    images: Vec<Value>,
    samplers: Vec<Value>,
    textures: Vec<Value>,
    sampler_ids: HashMap<(u32, u32), usize>,
    lights: Vec<Value>,
    /// The skins and clips of the scene (`motion.rs`).
    skins: Vec<Value>,
    animations: Vec<Value>,
    bin: Bin,
    report: Report,
    triangles: usize,
    mesh_nodes: usize,
    files: Vec<Value>,
    /// Files opened besides the claimed inputs: they enter the cache key.
    externals: external::Externals,
    cancelled: &'a AtomicBool,
    progress: &'a (dyn Fn(Value) + Sync),
}

mod external;
pub(crate) mod light;
mod lighting;
mod materials;
pub(crate) mod mesh;
mod motion;
pub(crate) mod opacity;
mod primitive;
mod runner;
mod scene;
mod tables;
mod textures;
mod write;

pub(crate) use light::{attach_lights, cone_angles, light_extension, light_node, LightSource};
use lighting::*;
use materials::*;
use mesh::*;
use motion::*;
use opacity::*;
pub(crate) use primitive::{primitive, Vertices};
pub use runner::import_source;
pub(crate) use tables::{readable, SceneTables};
use textures::*;
pub(crate) use write::{write_scene, Tables};
