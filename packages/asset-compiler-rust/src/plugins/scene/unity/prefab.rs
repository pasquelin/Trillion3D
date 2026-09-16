//! Les instances de prefab : un asset réutilisé, replacé, parfois retouché.
//!
//! `PrefabInstance` nomme un fichier source par GUID et la liste de ce que l'instance y change. Les
//! retouches vivent dans `patch` : on les applique objet par objet pendant le parcours du prefab
//! source, et ce que ce pilote ne rend pas est compté par propriété plutôt que deviné. Le prefab
//! source est lui-même un document Unity, parcouru par le même chemin que la scène — ou un asset
//! modèle, confié au pilote de son format.
use super::*;

impl Builder<'_, '_> {
    /// `outer` porte les retouches de l'instance qui contient celle-ci, quand un prefab en
    /// instancie un autre : elles se posent par-dessus les siennes, dans l'ordre de nidification.
    pub(super) fn prefab_instance(
        &mut self,
        document: &Rc<Document>,
        id: i64,
        outer: &Changes,
        depth: usize,
    ) -> Option<usize> {
        let entry = document.get(id)?;
        let mut changes = Changes::read(&entry.body["m_Modification"]);
        changes.report(self.world.scene);
        changes.overlay(outer);
        let source = reference(&entry.body["m_SourcePrefab"]);
        let guid = source.guid.as_ref()?;
        let Some(asset) = self.world.project.asset(guid).map(Path::to_path_buf) else {
            self.world.scene.report.add("unity-prefab-missing");
            return None;
        };
        self.world.scene.count("prefabInstances", 1);
        let node = if asset.extension().is_some_and(|kind| kind == "prefab") {
            self.prefab_tree(&asset, &changes, depth)?
        } else {
            self.model_instance(&asset, &changes)?
        };
        self.added_objects(document, &changes, node, depth);
        Some(node)
    }

    /// Les objets que l'instance ajoute sous un objet de sa source. Ils sont décrits dans le
    /// document qui porte l'instance : ce document les construit, puis chacun prend sa place sous
    /// l'objet visé — sous la racine de l'instance quand cet objet n'a rien rendu, et le fait est
    /// alors compté plutôt que l'objet perdu.
    fn added_objects(
        &mut self,
        document: &Rc<Document>,
        changes: &Changes,
        root: usize,
        depth: usize,
    ) {
        let (dropped, none) = (HashSet::new(), Changes::default());
        for (target, added) in changes.structure.added().to_vec() {
            let Some(node) = self.transform(document, added, &dropped, &none, depth + 1) else {
                continue;
            };
            let under = self.placed.get(&target).copied().unwrap_or(root);
            if under == root && !self.placed.contains_key(&target) {
                self.world.scene.report.add(ADDED_UNPLACED);
            }
            adopt(&mut self.world.scene.nodes[under], node);
        }
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

/// Ajoute un enfant à un nœud déjà écrit.
fn adopt(node: &mut Value, child: usize) {
    match node["children"].as_array_mut() {
        Some(children) => children.push(json!(child)),
        None => node["children"] = json!([child]),
    }
}
