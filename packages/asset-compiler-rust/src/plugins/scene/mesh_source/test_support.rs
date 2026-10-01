//! Shared format-reader test seam: real table emission, no filesystem or conversion stubs.
use super::*;
pub(in crate::plugins::scene) fn read(
    plugin: &FilePlugin,
    bytes: &[u8],
    budget: usize,
) -> Result<SceneTables> {
    input(plugin, bytes, Path::new("fixture"), &[], budget)
}

pub(in crate::plugins::scene) fn attribute(
    scene: &SceneTables,
    primitive: &Value,
    name: &str,
) -> Vec<f32> {
    let rank = primitive["attributes"][name].as_u64().unwrap() as usize;
    let accessor = &scene.accessors[rank];
    let view = &scene.bin.views[accessor["bufferView"].as_u64().unwrap() as usize];
    let start = view["byteOffset"].as_u64().unwrap() as usize;
    let end = start + view["byteLength"].as_u64().unwrap() as usize;
    scene.bin.bytes[start..end]
        .as_chunks::<4>()
        .0
        .iter()
        .map(|b| f32::from_le_bytes(*b))
        .collect()
}

/// Read a committed source with real local dependency resolution, without publishing a cache.
pub(in crate::plugins::scene) fn file(
    plugin: &FilePlugin,
    path: &Path,
    budget: usize,
) -> Result<SceneTables> {
    input(
        plugin,
        &std::fs::read(path)?,
        path,
        &[path.to_path_buf()],
        budget,
    )
}

fn input(
    plugin: &FilePlugin,
    bytes: &[u8],
    source: &Path,
    inputs: &[PathBuf],
    budget: usize,
) -> Result<SceneTables> {
    let request = SceneRequest {
        source,
        inputs,
        cache: source,
        cancelled: &AtomicBool::new(false),
        progress: &|_| {},
        ram_budget: budget,
    };
    let mut scene = SceneTables::new(plugin);
    (plugin.read)(bytes, &request, &mut scene)?;
    Ok(scene)
}
