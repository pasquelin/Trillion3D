//! USD scene driver: a `.usda` (text), `.usdc` (binary “crate”) or `.usd` layer becomes the
//! glTF intermediate scene. Composition — sublayers, references, inherits, variants, instances
//! — is done before reading, and this module reads only the composed scene.
//!
//! **Provenance.** Public specification: the AOUSD *OpenUSD Core Specification*, including the
//! text grammar and the binary “crate” format. Read by the `openusd` 0.7.0 crate (MIT,
//! `mxpv/openusd` repository), version pinned in `Cargo.toml`: native Rust implementation, no
//! C++ dependency, which reads `usda`, `usdc` and composes layers. No editor code or SDK is
//! reused, and nothing is re-encoded: this driver reads, it never writes beside the source.
//!
//! **Why a crate rather than a reader written here.** Both paths were open. The “crate” format
//! is a compressed database — token, string, field, path and spec tables, compressed integers
//! and LZ4 — and USD composition (LIVRPS, list editing, instancing) is an engine of its own:
//! rewriting it here would have been several thousand lines for a less sure result. `openusd`
//! is permissive, pure Rust, maintained, and its own dependencies all are (MIT or Apache-2.0).
//!
//! **What it yields**: the `Xform` and `Scope` hierarchy, triangulated polygonal `Mesh`, their
//! normals and `primvars:st`, `GeomSubset` of the `materialBind` family as distinct primitives,
//! instances (one glTF mesh per prototype), `UsdPreviewSurface` materials and their
//! `UsdUVTexture` textures, `defaultPrim`, `metersPerUnit` and `upAxis`.
//! **What it counts in the report without yielding**: see the `usd-*` constants of `world.rs`.
use super::*;
use crate::import::SceneTables as Scene;
use crate::CompilerError;
use openusd::{sdf, usd};
use serde_json::json;
use std::{
    collections::{BTreeSet, HashMap},
    fs,
    sync::atomic::Ordering,
    time::Instant,
};

mod convert;
mod extras;
mod layer;
mod light;
mod material;
mod matrix;
mod mesh;
mod opacity;
mod primvar;
mod read;
mod sampling;
mod subset;
mod surface;
mod texture;
mod visit;
mod world;
mod xform;

use world::World;

pub(super) static USD: Usd = Usd;
pub(super) struct Usd;

/// Format name, as it travels in the manifest and in the cache key.
const NAME: &str = "usd";
/// Header of a USD text layer. The specification requires this line at the head of the file.
const TEXT_MAGIC: &[u8] = b"#usda ";
/// Header of a USD binary layer, “crate” format.
const CRATE_MAGIC: &[u8] = b"PXR-USDC";

impl Plugin for Usd {
    fn name(&self) -> &'static str {
        NAME
    }
    /// The version names the reader and the conversion generation: changing it invalidates
    /// caches, so every already compiled USD scene is reread.
    fn version(&self) -> &'static str {
        "usd-openusd-0.7.0-gltf-8"
    }
    fn extensions(&self) -> &'static [&'static str] {
        &["usd", "usda", "usdc"]
    }
}

impl ScenePlugin for Usd {
    /// `.usd` does not say which of the two serialisations the file carries: both headers are
    /// recognised, and a file without a known extension is recognised by them alone.
    fn accepts_head(&self, head: &[u8]) -> bool {
        head.starts_with(TEXT_MAGIC) || head.starts_with(CRATE_MAGIC)
    }
    fn prepare(&self, request: &SceneRequest<'_>) -> Result<PreparedScene> {
        convert::convert(request, self).map(|directory| request.converted(directory))
    }
}

/// The requested layer. A directory that carries several USD files is an ambiguity: the
/// compiler does not choose the root layer in the caller's place, who names one.
fn source_file(inputs: &[PathBuf]) -> Result<&Path> {
    match inputs {
        [one] => Ok(one.as_path()),
        [] => Err(CompilerError::new(
            "SOURCE_FORMAT_UNKNOWN",
            "usd: a .usd, .usda or .usdc layer is required",
        )),
        many => {
            let names: Vec<String> = many
                .iter()
                .map(|file| {
                    file.file_name()
                        .unwrap_or_default()
                        .to_string_lossy()
                        .into()
                })
                .collect();
            Err(CompilerError::new(
                "SOURCE_FORMAT_AMBIGUOUS",
                format!(
                    "usd: this directory carries {} USD layers ({}); name the one to compile by giving its file as the source",
                    names.len(),
                    names.join(", ")
                ),
            ))
        }
    }
}
