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
        node: &mut Value,
    ) -> Vec<usize> {
        let find = |class: u32| {
            components
                .iter()
                .find(|(kind, _)| *kind == class)
                .map(|(_, id)| *id)
        };
        let (Some(filter), Some(renderer)) = (find(MESH_FILTER), find(MESH_RENDERER)) else {
            return Vec::new();
        };
        if dropped.contains(&renderer) {
            return Vec::new();
        }
        let (Some(filter), Some(renderer)) = (document.get(filter), document.get(renderer)) else {
            return Vec::new();
        };
        if number_at(&renderer.body, "m_Enabled", 1.0) == 0.0 {
            self.world.scene.count("renderersDisabled", 1);
            return Vec::new();
        }
        let materials: Vec<Option<usize>> = sequence(&renderer.body, "m_Materials")
            .iter()
            .map(|slot| self.material(&reference(slot)))
            .collect();
        let mesh = reference(&filter.body["m_Mesh"]);
        self.instance(&mesh, &materials, node)
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
        // Le `fileID` désigne un maillage précis dans le modèle importé ; cette correspondance est
        // interne à l'éditeur et n'est pas reconstituable, donc un modèle à plusieurs maillages est
        // instancié entier et le fait est compté.
        if parts.nodes.len() > 1 {
            self.world.scene.report.add("unity-model-mesh-by-fileid");
        }
        self.attach(&parts, materials)
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
        if self.rebound.insert(mesh) {
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
