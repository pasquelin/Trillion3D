//! `ma` (Maya ASCII) scene driver: a MEL command file becomes an intermediate glTF scene.
//! **No command is executed**: the file is read as data.
//!
//! **Provenance and licence, written here as in `docs/COMPILER.md` § "Input formats".** This reader is written in this
//! repository from Autodesk's public documentation: the form of a `.ma` — a sequence of MEL
//! commands ended by `;` —, the commands `requires`, `currentUnit`, `createNode`, `setAttr`,
//! `connectAttr`, `parent` and `fileInfo`, and the attribute names of `transform`, `mesh`,
//! `lambert`, `phong`, `blinn`, `standardSurface`, `file`, `place2dTexture`, `bump2d` and
//! `shadingEngine` nodes. **No Autodesk code or SDK is reused**, no crate is added to the
//! repository for this format, nothing is deciphered or circumvented. The licence of the
//! imported scene remains that of its author.
//!
//! **Safety.** A `.ma` is a program: it can carry scripts. This driver is not an interpreter.
//! It only recognizes the commands of the subset above and **counts all the others by their
//! name** in the manifest's `unsupported` — `python`, `eval`, `source`, `scriptJob` and every
//! unknown included. No substitution, no expression, no script is evaluated; a `scriptNode`
//! is a node counted like any other, its text is never read as code.
//!
//! **What it reads.** The `transform` hierarchy, each identified by its scene path
//! `|parent|child` as in Maya, and posed by the format's full composition — offset-parent
//! matrix, translation, pivots, rotation in the order `rotateOrder` declares, rotation axis,
//! shear, scale, each written as a block or component by component —, `inheritsTransform`
//! and visibility included; `mesh` nodes by their `.vt` vertices, `.ed` edges, `.fc` faces
//! (ear-clipped in the plane of their normal), the first UV set `.uvst[0].uvsp`, `.n`
//! normals when they are there and each edge's hardness flag otherwise; `lambert`, `phong`,
//! `blinn` and `standardSurface` materials to `pbrMetallicRoughness`; `file` nodes linked by
//! `connectAttr`, with the wrap mode of their `place2dTexture`; the material ↔ mesh binding
//! through `shadingEngine` nodes (`.iog` to `.dsm`), including by face groups; and
//! `currentUnit -l`, whose factor to the metre is carried by the scene root. Maya writes
//! its scenes with the `Y` axis up, like glTF.
//!
//! **What it counts on the report without returning it**: see the `ma-*` constants of `report.rs`.
use super::*;
use crate::import::{Report, SceneTables as Scene};
use crate::CompilerError;
use serde_json::json;
use std::{collections::HashMap, fs, sync::atomic::Ordering, time::Instant};

mod attr;
mod build;
mod command;
mod convert;
mod document;
mod faces;
mod lex;
mod material;
mod mesh;
mod normal;
mod report;
mod shading;
#[cfg(test)]
mod tests;
mod texture;
mod value;
mod xform;

use build::World;
use command::Command;
use document::{Document, Node};
use lex::Token;
use shading::Graph;
use value::Attr;

pub(super) static MA: Ma = Ma;
pub(super) struct Ma;

/// Format name, as it travels in the manifest and in the cache key.
const NAME: &str = "ma";
/// First line Autodesk writes at the front of a Maya ASCII file.
const HEADER: &str = "//Maya ASCII";

/// The file is not a Maya ASCII: its first line does not announce it, or a string literal is
/// never closed — a file cut in the middle of a name is not read through to the end.
pub(super) const FILE_INVALID: &str = "ma-file-invalid";
/// The file, or one of its arrays, exceeds the driver's allocation ceiling.
pub(super) const SIZE_UNSUPPORTED: &str = "ma-size-unsupported";

/// Ceiling of the file read: a command text beyond it is not loaded into memory.
const MAX_BYTES: u64 = 512 * 1024 * 1024;
/// Ceiling of an attribute array, in elements: an absurd index does not cause allocation.
pub(super) const MAX_ELEMENTS: usize = 16 << 20;

impl Plugin for Ma {
    fn name(&self) -> &'static str {
        NAME
    }
    /// The version names the reader — written here, on the documented MEL command subset —
    /// and the conversion generation: changing it invalidates caches, so every already
    /// compiled Maya ASCII scene is reread.
    fn version(&self) -> &'static str {
        "ma-mel-subset-1-gltf-8"
    }
    fn extensions(&self) -> &'static [&'static str] {
        &["ma"]
    }
}

impl ScenePlugin for Ma {
    /// Maya announces its text files by a fixed first line: a file that its name does not
    /// designate is therefore recognized anyway.
    fn accepts_head(&self, head: &[u8]) -> bool {
        head.starts_with(HEADER.as_bytes())
    }
    fn prepare(&self, request: &SceneRequest<'_>) -> Result<PreparedScene> {
        convert::convert(request, self).map(|directory| request.converted(directory))
    }
}

/// The requested file. A directory that carries several `.ma` is an ambiguity: the compiler
/// does not choose the scene in the caller's place, who names a precise file as source.
fn source_file(inputs: &[PathBuf]) -> Result<&Path> {
    if let [one] = inputs {
        return Ok(one.as_path());
    }
    Err(CompilerError::new(
        "SOURCE_FORMAT_AMBIGUOUS",
        format!(
            "ma: name the Maya ASCII file to compile; this source carries {} of them",
            inputs.len()
        ),
    ))
}
