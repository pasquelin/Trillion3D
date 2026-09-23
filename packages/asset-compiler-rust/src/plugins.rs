//! Format drivers: one module per format, one registry line per driver.
//!
//! The compiler knows no input format. It asks the router which driver recognises
//! the source, then has it produce the intermediate scene it already knows how to
//! read — a glTF 2.0, its binary and its manifest. Images follow the same model:
//! one driver per format, queried by extension or magic number, decoding to the
//! contract's output type.
//!
//! Adding a format means adding a module and a registry line; core does not change.
//! `docs/COMPILER.md` § "Adding a format" is the driver manual, § "Input formats" the
//! policy: which formats admitted, which refused, under what conditions.
use serde_json::{json, Value};

pub mod image;
pub mod scene;
#[cfg(test)]
mod tests;

/// Declared by all drivers regardless of contract. One driver per format: two formats never
/// share a name, even when sharing reading library.
pub trait Plugin {
    /// Format name, lowercase. Travels in manifest, report, cache identity.
    fn name(&self) -> &'static str;
    /// Driver version. Changing invalidates compiler identity and caches.
    fn version(&self) -> &'static str;
    /// Claimed extensions, lowercase without leading dot.
    fn extensions(&self) -> &'static [&'static str];
}

/// Driver name and version, as traveling in manifests and reports.
pub fn provenance<P: Plugin + ?Sized>(plugin: &P) -> Value {
    json!({"name": plugin.name(), "version": plugin.version()})
}

/// Registry driver claiming extension, lowercase without leading dot.
fn claiming<'a, P: Plugin + ?Sized>(plugins: &[&'a P], extension: &str) -> Option<&'a P> {
    plugins
        .iter()
        .copied()
        .find(|plugin| plugin.extensions().contains(&extension))
}

/// Filename extension, lowercase without leading dot.
fn extension_of(name: &str) -> Option<String> {
    name.rsplit_once('.')
        .map(|(_, extension)| extension.to_ascii_lowercase())
        .filter(|extension| !extension.is_empty())
}

fn append<P: Plugin + ?Sized>(plugins: &[&P], into: &mut String) {
    for plugin in plugins {
        into.push(';');
        into.push_str(plugin.name());
        into.push('=');
        into.push_str(plugin.version());
    }
}

fn registry<P: Plugin + ?Sized>(plugins: &[&P]) -> Vec<Value> {
    plugins
        .iter()
        .map(|plugin| json!({"name":plugin.name(),"version":plugin.version(),"extensions":plugin.extensions()}))
        .collect()
}

/// Registry fingerprint in compilation cache identity: driver added, removed,
/// or re-versioned changes key, nothing written by old registry read as up to date.
/// Contract versions included: bound what driver promises.
pub fn fingerprint() -> String {
    let mut out = format!("{}+{}", scene::VERSION, image::VERSION);
    append(scene::PLUGINS, &mut out);
    append(image::DECODERS, &mut out);
    out
}

/// Registry published by `--version`: what this binary reads, format by format.
pub fn descriptor() -> Value {
    json!({
        "sceneContract": scene::VERSION,
        "imageContract": image::VERSION,
        "scene": registry(scene::PLUGINS),
        "image": registry(image::DECODERS),
    })
}
