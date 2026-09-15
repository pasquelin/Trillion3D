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
    /// à leur place ceux qu'une instance de prefab remplace. Un emplacement que l'instance laisse
    /// vide garde celui du rendu.
    fn materials(&mut self, renderer: &Yaml, replaced: Option<&[Ref]>) -> Vec<Option<usize>> {
        let declared = sequence(renderer, "m_Materials");
        let replaced = replaced.unwrap_or(&[]);
        (0..declared.len().max(replaced.len()))
            .map(|slot| {
                let over = replaced.get(slot).filter(|slot| !slot.is_null()).cloned();
                let slot =
                    over.unwrap_or_else(|| declared.get(slot).map(reference).unwrap_or_default());
                self.material(&slot)
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
        let parts = self.selected(&asset, mesh.file_id, &parts);
        self.attach(&parts, materials)
    }

    /// Le maillage précis qu'un `fileID` désigne dans un modèle à plusieurs maillages. Le `.meta` du
    /// modèle mémorise, pour chaque objet importé, le `fileID` et le nom qu'il portait dans le
    /// fichier : on ne retient que la partie qui porte ce nom, avec sa transformation dans le
    /// modèle. Nom absent de la table, ou introuvable sous ce nom dans le modèle : le modèle entier
    /// est instancié et le fait est compté, comme avant.
    fn selected(&mut self, asset: &Path, file_id: i64, parts: &Parts) -> Parts {
        if parts.nodes.len() < 2 {
            return parts.clone();
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
            return parts.clone();
        }
        self.world.scene.count("subMeshes", 1);
        Parts { nodes: kept }
    }

    /// Instancie les nœuds d'un modèle sous le nœud courant, en liant les matériaux demandés.
    pub(super) fn attach(&mut self, parts: &Parts, materials: &[Option<usize>]) -> Vec<usize> {
        let mut children = Vec::new();
        for (name, matrix, mesh) in &parts.nodes {
            let mesh = self.bound_mesh(*mesh, materials);
            let mut node = json!({"name":name,"mesh":mesh});
            if matrix.is_array() {
                node["matrix"] = matrix.clone();
            }
            children.push(self.world.scene.node(node));
            self.world.scene.count("instances", 1);
        }
        children
    }

    /// Le maillage du modèle lié à cette suite de matériaux. Sans matériau déclaré, le maillage du
    /// modèle est repris tel quel ; sinon une variante est versée, partagée par les instances qui
    /// demandent la même liaison.
    fn bound_mesh(&mut self, mesh: usize, materials: &[Option<usize>]) -> usize {
        if materials.is_empty() {
            return mesh;
        }
        let key = (mesh, materials.to_vec());
        if let Some(known) = self.bound.get(&key) {
            return *known;
        }
        // La première liaison réécrit le maillage du modèle sur place : sans elle, le maillage
        // d'origine resterait dans le document sans que rien ne le nomme.
        let first = !self.bound.keys().any(|(base, _)| *base == mesh);
        if first {
            bind(&mut self.world.scene.meshes[mesh], materials);
            self.bound.insert(key, mesh);
            return mesh;
        }
        let mut copy = self.world.scene.meshes[mesh].clone();
        bind(&mut copy, materials);
        self.world.scene.meshes.push(copy);
        let triangles = self.world.scene.mesh_triangles[mesh];
        self.world.scene.mesh_triangles.push(triangles);
        let index = self.world.scene.meshes.len() - 1;
        self.bound.insert(key, index);
        index
    }
}

/// Lie chaque partie du maillage au matériau de son emplacement, dans l'ordre des emplacements.
fn bind(mesh: &mut Value, materials: &[Option<usize>]) {
    let primitives = mesh["primitives"].as_array_mut().map_or(&mut [][..], |p| p);
    for (slot, primitive) in primitives.iter_mut().enumerate() {
        match materials.get(slot).copied().flatten() {
            Some(material) => primitive["material"] = json!(material),
            None => {
                if let Some(fields) = primitive.as_object_mut() {
                    fields.remove("material");
                }
            }
        }
    }
}
