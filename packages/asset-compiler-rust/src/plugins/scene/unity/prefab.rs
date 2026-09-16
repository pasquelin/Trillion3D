//! Les instances de prefab : un asset réutilisé, replacé, parfois retouché.
//!
//! `PrefabInstance` nomme un fichier source par GUID et la liste de ce que l'instance y change. Les
//! retouches vivent dans `patch` : on les applique objet par objet pendant le parcours du prefab
//! source, et ce que ce pilote ne rend pas est compté par propriété plutôt que deviné. Le prefab
//! source est lui-même un document Unity, parcouru par le même chemin que la scène — ou un asset
//! modèle, confié au pilote de son format.
use super::*;

impl Builder<'_, '_> {
    pub(super) fn prefab_instance(
        &mut self,
        document: &Rc<Document>,
        id: i64,
        depth: usize,
    ) -> Option<usize> {
        let entry = document.get(id)?;
        let changes = Changes::read(&entry.body["m_Modification"]);
        changes.report(self.world.scene);
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
    /// en remplaçant ce que l'instance déclare — à n'importe quelle profondeur, puisque chaque
    /// retouche nomme l'objet qu'elle vise.
    fn prefab_tree(&mut self, asset: &Path, changes: &Changes, depth: usize) -> Option<usize> {
        let document = self.document(asset)?;
        let roots = Builder::roots(&document);
        let dropped = HashSet::new();
        let mut nodes = Vec::new();
        for root in &roots {
            if let Some(node) = self.transform(&document, *root, &dropped, changes, depth + 1) {
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
}
