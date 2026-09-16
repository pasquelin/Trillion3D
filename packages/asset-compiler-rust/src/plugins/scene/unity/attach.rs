//! Poser les morceaux d'un modèle sous un nœud de la scène, liés aux matériaux demandés.
//!
//! Un modèle n'est versé qu'une fois ; ce sont ses morceaux qui s'instancient, autant de fois que la
//! scène les cite. Seule la liaison aux matériaux distingue deux instances du même morceau : le
//! maillage du modèle est repris tel quel quand rien ne le relie, et une variante est versée, puis
//! partagée, pour chaque suite de matériaux demandée.
use super::*;

impl Builder<'_, '_> {
    /// Instancie les nœuds d'un modèle sous le nœud courant, tous liés aux mêmes matériaux : ce
    /// qu'un `MeshRenderer` déclare vaut pour le maillage entier que son `MeshFilter` désigne.
    pub(super) fn attach(&mut self, parts: &Parts, materials: &[Option<usize>]) -> Vec<usize> {
        let each = vec![materials.to_vec(); parts.nodes.len()];
        self.attach_each(parts, &each)
    }

    /// De même, chaque nœud lié aux matériaux de son propre rang : une instance de modèle remplace
    /// les matériaux morceau par morceau, celui qu'elle ne nomme pas gardant ceux du modèle.
    pub(super) fn attach_each(
        &mut self,
        parts: &Parts,
        materials: &[Vec<Option<usize>>],
    ) -> Vec<usize> {
        let mut children = Vec::new();
        for (rank, (name, matrix, mesh)) in parts.nodes.iter().enumerate() {
            let slots = materials.get(rank).map_or(&[][..], Vec::as_slice);
            let mesh = self.bound_mesh(*mesh, slots);
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
