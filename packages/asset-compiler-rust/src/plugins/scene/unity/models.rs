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
    metas: HashMap<PathBuf, Rc<ModelImport>>,
}

impl Models {
    /// Les nœuds porteurs de maillage de ce modèle, versés dans la scène à la première demande.
    pub(super) fn parts(&mut self, asset: &Path, world: &mut World<'_>) -> Option<Parts> {
        let meta = self.meta(asset);
        self.imported
            .entry(asset.to_path_buf())
            .or_insert_with(|| import(asset, world, &meta))
            .clone()
    }

    /// Les réglages d'import déclarés par le `.meta` de ce modèle, lus une seule fois.
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
    let (directory, file, key, unit) = match &prepared {
        PreparedScene::Converted { directory, .. } => (
            directory.clone(),
            "model.gltf".to_string(),
            directory.file_name()?.to_string_lossy().to_string(),
            unit_meters(directory),
        ),
        PreparedScene::InPlace(file) => (
            asset.parent()?.to_path_buf(),
            file.clone(),
            hash_file(asset).ok()?,
            1.0,
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
    Some(scaled(parts, meta.scale(unit)))
}

/// L'unité déclarée par le fichier modèle, telle que son pilote l'a consignée. Un modèle dont le
/// manifeste ne la dit pas est en mètres, comme le glTF.
fn unit_meters(directory: &Path) -> f64 {
    fs::read(directory.join("manifest.json"))
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
        .and_then(|manifest| manifest["source"]["files"][0]["originalUnitMeters"].as_f64())
        .filter(|unit| unit.is_finite() && *unit > 0.0)
        .unwrap_or(1.0)
}

/// Applique le facteur d'échelle d'import du modèle : la géométrie reste exactement celle que son
/// pilote a rendue, seule la transformation de chaque nœud versé la met à l'échelle. La matrice
/// étant en colonnes, mettre les lignes `x`, `y` et `z` à l'échelle laisse la dernière ligne intacte.
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
                    scale, 0.0, 0.0, 0.0, 0.0, scale, 0.0, 0.0, 0.0, 0.0, scale, 0.0, 0.0, 0.0, 0.0,
                    1.0
                ]),
            };
            (name, matrix, mesh)
        })
        .collect();
    Parts { nodes }
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
