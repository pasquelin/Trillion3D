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
    sync::atomic::AtomicBool,
    time::Instant,
};

mod alembic;
pub(crate) mod archive;
mod axes;
pub(crate) mod blend;
pub(crate) mod cancel;
mod claims;
pub(crate) mod codes;
pub mod convert;
pub(crate) mod corners;
mod fbx;
mod gltf;
mod ma;
mod ngon;
mod normals;
mod obj;
mod output;
mod prepared;
mod request;
mod route;
mod spread;
mod ufbx;
mod unity;
mod unitypackage;
mod usd;
mod usdz;
mod zip;

pub(crate) use output::{scene_output_fields, SceneOutput};
pub use prepared::PreparedScene;
pub use request::SceneRequest;
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
    crate::compiler::source::safe_path::parent_or_dot(source).to_path_buf()
}

/// Classic FBX convention, also Maya's: `TransparentColor` is a *transparency* weighted by
/// `TransparencyFactor`. Black, or a zero factor, is opaque; white and a full factor, invisible.
pub(crate) fn opacity_from_transparency(color: [f64; 3], factor: f64) -> f64 {
    let transparency = trillion3d_math::scalar::mean(color) * factor;
    (1.0 - transparency).clamp(0.0, 1.0)
}

/// What a surface's opacity yielded: the factor that enters `baseColorFactor`, and whether an
/// image's alpha still modulates it.
#[derive(Clone, Copy)]
pub(crate) struct Transparency {
    pub(crate) factor: f64,
    pub(crate) textured: bool,
}

impl Transparency {
    /// glTF's rule: a modulating image, or a factor below one, blends.
    pub(crate) fn blends(self) -> bool {
        self.textured || self.factor < 1.0
    }
}

/// The one file of `inputs` the driver `driver` compiles, `kind` naming what it reads: none is a
/// source of no known format; several are an ambiguity the compiler does not settle in the
/// caller's place, who names one by giving its file as the source.
pub(crate) fn single_input<'a, P: AsRef<Path>>(
    inputs: &'a [P],
    driver: &str,
    kind: &str,
) -> Result<&'a P> {
    match inputs {
        [one] => Ok(one),
        [] => Err(CompilerError::new(
            "SOURCE_FORMAT_UNKNOWN",
            format!("{driver}: no {kind} file in this source"),
        )),
        many => {
            let name = |file: &P| {
                file.as_ref()
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .into_owned()
            };
            let names: Vec<String> = many.iter().map(name).collect();
            Err(CompilerError::new(
                "SOURCE_FORMAT_AMBIGUOUS",
                format!(
                    "{driver}: this source carries {} {kind} files ({}); name the one to compile by giving its file as the source",
                    names.len(),
                    names.join(", ")
                ),
            ))
        }
    }
}

/// Common end of the drivers that fill their tables themselves: a cancelled conversion or one
/// without a surface or a groom is refused by name before writing anything; otherwise the scene goes
/// into the cache at its key, and progress publishes its counts once the folder is written.
fn finish(
    scene: impl SceneOutput,
    request: &SceneRequest<'_>,
    plugin: &dyn ScenePlugin,
    file: &Path,
    started: Instant,
    empty: &str,
) -> Result<PathBuf> {
    cancel::check(request.cancelled)?;
    let drawn = |node: &Value| node.get("mesh").is_some() || crate::hair_strands::carries(node);
    if !scene.nodes().iter().any(drawn) {
        return Err(CompilerError::new("IMPORT_EMPTY", empty));
    }
    let directory = crate::imports_dir(request.cache).join(scene.key());
    let counts = scene.counts().clone();
    let written = scene.write(plugin, &directory, file, started)?;
    (request.progress)(json!({
        "phase":"import-source","step":"complete","plugin":plugin.name(),
        "counts":counts,"ms":crate::shared_math::elapsed_ms(started),
    }));
    Ok(written)
}

/// A scene driver. Errors come out as `CompilerError` with a code, never as a panic;
/// what is not interpretable is a named report entry, not a silent failure.
pub trait ScenePlugin: Plugin + Sync {
    /// Recognizes a source from its first bytes, for a file whose extension says nothing.
    /// A text format, with no header, returns `false`: only its extension names it.
    fn accepts_head(&self, head: &[u8]) -> bool;
    /// Produces the intermediate scene from the claimed files: by default the scene `convert`
    /// writes into the cache.
    fn prepare(&self, request: &SceneRequest<'_>) -> Result<PreparedScene> {
        self.convert(request)
            .map(|directory| request.converted(directory))
    }
    /// Writes the intermediate scene of the claimed files into the cache; its folder. A driver
    /// that serves its scene otherwise — in place, or through the driver of what it unpacks —
    /// overrides `prepare` and converts nothing.
    fn convert(&self, _request: &SceneRequest<'_>) -> Result<PathBuf> {
        Err(CompilerError::new(
            "IMPORT_ERROR",
            format!("{}: this driver converts nothing", self.name()),
        ))
    }
    /// Entries of a directory that this driver claims as a **project**: a whole tree of which
    /// it is the source, and whose files found underneath are only entries. A file driver,
    /// the ordinary case, returns `None` and lets the router look at the files.
    fn project_inputs(&self, _directory: &Path) -> Option<Vec<PathBuf>> {
        None
    }
}
