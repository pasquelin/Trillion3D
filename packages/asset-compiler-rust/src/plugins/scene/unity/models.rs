//! Models referenced by the scene, imported by the driver of their format.
//!
//! The Unity driver reads no mesh: it asks the registry which driver recognises the file the
//! GUID names, has it produce its intermediate scene, then pours that into its own. A model is
//! imported only once, whatever the number of instances that cite it, and a model that would
//! itself be a Unity scene is refused: a driver does not call itself.
use super::*;
use std::collections::HashMap;

#[derive(Default)]
pub(super) struct Models {
    imported: HashMap<PathBuf, Option<Parts>>,
    metas: HashMap<PathBuf, Rc<ModelImport>>,
}

impl Models {
    /// Mesh-bearing nodes of this model, poured into the scene on first request.
    pub(super) fn parts(&mut self, asset: &Path, world: &mut World<'_>) -> Option<Parts> {
        let meta = self.meta(asset);
        self.imported
            .entry(asset.to_path_buf())
            .or_insert_with(|| import(asset, world, &meta))
            .clone()
    }

    /// Import settings declared by this model's `.meta`, read once.
    pub(super) fn meta(&mut self, asset: &Path) -> Rc<ModelImport> {
        self.metas
            .entry(asset.to_path_buf())
            .or_insert_with(|| Rc::new(meta::read(&meta_of(asset))))
            .clone()
    }
}

fn import(asset: &Path, world: &mut World<'_>, meta: &ModelImport) -> Option<Parts> {
    let name = asset.file_name()?.to_string_lossy().to_string();
    let Ok(Routed::Driver(plugin, inputs)) = route(asset) else {
        world.scene.report.add("unity-model-format-unknown");
        world
            .scene
            .report
            .notes
            .push(format!("model not read: {name}"));
        return None;
    };
    if plugin.name() == NAME {
        world.scene.report.add("unity-model-nested-scene");
        return None;
    }
    let request = SceneRequest {
        source: asset,
        inputs: &inputs,
        cache: world.cache,
        cancelled: world.cancelled,
        progress: world.progress,
    };
    let prepared = match plugin.prepare(&request) {
        Ok(prepared) => prepared,
        Err(error) => {
            world.scene.report.add("unity-model-import-failed");
            world
                .scene
                .report
                .notes
                .push(format!("{name}: {} {}", error.code, error.message));
            return None;
        }
    };
    let (directory, file, key) = match &prepared {
        PreparedScene::Converted { directory, .. } => (
            directory.clone(),
            "model.gltf".to_string(),
            directory.file_name()?.to_string_lossy().to_string(),
        ),
        PreparedScene::InPlace(file) => (
            asset.parent()?.to_path_buf(),
            file.clone(),
            hash_file(asset).ok()?,
        ),
        PreparedScene::Manifest => return None,
    };
    // The manifest the model's driver wrote carries the file unit and its report. A model read
    // in place writes none: its directory is the source's, not a conversion.
    let manifest = match prepared {
        PreparedScene::Converted { .. } => read_manifest(&directory),
        _ => None,
    };
    let unit = manifest.as_ref().map_or(1.0, unit_meters);
    if let Some(manifest) = &manifest {
        carry_report(manifest, &name, world.scene);
    }
    let (gltf, buffers) = match load_gltf(&directory, &file) {
        Some(loaded) => loaded,
        None => {
            world.scene.report.add("unity-model-buffer-unreadable");
            return None;
        }
    };
    // The model's images are named relative to its own directory; the scene serves them from
    // the root given to the compiler, so they must be prefixed with that path.
    let prefix = asset
        .parent()
        .and_then(|parent| world.project.relative_uri(parent))
        .unwrap_or_default();
    let parts = merge::merge(&gltf, &buffers, &prefix, world.scene);
    world.scene.read_model(&name, plugin.name(), &key);
    world.scene.count("models", 1);
    Some(scaled(parts, meta.scale(unit)))
}

/// Manifest a scene driver wrote beside its conversion.
fn read_manifest(directory: &Path) -> Option<Value> {
    let bytes = fs::read(directory.join("manifest.json")).ok()?;
    serde_json::from_slice(&bytes).ok()
}

/// Unit declared by the model file, as its driver recorded it. A model whose manifest does not
/// say it is in metres, like glTF.
fn unit_meters(manifest: &Value) -> f64 {
    manifest["source"]["files"][0]["originalUnitMeters"]
        .as_f64()
        .filter(|unit| unit.is_finite() && *unit > 0.0)
        .unwrap_or(1.0)
}

/// What the model's driver could not yield also belongs to the scene that cites it: its codes
/// come up under their own name — two models missing the same thing add up — and its notes take
/// the model's name, otherwise one would not know which they speak of.
fn carry_report(manifest: &Value, name: &str, scene: &mut Scene) {
    if let Some(unsupported) = manifest["unsupported"].as_object() {
        for (code, count) in unsupported {
            if let Some(count) = count.as_u64() {
                scene.report.add_count(code, count as usize);
            }
        }
    }
    for note in manifest["notes"].as_array().map_or(&[][..], Vec::as_slice) {
        if let Some(note) = note.as_str() {
            scene.report.notes.push(format!("{name}: {note}"));
        }
    }
}

/// Applies the model's import scale factor: geometry stays exactly that its driver yielded,
/// only the transform of each poured node scales it. The matrix being column-major, scaling
/// rows `x`, `y` and `z` leaves the last row intact.
fn scaled(parts: Parts, scale: f64) -> Parts {
    if scale == 1.0 {
        return parts;
    }
    let nodes = parts
        .nodes
        .into_iter()
        .map(|(name, matrix, mesh)| {
            let matrix = match matrix.as_array().filter(|values| values.len() == 16) {
                Some(values) => json!(values
                    .iter()
                    .enumerate()
                    .map(|(rank, value)| {
                        let value = value.as_f64().unwrap_or(0.0);
                        if rank % 4 == 3 {
                            value
                        } else {
                            value * scale
                        }
                    })
                    .collect::<Vec<f64>>()),
                None => json!([
                    scale, 0.0, 0.0, 0.0, 0.0, scale, 0.0, 0.0, 0.0, 0.0, scale, 0.0, 0.0, 0.0,
                    0.0, 1.0
                ]),
            };
            (name, matrix, mesh)
        })
        .collect();
    Parts { nodes }
}

/// glTF of a model and its binaries. A `data:` buffer is not read: the driver counts it in the
/// report rather than decoding its content blindly.
fn load_gltf(directory: &Path, file: &str) -> Option<(Value, Vec<Vec<u8>>)> {
    let bytes = fs::read(directory.join(file)).ok()?;
    if crate::is_glb(&bytes) {
        let (gltf, binary) = crate::parse_glb(&bytes).ok()?;
        return Some((gltf, vec![binary]));
    }
    let gltf: Value = serde_json::from_slice(&bytes).ok()?;
    let mut buffers = Vec::new();
    for buffer in gltf["buffers"].as_array().map_or(&[][..], Vec::as_slice) {
        let uri = buffer["uri"].as_str()?;
        if uri.starts_with("data:") || !crate::is_safe_source_name(uri) {
            return None;
        }
        buffers.push(fs::read(directory.join(uri)).ok()?);
    }
    Some((gltf, buffers))
}
