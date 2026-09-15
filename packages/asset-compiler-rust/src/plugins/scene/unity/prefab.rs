//! Les instances de prefab : un asset réutilisé, replacé, parfois retouché.
//!
//! `PrefabInstance` nomme un fichier source par GUID et la liste de ce que l'instance y change. On
//! applique les retouches de transformation et de matériau de la racine ; toute autre retouche est
//! comptée au rapport plutôt que devinée. Le prefab source est lui-même un document Unity, parcouru
//! par le même chemin que la scène — ou un asset modèle, confié au pilote de son format.
use super::*;
use std::collections::{HashMap, HashSet};

/// Ce qu'une instance remplace : par cible, les nombres d'une transformation ; puis le nom et les
/// matériaux de la racine, et le nombre de retouches laissées de côté.
#[derive(Default)]
struct Changes {
    transforms: HashMap<i64, Overrides>,
    name: Option<String>,
    materials: Vec<Ref>,
    ignored: usize,
}

impl Builder<'_, '_> {
    pub(super) fn prefab_instance(
        &mut self,
        document: &Rc<Document>,
        id: i64,
        depth: usize,
    ) -> Option<usize> {
        let entry = document.get(id)?;
        let changes = read_changes(&entry.body["m_Modification"]);
        self.world
            .scene
            .report
            .add_count("unity-prefab-modification-ignored", changes.ignored);
        let source = reference(&entry.body["m_SourcePrefab"]);
        let guid = source.guid.as_ref()?;
        let Some(asset) = self.world.project.asset(guid).map(Path::to_path_buf) else {
            self.world.scene.report.add("unity-prefab-missing");
            return None;
        };
        self.world.scene.count("prefabInstances", 1);
        if asset.extension().is_some_and(|kind| kind == "prefab") {
            return self.prefab_tree(&asset, &changes, depth);
        }
        self.model_instance(&asset, &changes)
    }

    /// Une instance dont la source est un prefab : on parcourt le document source, racine comprise,
    /// en remplaçant ce que l'instance déclare.
    fn prefab_tree(&mut self, asset: &Path, changes: &Changes, depth: usize) -> Option<usize> {
        let document = self.document(asset)?;
        let roots = Builder::roots(&document);
        let empty = Overrides::new();
        let dropped = HashSet::new();
        let mut nodes = Vec::new();
        for root in &roots {
            let overrides = changes.transforms.get(root).unwrap_or(&empty);
            if let Some(node) = self.transform(&document, *root, &dropped, overrides, depth + 1) {
                nodes.push(node);
            }
        }
        let first = *nodes.first()?;
        if let Some(name) = &changes.name {
            self.world.scene.nodes[first]["name"] = json!(name);
        }
        if nodes.len() == 1 {
            return Some(first);
        }
        let name = asset.file_stem()?.to_string_lossy().to_string();
        Some(self.world.scene.node(json!({"name":name,"children":nodes})))
    }

    /// Une instance dont la source est un modèle : le pilote du format le convertit, l'instance ne
    /// porte plus que sa transformation, son nom et, s'ils sont déclarés, ses matériaux.
    fn model_instance(&mut self, asset: &Path, changes: &Changes) -> Option<usize> {
        let parts = self.models.parts(asset, self.world)?;
        let materials: Vec<Option<usize>> = changes
            .materials
            .iter()
            .map(|slot| self.material(slot))
            .collect();
        let children = self.attach(&parts, &materials);
        let name = changes.name.clone().or_else(|| {
            asset
                .file_stem()
                .map(|stem| stem.to_string_lossy().to_string())
        })?;
        let mut node = json!({"name":name,"children":children});
        // Une instance de modèle n'a pas de transformation propre dans le fichier : tout vient des
        // retouches, et l'identité quand il n'y en a pas.
        let overrides = merged(&changes.transforms);
        let trs = local_trs(&Yaml::BadValue, &overrides);
        if trs.is_finite() {
            trs.write(&mut node);
        } else {
            self.world.scene.report.add("unity-invalid-transform");
        }
        Some(self.world.scene.node(node))
    }
}

/// Lit `m_Modifications` : une suite de `{target, propertyPath, value, objectReference}`.
fn read_changes(modification: &Yaml) -> Changes {
    let mut changes = Changes::default();
    for change in sequence(modification, "m_Modifications") {
        let target = reference(&change["target"]).file_id;
        let Some(path) = change["propertyPath"].as_str() else {
            changes.ignored += 1;
            continue;
        };
        if path.starts_with("m_Local") {
            match number(&change["value"]) {
                Some(value) => {
                    changes
                        .transforms
                        .entry(target)
                        .or_default()
                        .insert(path.to_string(), value);
                }
                None => changes.ignored += 1,
            }
        } else if path == "m_Name" {
            changes.name = change["value"].as_str().map(str::to_string);
        } else if let Some(slot) = material_slot(path) {
            let reference = reference(&change["objectReference"]);
            if changes.materials.len() <= slot {
                changes.materials.resize(slot + 1, Ref::default());
            }
            changes.materials[slot] = reference;
        } else {
            changes.ignored += 1;
        }
    }
    changes
}

/// `m_Materials.Array.data[2]` désigne le troisième emplacement de matériau du rendu.
fn material_slot(path: &str) -> Option<usize> {
    path.strip_prefix("m_Materials.Array.data[")?
        .strip_suffix(']')?
        .parse::<usize>()
        .ok()
}

/// Les retouches de toutes les cibles en une seule table : une instance de modèle n'a qu'une
/// racine, et le `fileID` que la cible nomme appartient au fichier importé, pas à la scène.
fn merged(transforms: &HashMap<i64, Overrides>) -> Overrides {
    let mut out = Overrides::new();
    for values in transforms.values() {
        for (path, value) in values {
            out.insert(path.clone(), *value);
        }
    }
    out
}
