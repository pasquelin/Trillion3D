//! Scene driver contract: recognize a source, produce the intermediate scene from it.
//!
//! The intermediate scene is always the same thing — a glTF 2.0 and its binary — whether the
//! driver finds it as-is under the source or writes it into the cache. The compiler reads
//! nothing else, and does not know which format it comes from.
use super::Plugin;
use crate::{CompilerError, Options, Result};
use serde_json::{json, Value};
use std::{
    path::{Path, PathBuf},
    sync::atomic::{AtomicBool, Ordering},
    time::Instant,
};

mod alembic;
mod archive;
mod blend;
mod cancel;
mod fbx;
mod gltf;
mod ma;
mod ngon;
mod normals;
mod obj;
mod output;
mod route;
mod ufbx_driver;
mod unity;
mod unitypackage;
mod usd;
mod usdz;
mod zip;

pub(crate) use output::{scene_output_fields, SceneOutput};
pub use route::{prepare_source, route, Routed, RoutedSource};

/// Version of the scene driver contract. Changing it requires rereading every driver.
pub const VERSION: &str = "scene-plugin-2";

/// The registry: one driver per format. Adding a format means a module and a line here.
pub static PLUGINS: &[&dyn ScenePlugin] = &[
    &gltf::GLTF,
    &fbx::FBX,
    &obj::OBJ,
    &unity::UNITY,
    &blend::BLEND,
    &zip::ZIP,
    &unitypackage::UNITYPACKAGE,
    &alembic::ALEMBIC,
    &usd::USD,
    &usdz::USDZ,
    &ma::MA,
];

/// Everything a driver receives to prepare a scene.
pub struct SceneRequest<'a> {
    /// Path given to the compiler: a file or a directory.
    pub source: &'a Path,
    /// Files this driver claims, sorted. A file source carries only one.
    pub inputs: &'a [PathBuf],
    /// Cache where a converted scene is written. Nothing is ever written beside the source.
    pub cache: &'a Path,
    /// Cancellation to check at every bounded-work boundary.
    pub cancelled: &'a AtomicBool,
    /// Named progress report: a driver publishes its steps under its own `phase`.
    pub progress: &'a (dyn Fn(Value) + Sync),
}

/// Directory against which relative image URIs of a source resolve: the source itself when it
/// is a directory, the directory that carries it when it is a file.
///
/// That is the repository's only rule on this point, and it holds on both sides: a driver
/// finds there the bytes of the images it references and derives from them URIs relative to
/// this root, the compiler rereads those same bytes there to compute the previews. A driver
/// that writes its intermediate scene elsewhere — in the cache — does not move its images
/// there: the converted scene therefore carries its root with it.
pub fn image_root(source: &Path) -> PathBuf {
    if !source.is_file() {
        return source.to_path_buf();
    }
    source
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .map_or_else(|| PathBuf::from("."), Path::to_path_buf)
}

/// Common end of the drivers that fill their tables themselves: a cancelled conversion or one
/// without a surface is refused by name before writing anything; otherwise the scene goes
/// into the cache at its key, and progress publishes its counts once the folder is written.
fn finish(
    scene: impl SceneOutput,
    request: &SceneRequest<'_>,
    plugin: &dyn ScenePlugin,
    file: &Path,
    started: Instant,
    empty: &str,
) -> Result<PathBuf> {
    if request.cancelled.load(Ordering::Relaxed) {
        return Err(cancel::refusal());
    }
    if !scene.nodes().iter().any(|node| node.get("mesh").is_some()) {
        return Err(CompilerError::new("IMPORT_EMPTY", empty));
    }
    let directory = request
        .cache
        .join("native")
        .join("imports")
        .join(scene.key());
    let counts = scene.counts().clone();
    let written = scene.write(plugin, &directory, file, started)?;
    (request.progress)(json!({
        "phase":"import-source","step":"complete","plugin":plugin.name(),
        "counts":counts,"ms":crate::shared_math::elapsed_ms(started),
    }));
    Ok(written)
}

/// The intermediate scene, ready to load.
pub enum PreparedScene {
    /// The source already carried `manifest.json`: it is the intermediate scene, no driver.
    Manifest,
    /// The named glTF file is read as-is under the source: the driver converted nothing.
    InPlace(String),
    /// The driver wrote `model.gltf`, `model.bin` and their manifest into `directory`, under
    /// the cache. `images` remains the root where its image URIs resolve, which has not moved.
    Converted { directory: PathBuf, images: PathBuf },
}

impl PreparedScene {
    /// A scene written into `directory`, whose image URIs resolve under `images`.
    pub fn converted(directory: PathBuf, images: &Path) -> Self {
        Self::Converted {
            directory,
            images: images.to_path_buf(),
        }
    }
    /// Image-resolution root of this scene. `source` is the path given to the compiler, which
    /// an unconverted scene never leaves.
    pub fn images(&self, source: &Path) -> PathBuf {
        match self {
            Self::Converted { images, .. } => images.clone(),
            Self::Manifest | Self::InPlace(_) => image_root(source),
        }
    }
}

/// A scene driver. Errors come out as `CompilerError` with a code, never as a panic;
/// what is not interpretable is a named report entry, not a silent failure.
pub trait ScenePlugin: Plugin + Sync {
    /// Recognizes a source from its first bytes, for a file whose extension says nothing.
    /// A text format, with no header, returns `false`: only its extension names it.
    fn accepts_head(&self, head: &[u8]) -> bool;
    /// Produces the intermediate scene from the claimed files.
    fn prepare(&self, request: &SceneRequest<'_>) -> Result<PreparedScene>;
    /// Entries of a directory that this driver claims as a **project**: a whole tree of which
    /// it is the source, and whose files found underneath are only entries. A file driver,
    /// the ordinary case, returns `None` and lets the router look at the files.
    fn project_inputs(&self, _directory: &Path) -> Option<Vec<PathBuf>> {
        None
    }
}

impl<'a> SceneRequest<'a> {
    pub(super) fn new(
        o: &'a Options,
        inputs: &'a [PathBuf],
        progress: &'a (dyn Fn(Value) + Sync),
    ) -> Self {
        Self {
            source: &o.source,
            inputs,
            cache: &o.cache,
            cancelled: &o.cancelled,
            progress,
        }
    }
    /// Scene this driver has just written into `directory`, with the root where the image
    /// URIs it inscribed there resolve: that of the source it read, not that of the cache.
    pub fn converted(&self, directory: PathBuf) -> PreparedScene {
        PreparedScene::converted(directory, &image_root(self.source))
    }
}
