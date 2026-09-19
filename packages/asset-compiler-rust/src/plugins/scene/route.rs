//! The router: which driver for this source, and an explicit refusal when the answer is not one.
use super::*;
use crate::{is_safe_source_name, CompilerError};
use std::{collections::BTreeMap, fs, io::Read};

#[cfg(test)]
mod tests;

/// Bytes read at the head of a file whose extension no driver claims.
const HEAD_BYTES: usize = 32;

/// What the router recognised in a source.
pub enum Routed {
    /// The directory carries `manifest.json`: it is already the intermediate scene, no driver.
    Manifest,
    /// A driver and the files it claims, sorted.
    Driver(&'static dyn ScenePlugin, Vec<PathBuf>),
}

/// Intermediate scene and the driver that produced it, for provenance and the report.
pub struct RoutedSource {
    pub scene: PreparedScene,
    /// `None` when the source already carried `manifest.json`: no driver intervened.
    pub plugin: Option<&'static dyn ScenePlugin>,
}

/// Routes the source to its driver, then has it produce the intermediate scene.
pub fn prepare_source(o: &Options, progress: &(dyn Fn(Value) + Sync)) -> Result<RoutedSource> {
    match route(&o.source)? {
        Routed::Manifest => Ok(RoutedSource {
            scene: PreparedScene::Manifest,
            plugin: None,
        }),
        Routed::Driver(plugin, inputs) => Ok(RoutedSource {
            scene: plugin.prepare(&SceneRequest::new(o, &inputs, progress))?,
            plugin: Some(plugin),
        }),
    }
}

/// Queries the registry. A file is routed on itself alone; a directory is routed on every
/// **ordinary** file a single driver claims — a subdirectory is never a source, whatever its
/// name, so `textures.fbx` remains the resource folder it is. Two drivers served by the same
/// directory is an ambiguity: the compiler refuses rather than guessing which one carries the
/// scene.
///
/// A **project** driver goes first: it claims the whole directory, and the files found under it
/// are its inputs, not competing sources.
pub fn route(source: &Path) -> Result<Routed> {
    if source.is_file() {
        let name = source
            .file_name()
            .and_then(|s| s.to_str())
            .ok_or_else(|| unknown(&source.to_string_lossy()))?;
        let plugin = claim(name, source).ok_or_else(|| unknown(name))?;
        return Ok(Routed::Driver(plugin, vec![source.to_path_buf()]));
    }
    if source.join("manifest.json").exists() {
        return Ok(Routed::Manifest);
    }
    if let Some(routed) = project(source)? {
        return Ok(routed);
    }
    let mut claimed: BTreeMap<&'static str, (&'static dyn ScenePlugin, Vec<PathBuf>)> =
        BTreeMap::new();
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let name = entry.file_name();
        let Some(name) = name.to_str().filter(|name| is_safe_source_name(name)) else {
            continue;
        };
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        if let Some(plugin) = claim(name, &path) {
            claimed
                .entry(plugin.name())
                .or_insert_with(|| (plugin, Vec::new()))
                .1
                .push(path);
        }
    }
    if claimed.len() > 1 {
        let names: Vec<&str> = claimed.keys().copied().collect();
        return Err(ambiguous(&names));
    }
    let (plugin, mut inputs) = claimed
        .into_values()
        .next()
        .ok_or_else(|| unknown(&source.to_string_lossy()))?;
    inputs.sort();
    Ok(Routed::Driver(plugin, inputs))
}

/// Project driver that claims this whole directory, if there is one. A project is recognised at
/// directory level: files found under it are its inputs, so it takes precedence over file
/// drivers, which would only see competing sources there. Two projects for the same directory
/// remain an ambiguity, like two formats.
fn project(source: &Path) -> Result<Option<Routed>> {
    let mut claimed: Vec<(&'static dyn ScenePlugin, Vec<PathBuf>)> = PLUGINS
        .iter()
        .filter_map(|plugin| {
            plugin
                .project_inputs(source)
                .filter(|inputs| !inputs.is_empty())
                .map(|inputs| (*plugin, inputs))
        })
        .collect();
    if claimed.len() > 1 {
        let names: Vec<&str> = claimed.iter().map(|(plugin, _)| plugin.name()).collect();
        return Err(ambiguous(&names));
    }
    Ok(claimed.pop().map(|(plugin, mut inputs)| {
        inputs.sort();
        Routed::Driver(plugin, inputs)
    }))
}

/// Refusal of a directory that several drivers claim: the compiler does not guess which one
/// carries the scene.
fn ambiguous(names: &[&str]) -> CompilerError {
    CompilerError::new(
        "SOURCE_FORMAT_AMBIGUOUS",
        format!(
            "Source directory is claimed by several import plugins ({}); keep one format per source directory",
            names.join(", ")
        ),
    )
}

/// Driver that claims this file: its extension first, its magic number next — a file without a
/// known extension can still be readable, an unreadable file is claimed by nobody and the
/// router skips it.
fn claim(name: &str, path: &Path) -> Option<&'static dyn ScenePlugin> {
    if let Some(found) =
        super::super::extension_of(name).and_then(|ext| super::super::claiming(PLUGINS, &ext))
    {
        return Some(found);
    }
    let head = head_bytes(path);
    PLUGINS
        .iter()
        .copied()
        .find(|plugin| plugin.accepts_head(&head))
}

/// First bytes of a file. A directory or an unreadable file yields zero.
fn head_bytes(path: &Path) -> Vec<u8> {
    let mut head = Vec::new();
    if let Ok(file) = fs::File::open(path) {
        let _ = file.take(HEAD_BYTES as u64).read_to_end(&mut head);
    }
    head
}

/// Refusal of a source no driver claims, with the list of what is accepted.
fn unknown(what: &str) -> CompilerError {
    let accepted: Vec<String> = PLUGINS
        .iter()
        .map(|plugin| format!("{} (.{})", plugin.name(), plugin.extensions().join(", .")))
        .collect();
    CompilerError::new(
        "SOURCE_FORMAT_UNKNOWN",
        format!(
            "{what}: no import plugin accepts this source. Accepted: a directory carrying manifest.json, {}",
            accepted.join(", ")
        ),
    )
}
