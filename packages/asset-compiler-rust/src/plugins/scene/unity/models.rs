//! Les modèles référencés par la scène, importés par le pilote de leur format.
//!
//! Le pilote Unity ne lit aucun maillage : il demande au registre quel pilote reconnaît le fichier
//! que le GUID désigne, lui fait produire sa scène intermédiaire, puis verse celle-ci dans la
//! sienne. Un modèle n'est importé qu'une fois, quel que soit le nombre d'instances qui le citent,
//! et un modèle qui serait lui-même une scène Unity est refusé : un pilote ne se rappelle pas.
use super::*;
use std::collections::HashMap;

#[derive(Default)]
pub(super) struct Models {
    imported: HashMap<PathBuf, Option<Parts>>,
}

impl Models {
    /// Les nœuds porteurs de maillage de ce modèle, versés dans la scène à la première demande.
    pub(super) fn parts(&mut self, asset: &Path, world: &mut World<'_>) -> Option<Parts> {
        self.imported
            .entry(asset.to_path_buf())
            .or_insert_with(|| import(asset, world))
            .clone()
    }
}

fn import(asset: &Path, world: &mut World<'_>) -> Option<Parts> {
    let name = asset.file_name()?.to_string_lossy().to_string();
    let Ok(Routed::Driver(plugin, inputs)) = route(asset) else {
        world.scene.report.add("unity-model-format-unknown");
        world
            .scene
            .report
            .notes
            .push(format!("modèle non lu: {name}"));
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
    let (gltf, buffers) = match load_gltf(&directory, &file) {
        Some(loaded) => loaded,
        None => {
            world.scene.report.add("unity-model-buffer-unreadable");
            return None;
        }
    };
    // Les images du modèle sont nommées relativement à son propre dossier ; la scène les sert
    // depuis la racine donnée au compilateur, il faut donc les préfixer de ce chemin.
    let prefix = asset
        .parent()
        .and_then(|parent| world.project.relative_uri(parent))
        .unwrap_or_default();
    let parts = merge::merge(&gltf, &buffers, &prefix, world.scene);
    world.scene.read_model(&name, plugin.name(), &key);
    world.scene.count("models", 1);
    Some(parts)
}

/// Le glTF d'un modèle et ses binaires. Un tampon en `data:` n'est pas lu : le pilote le compte au
/// rapport plutôt que d'en décoder le contenu à l'aveugle.
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
