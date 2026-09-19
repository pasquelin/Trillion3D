//! What a GameObject shows: `MeshFilter` + `MeshRenderer`, or nothing.
//!
//! The mesh comes either from a model asset — imported by the driver of its format and
//! instantiated — or from an editor built-in primitive. Materials are those the `MeshRenderer`
//! declares: they replace those the model carried, slot by slot, as Unity does. A model is read
//! only once; only the material binding distinguishes its variants.
use super::*;
use std::collections::HashSet;

const MESH_RENDERER: u32 = 23;
const MESH_FILTER: u32 = 33;

impl Builder<'_, '_> {
    /// Attaches the renderer to the node. Yields child nodes of an instantiated model, empty
    /// otherwise.
    pub(super) fn render(
        &mut self,
        document: &Rc<Document>,
        components: &[(u32, i64)],
        dropped: &HashSet<i64>,
        changes: &Changes,
        node: &mut Value,
    ) -> Vec<usize> {
        let find = |class: u32| {
            components
                .iter()
                .find(|(kind, _)| *kind == class)
                .map(|(_, id)| *id)
        };
        let (Some(filter), Some(renderer_id)) = (find(MESH_FILTER), find(MESH_RENDERER)) else {
            return Vec::new();
        };
        if dropped.contains(&renderer_id) {
            return Vec::new();
        }
        let (Some(filter), Some(renderer)) = (document.get(filter), document.get(renderer_id))
        else {
            return Vec::new();
        };
        let enabled = changes
            .enabled(renderer_id)
            .unwrap_or(number_at(&renderer.body, "m_Enabled", 1.0) != 0.0);
        if !enabled {
            self.world.scene.count("renderersDisabled", 1);
            return Vec::new();
        }
        let materials = self.materials(&renderer.body, changes.materials(renderer_id));
        let mesh = reference(&filter.body["m_Mesh"]);
        self.instance(&mesh, &materials, node)
    }

    /// Renderer materials, slot by slot: those the `MeshRenderer` declares, and in their place
    /// those a prefab instance names. A slot the instance says nothing about keeps the
    /// renderer's; a slot it names empty comes out without a material, since that is what the
    /// author put there.
    fn materials(
        &mut self,
        renderer: &Yaml,
        replaced: Option<&[Option<Ref>]>,
    ) -> Vec<Option<usize>> {
        let declared = sequence(renderer, "m_Materials");
        let replaced = replaced.unwrap_or(&[]);
        (0..declared.len().max(replaced.len()))
            .map(|slot| {
                let named = match replaced.get(slot) {
                    Some(Some(over)) => over.clone(),
                    _ => declared.get(slot).map(reference).unwrap_or_default(),
                };
                self.material(&named)
            })
            .collect()
    }

    /// Mesh named by the `MeshFilter`, primitive or imported.
    fn instance(
        &mut self,
        mesh: &Ref,
        materials: &[Option<usize>],
        node: &mut Value,
    ) -> Vec<usize> {
        if mesh.is_null() {
            return Vec::new();
        }
        if mesh.guid.as_deref() == Some(BUILTIN_GUID) {
            let material = materials.first().copied().flatten();
            if let Some(index) = self.builtins.mesh(mesh.file_id, material, self.world.scene) {
                node["mesh"] = json!(index);
                self.world.scene.count("instances", 1);
            }
            return Vec::new();
        }
        let Some(guid) = mesh.guid.as_ref() else {
            self.world.scene.report.add("unity-mesh-local");
            return Vec::new();
        };
        let Some(asset) = self.world.project.asset(guid).map(Path::to_path_buf) else {
            self.world.scene.report.add("unity-model-missing");
            return Vec::new();
        };
        let Some(parts) = self.models.parts(&asset, self.world) else {
            return Vec::new();
        };
        let parts = self.selected(&asset, mesh.file_id, parts);
        self.attach(&parts, materials)
    }

    /// Precise mesh a `fileID` names in a multi-mesh model. The model's `.meta` remembers, for
    /// each imported object, the `fileID` and the name it carried in the file: only the part
    /// that carries that name is kept, with its transform in the model. Name missing from the
    /// table, or not found under that name in the model: the whole model is instantiated and
    /// the fact is counted, as before.
    fn selected(&mut self, asset: &Path, file_id: i64, parts: Parts) -> Parts {
        if parts.nodes.len() < 2 {
            return parts;
        }
        let wanted = self.models.meta(asset).name(file_id).map(str::to_string);
        let meshes = &self.world.scene.meshes;
        let kept: Vec<(String, Value, usize)> = wanted
            .iter()
            .flat_map(|name| {
                parts.nodes.iter().filter(move |(node, _, mesh)| {
                    node == name || meshes[*mesh]["name"].as_str() == Some(name.as_str())
                })
            })
            .cloned()
            .collect();
        if kept.is_empty() {
            self.world.scene.report.add("unity-model-mesh-by-fileid");
            return parts;
        }
        self.world.scene.count("subMeshes", 1);
        Parts { nodes: kept }
    }
}
