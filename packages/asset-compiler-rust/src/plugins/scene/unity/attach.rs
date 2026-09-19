//! Placing a model's pieces under a scene node, bound to the requested materials.
//!
//! A model is poured only once; it is its pieces that instantiate, as many times as the scene
//! cites them. Only the material binding distinguishes two instances of the same piece: the
//! model's mesh is reused as-is when nothing binds it, and a variant is poured, then shared,
//! for each requested material sequence.
use super::*;

impl Builder<'_, '_> {
    /// Instantiates a model's nodes under the current node, all bound to the same materials:
    /// what a `MeshRenderer` declares holds for the whole mesh its `MeshFilter` names.
    pub(super) fn attach(&mut self, parts: &Parts, materials: &[Option<usize>]) -> Vec<usize> {
        self.attach_with(parts, |_| materials)
    }

    /// Likewise, each node bound to the materials of its own rank: a model instance replaces
    /// materials piece by piece, the one it does not name keeping those of the model.
    pub(super) fn attach_each(
        &mut self,
        parts: &Parts,
        materials: &[Vec<Option<usize>>],
    ) -> Vec<usize> {
        self.attach_with(parts, |rank| {
            materials.get(rank).map_or(&[][..], Vec::as_slice)
        })
    }

    /// Instantiates the model's nodes, each bound to what `slots` gives for its rank.
    fn attach_with<'m>(
        &mut self,
        parts: &Parts,
        slots: impl Fn(usize) -> &'m [Option<usize>],
    ) -> Vec<usize> {
        let mut children = Vec::new();
        for (rank, (name, matrix, mesh)) in parts.nodes.iter().enumerate() {
            let mesh = self.bound_mesh(*mesh, slots(rank));
            let mut node = json!({"name":name,"mesh":mesh});
            if matrix.is_array() {
                node["matrix"] = matrix.clone();
            }
            children.push(self.world.scene.node(node));
            self.world.scene.count("instances", 1);
        }
        children
    }

    /// Model mesh bound to this material sequence. Each distinct sequence — the empty sequence
    /// included, which keeps the model's materials — has its variant, shared by instances that
    /// request the same binding. The first arrival keeps the model's mesh: it rewrites it in
    /// place when it binds it, a copy of the original set aside for later ones. A mesh already
    /// placed under an instance is thus never rewritten under it.
    fn bound_mesh(&mut self, mesh: usize, materials: &[Option<usize>]) -> usize {
        if let Some(known) = self.bound.get(&mesh).and_then(|kept| kept.get(materials)) {
            return *known;
        }
        let index = self.variant(mesh, materials);
        self.bound
            .entry(mesh)
            .or_default()
            .insert(materials.to_vec(), index);
        index
    }

    /// The variant itself, poured for a binding the mesh did not yet have.
    fn variant(&mut self, mesh: usize, materials: &[Option<usize>]) -> usize {
        if self.claimed.insert(mesh) {
            if !materials.is_empty() {
                let original = self.world.scene.meshes[mesh].clone();
                self.pristine.insert(mesh, original);
                bind(&mut self.world.scene.meshes[mesh], materials);
            }
            return mesh;
        }
        let mut copy = self
            .pristine
            .get(&mesh)
            .unwrap_or(&self.world.scene.meshes[mesh])
            .clone();
        if !materials.is_empty() {
            bind(&mut copy, materials);
        }
        self.world.scene.meshes.push(copy);
        let triangles = self.world.scene.mesh_triangles[mesh];
        self.world.scene.mesh_triangles.push(triangles);
        self.world.scene.meshes.len() - 1
    }
}

/// Binds each mesh part to the material of its slot, in slot order.
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
