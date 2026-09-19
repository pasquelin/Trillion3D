//! Prefab instances: a reused asset, relocated, sometimes overridden.
//!
//! `PrefabInstance` names a source file by GUID and the list of what the instance changes in it.
//! Overrides live in `patch`: they are applied object by object during the walk of the source
//! prefab, and what this driver does not yield is counted by property rather than guessed. The
//! source prefab is itself a Unity document, walked by the same path as the scene — or a model
//! asset, handed to the driver of its format.
use super::*;

impl Builder<'_, '_> {
    /// `outer` carries the overrides of the instance that contains this one, when a prefab
    /// instantiates another: they sit on top of its own, in nesting order.
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

    /// Objects the instance adds under an object of its source. They are described in the
    /// document that carries the instance: that document builds them, then each takes its place
    /// under the targeted object — under the instance root when that object rendered nothing, and
    /// the fact is then counted rather than the object lost.
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

    /// An instance whose source is a prefab: the source document is walked, root included,
    /// replacing what the instance declares — at any depth, since each override names the object
    /// it targets.
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

/// Adds a child to an already written node.
fn adopt(node: &mut Value, child: usize) {
    match node["children"].as_array_mut() {
        Some(children) => children.push(json!(child)),
        None => node["children"] = json!([child]),
    }
}
