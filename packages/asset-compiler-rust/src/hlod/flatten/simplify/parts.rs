//! The cell's original objects as the simplified layer takes them (`gathered`): every primitive of
//! every object, placed in world space at its level 0 — a primitive without a triangle left out —,
//! and, for each, the object its material is baked on (`Home`). An object is a node, all its
//! primitives; each is baked on its own — or, where the layer bakes identical meshes once
//! (`groupIdenticalMeshes`), the primitives of every node placing one mesh share the bake of the
//! first of those nodes: its images, and the texture coordinates generated for its triangles,
//! which each other node's primitive of the same source reads at its own triangles, the same in
//! number and order.
use crate::hlod::chain::place::gather;
use crate::hlod::chain::Instance;
use crate::hlod::flatten::merge::Part;
use std::collections::BTreeMap;
use trillion3d_math::matrix::linear::determinant;

/// The object a primitive's material is baked on — the rank of its node, or of the first node
/// placing its mesh where identical meshes are baked once — and whether the primitive is that
/// object's own: the one the bake is made of, not one that reads its twin's.
pub(super) struct Home {
    pub object: usize,
    pub own: bool,
}

/// The primitives of the objects `members` of `instances`, placed in world space, each with its
/// home (module doc); `grouped` where identical meshes are baked once.
pub(super) fn gathered(
    instances: &[Instance],
    members: &[usize],
    grouped: bool,
) -> (Vec<Part>, Vec<Home>) {
    let mut parts = Vec::with_capacity(members.len());
    let mut homes = Vec::with_capacity(members.len());
    // The first node placing each primitive of a mesh, by the mesh's rank and the primitive's source.
    let mut firsts: BTreeMap<(u64, usize), usize> = BTreeMap::new();
    for &i in members {
        let instance = &instances[i];
        let geometry = gather(instance);
        if geometry.2.is_empty() {
            continue;
        }
        let object = match grouped {
            true => *firsts
                .entry((instance.mesh, instance.source()))
                .or_insert(instance.node),
            false => instance.node,
        };
        parts.push(Part {
            material: instance.material,
            mesh: instance.source(),
            mirrored: determinant(&instance.matrix) < 0.0,
            geometry,
        });
        homes.push(Home {
            object,
            own: object == instance.node,
        });
    }
    (parts, homes)
}
