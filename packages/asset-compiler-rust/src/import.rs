//! Conversion ufbx, partagée par les pilotes de scène servis par ufbx (FBX, OBJ). Une scène ufbx
//! devient une paire glTF 2.0 (`model.gltf` + `model.bin`) et son manifeste dans le cache, que
//! `compile` consomme exactement comme un glTF écrit à la main. Les textures sont référencées
//! relativement au dossier source (servi sous `resourceBaseUrl`) ou embarquées en vues de binaire
//! quand le fichier en porte les octets. Rien n'est jamais écrit à côté de la source.
//!
//! Ce module n'est pas un pilote : il n'a ni nom ni version de format. Le pilote qui l'appelle donne
//! les siens, et ce sont eux qui entrent dans la clé du cache et dans le manifeste.
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
        return CompilerError::new("CANCELLED", "Import cancelled");
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

/// Multiplicative hash for the (position, normal, uv, colour) corner keys: SipHash dominated mesh conversion.
#[derive(Default, Clone, Copy)]
struct CornerHasher(u64);
impl std::hash::Hasher for CornerHasher {
    fn finish(&self) -> u64 {
        self.0
    }
    fn write(&mut self, bytes: &[u8]) {
        for b in bytes {
            self.0 = (self.0.rotate_left(5) ^ (*b as u64)).wrapping_mul(0x517cc1b727220a95);
        }
    }
    fn write_u32(&mut self, v: u32) {
        self.0 = (self.0.rotate_left(5) ^ (v as u64)).wrapping_mul(0x517cc1b727220a95);
    }
}
type CornerMap = HashMap<(u32, u32, u32, u32), u32, std::hash::BuildHasherDefault<CornerHasher>>;
/// Le binaire d'une scène intermédiaire en construction, partagé avec les pilotes de scène qui
/// écrivent leur propre glTF : une vue par bloc d'octets, alignée sur quatre.
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

/// Ce qu'une conversion n'a pas su rendre : des raisons nommées et comptées, jamais un échec
/// silencieux. Partagé avec les pilotes de scène, dont les manifestes publient les mêmes champs.
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
    bin: Bin,
    report: Report,
    triangles: usize,
    mesh_nodes: usize,
    files: Vec<Value>,
    /// Les fichiers ouverts en plus des entrées revendiquées : ils entrent dans la clé du cache.
    externals: external::Externals,
    cancelled: &'a AtomicBool,
    progress: &'a (dyn Fn(Value) + Sync),
}

mod external;
pub(crate) mod light;
mod lighting;
mod materials;
pub(crate) mod mesh;
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
use opacity::*;
pub(crate) use primitive::{primitive, Vertices};
pub use runner::import_source;
pub(crate) use tables::{readable, SceneTables};
use textures::*;
pub(crate) use write::{write_scene, Tables};
