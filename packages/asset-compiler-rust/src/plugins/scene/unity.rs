//! Unity scene driver: an exported project as-is becomes a glTF intermediate scene.
//!
//! **Legal condition, written here as in the journal.** This driver reads only *data*: the YAML
//! serialisation Unity documents for `.unity`, `.prefab`, `.mat` and `.meta`. No C# script, no
//! assembly, no library, no SDK and no editor shader is read, executed, reused or
//! redistributed; nothing is decrypted or circumvented. The YAML reader is `yaml-rust2` (MIT OR
//! Apache-2.0), version pinned in `Cargo.toml`. Meshes come from the project's model files,
//! read by their own driver — never by this one. The licence of imported content remains that
//! of its author: this driver grants none and withdraws none.
//!
//! What it reads: the `Transform` hierarchy, `MeshFilter` and `MeshRenderer`, prefab instances
//! and their geometry and render overrides, `LODGroup` (finest level only), Standard, URP Lit
//! and HDRP Lit materials, textures the image registry can decode, and a model's import
//! settings declared by its `.meta` — scale factor and `fileID` → name table, which says which
//! mesh of a model a `MeshFilter` names.
//! What it counts in the report without yielding: lights, cameras, terrains, particles,
//! scripts, animated renderers, inactive objects, discarded LOD levels, prefab overrides that
//! change neither geometry nor rendering, packed metal/smoothness maps and textures outside
//! the registry.
use super::*;
use crate::import::{f32_bytes, normalise, SceneTables as Scene};
use crate::{hash, hash_file, CompilerError};
use serde_json::{json, Value};
use std::{
    collections::{BTreeMap, BTreeSet, HashMap, HashSet},
    fs,
    rc::Rc,
    sync::atomic::Ordering,
    time::Instant,
};
use yaml_rust2::yaml::Yaml;

mod assets;
mod attach;
mod build;
mod builtin;
mod convert;
mod instance;
mod materials;
mod merge;
mod meta;
mod models;
mod overrides;
mod parts;
mod patch;
mod prefab;
mod project;
mod render;
mod retarget;
mod structure;
#[cfg(test)]
mod tests;
mod textures;
mod transform;
mod yaml;

use build::*;
use builtin::*;
use convert::convert;
use merge::{array, index};
use meta::ModelImport;
use models::Models;
use overrides::{cover, local_trs, material_slot, Overrides, MAX_SLOTS, SLOT_INVALID};
use parts::{mesh_nodes, model_matrices, Parts};
use patch::Changes;
use project::{assets_root, meta_of, read_text, Project};
use retarget::{retarget, Rule};
use structure::{Structure, ADDED_UNPLACED};
use textures::Textures;
use transform::Trs;
use yaml::*;

pub(super) static UNITY: Unity = Unity;
pub(super) struct Unity;
/// Format name, as it travels in the manifest and in the cache key.
const NAME: &str = "unity";

impl Plugin for Unity {
    fn name(&self) -> &'static str {
        NAME
    }
    /// The version names the YAML reader and the conversion generation: changing it invalidates
    /// caches, so every already compiled Unity scene is reread.
    fn version(&self) -> &'static str {
        "unity-yaml-rust2-0.13-gltf-6"
    }
    fn extensions(&self) -> &'static [&'static str] {
        &["unity"]
    }
}

impl ScenePlugin for Unity {
    /// Header of a Unity data file: the tag directive the editor writes at the head of each
    /// serialized file.
    fn accepts_head(&self, head: &[u8]) -> bool {
        head.windows(12).any(|window| window == b"tag:unity3d.")
    }
    fn prepare(&self, request: &SceneRequest<'_>) -> Result<PreparedScene> {
        convert(request, self).map(|directory| request.converted(directory))
    }
    /// A Unity project is recognised at directory level: as soon as a scene lives under it, the
    /// whole tree is the source, and models stored in it are its inputs, never competing
    /// sources. A directory without a scene is not a project: the router looks at the files.
    fn project_inputs(&self, directory: &Path) -> Option<Vec<PathBuf>> {
        Some(project::scenes_under(directory)).filter(|scenes| !scenes.is_empty())
    }
}

/// What a walk has at hand: the scene under construction, the project index, and enough to ask
/// the registry for a model.
struct World<'a> {
    scene: &'a mut Scene,
    project: &'a Project,
    cache: &'a Path,
    cancelled: &'a AtomicBool,
    progress: &'a (dyn Fn(Value) + Sync),
}
impl World<'_> {
    /// Cancellation, checked at each object: the walk stops, `convert` then refuses.
    fn check(&self) -> Option<()> {
        (!self.cancelled.load(Ordering::Relaxed)).then_some(())
    }
}
