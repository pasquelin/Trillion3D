//! Ce qu'un GameObject donne à voir : `MeshFilter` + `MeshRenderer`, ou rien.
//!
//! Le maillage vient soit d'un asset modèle — importé par le pilote de son format et instancié —
//! soit d'une primitive intégrée de l'éditeur. Les matériaux, eux, sont ceux que le `MeshRenderer`
//! déclare : ils remplacent ceux que le modèle portait, emplacement par emplacement, comme Unity le
//! fait. Un modèle n'est lu qu'une fois ; seule la liaison aux matériaux distingue ses variantes.
use super::*;
use std::collections::HashSet;

const MESH_RENDERER: u32 = 23;
const MESH_FILTER: u32 = 33;

impl Builder<'_, '_> {
    /// Attache le rendu au nœud. Rend les nœuds enfants d'un modèle instancié, vides sinon.
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

    /// Les matériaux du rendu, emplacement par emplacement : ceux que le `MeshRenderer` déclare, et
    /// à leur place ceux qu'une instance de prefab nomme. Un emplacement dont l'instance ne dit
    /// rien garde celui du rendu ; un emplacement qu'elle nomme vide sort sans matériau, puisque
    /// c'est ce que l'auteur y a mis.
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

    /// Le maillage désigné par le `MeshFilter`, primitif ou importé.
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

    /// Le maillage précis qu'un `fileID` désigne dans un modèle à plusieurs maillages. Le `.meta` du
    /// modèle mémorise, pour chaque objet importé, le `fileID` et le nom qu'il portait dans le
    /// fichier : on ne retient que la partie qui porte ce nom, avec sa transformation dans le
    /// modèle. Nom absent de la table, ou introuvable sous ce nom dans le modèle : le modèle entier
    /// est instancié et le fait est compté, comme avant.
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
