//! The sequence of a container driver, the same for all: one archive and only one, extracted
//! under the cache at its key, marked when it is complete, then routed like any other source.
//!
//! An archive format only brings its reading here — the `extract` function its module writes.
//! Everything else, from the refusal of an ambiguous source to the chain published on the report,
//! lives once.
use super::*;
use crate::atomic;
use serde_json::json;
use std::fs;

/// The extracted directory, under the extraction key: the marker keeps it company without polluting it.
const CONTENT: &str = "content";
/// The directory where extraction writes while it lasts: it becomes the extracted directory in a
/// single rename, and a refused extraction takes it with it.
const STAGING: &str = "chantier";

/// Extracts then routes an archive. `extract` receives the source file and the extraction root,
/// and yields the entry count and the decompressed total; it writes nothing when it refuses.
pub(in super::super) fn container(
    request: &SceneRequest<'_>,
    plugin: &dyn ScenePlugin,
    pinned: Option<&str>,
    extract: impl FnOnce(&Path, &Path) -> Result<(usize, u64)>,
) -> Result<PreparedScene> {
    let file = only_input(request, plugin)?;
    let directory = extraction_dir(request, plugin, &crate::hash_file(file)?);
    let (content, marker) = (directory.join(CONTENT), directory.join(super::MARKER));
    let extracted = super::extracted(&directory);
    if extracted.is_none() {
        let counts = whole(&directory, &content, |staging| extract(file, staging))?;
        (request.progress)(
            json!({"phase":"archive","step":"extract","plugin":plugin.name(),"entries":counts.0,"bytes":counts.1}),
        );
    }
    let (scene, inner) = compose(request, &content, pinned)?;
    let chain = match inner {
        Some(_) => chain(plugin, inner),
        None => extracted.unwrap_or_else(|| chain(plugin, None)),
    };
    atomic(
        &marker,
        &serde_json::to_vec_pretty(&json!({"status":"ready","chain":chain}))?,
    )?;
    (request.progress)(json!({"phase":"archive","step":"routed","chain":chain}));
    Ok(scene)
}

/// Extracts into a staging directory, then renames it at once: the extracted directory appears
/// only complete. A refused archive therefore leaves no trace, not even a half-written file —
/// the router will never see a work in progress where it expects a scene.
fn whole(
    directory: &Path,
    content: &Path,
    extract: impl FnOnce(&Path) -> Result<(usize, u64)>,
) -> Result<(usize, u64)> {
    let staging = directory.join(STAGING);
    let _ = fs::remove_dir_all(&staging);
    let _ = fs::remove_dir_all(content);
    fs::create_dir_all(&staging)?;
    match extract(&staging) {
        Ok(counts) => {
            fs::rename(&staging, content)?;
            Ok(counts)
        }
        Err(refusal) => {
            let _ = fs::remove_dir_all(&staging);
            Err(refusal)
        }
    }
}

/// Routes the extracted directory and has it produce the intermediate scene. Yields the retained
/// inner driver, `None` when the directory carries its manifest — the archive shipped its
/// intermediate scene.
fn compose(
    request: &SceneRequest<'_>,
    extracted: &Path,
    pinned: Option<&str>,
) -> Result<(PreparedScene, Option<&'static dyn ScenePlugin>)> {
    // A format that names its own source leaves nothing for the router to choose: the other
    // extracted files are its resources, never candidate scenes.
    let (root, source) = match pinned {
        Some(name) => (
            extracted.to_path_buf(),
            extracted.join(safe_relative(name, &['/']).ok_or_else(|| escape(name))?),
        ),
        None => {
            let root = single_root(extracted);
            (root.clone(), root)
        }
    };
    match route(&source)? {
        Routed::Manifest => Ok((PreparedScene::converted(root.clone(), &root), None)),
        Routed::Driver(inner, inputs) => {
            let inner_request = request.nested(&source, &inputs);
            // A glTF left in place by its driver is read next to the source; in an archive, the
            // source is the archive and not the extracted directory, which is named instead.
            let scene = match inner.prepare(&inner_request)? {
                PreparedScene::InPlace(file) => PreparedScene::Extracted {
                    directory: root,
                    file,
                },
                converted => converted,
            };
            Ok((scene, Some(inner)))
        }
    }
}

/// The chain of the container and its inner driver, as it travels in the report and in the
/// extraction marker: two drivers intervened, both name and version themselves.
fn chain(container: &dyn ScenePlugin, inner: Option<&dyn ScenePlugin>) -> Value {
    json!([
        crate::plugins::provenance(container),
        inner.map(crate::plugins::provenance)
    ])
}

/// A single root directory — `kit/` in `kit.zip` — is walked through: the archive ships the
/// project tree, not a directory that exists only for wrapping. A directory that holds anything
/// other than a single subdirectory is the sought root.
fn single_root(extracted: &Path) -> PathBuf {
    let mut root = extracted.to_path_buf();
    while let Some(only) = only_child(&root) {
        root = only;
    }
    root
}

/// The only child of a directory when it is a directory, otherwise nothing.
fn only_child(dir: &Path) -> Option<PathBuf> {
    let mut entries = std::fs::read_dir(dir).ok()?;
    let first = entries.next()?.ok()?.path();
    if entries.next().is_some() || !first.is_dir() {
        return None;
    }
    Some(first)
}
