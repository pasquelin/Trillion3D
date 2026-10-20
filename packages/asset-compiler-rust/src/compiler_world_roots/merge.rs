//! The world DAG: the HLOD builds of `world.rs` — per HLOD cell one actor, one mesh with its own
//! DAG, at every layer of the chain — spliced into one DAG on one vertex buffer,
//! the record files' order. No build reaches another: an HLOD actor is its own mesh, and its
//! cell's switch shows or hides it whole.
use crate::dag::bounds::culling_clusters;
use crate::dag::{DagCluster, DagGroup};
use trillion3d_page_codec::culling::{build_culling_bvh, CullingNode};
use trillion3d_page_codec::encode::{Attribute, Encoded};

/// Every cluster of the world, on one world-space vertex buffer and the normals and texture
/// coordinates every actor carries. Per cluster, the rank of the actor whose flattened material it
/// wears (`actors`); per actor, the HLOD cell whose switch shows it (`cells`, a rank of the chain,
/// `HlodNode`; its layer is that cell's plus one). Once built, the clusters lie in the order of the
/// world's culling hierarchy (`culling`, `in_culling_order`), each of its nodes owning a
/// contiguous range of them.
#[derive(Default)]
pub(super) struct WorldDag {
    pub positions: Vec<f32>,
    pub carried: Vec<Attribute>,
    pub clusters: Vec<DagCluster>,
    pub groups: Vec<DagGroup>,
    pub actors: Vec<usize>,
    pub cells: Vec<usize>,
    pub culling: Vec<CullingNode>,
    /// Each cluster's page (`pages.rs`), in culling order.
    pub pages: Vec<Encoded>,
}

impl WorldDag {
    /// The HLOD cell whose switch shows cluster `slot`: its actor's.
    pub(super) fn hlod(&self, slot: usize) -> usize {
        self.cells[self.actors[slot]]
    }

    /// Appends the next actor's build on its own `arrays` — its attributes laid out as the world's
    /// (`place::conform`) —, its clusters and groups renumbered after the world's, the actor shown
    /// by the switch of HLOD cell `cell`.
    pub(super) fn splice(
        &mut self,
        (dag, groups): (Vec<DagCluster>, Vec<DagGroup>),
        (positions, attributes): (&[f32], &[&Attribute]),
        cell: usize,
    ) {
        let actor = self.cells.len();
        self.cells.push(cell);
        let vertex_base = (self.positions.len() / 3) as u32;
        let vertices = positions.len() / 3;
        for (target, source) in self.carried.iter_mut().zip(attributes) {
            target
                .values
                .extend_from_slice(&source.values[..vertices * target.width]);
        }
        self.positions.extend_from_slice(positions);
        let (group_base, cluster_base) = (self.groups.len(), self.clusters.len());
        for mut cluster in dag {
            cluster.group = cluster.group.map(|g| g + group_base);
            cluster.source = cluster.source.map(|g| g + group_base);
            cluster.indices.iter_mut().for_each(|v| *v += vertex_base);
            self.clusters.push(cluster);
            self.actors.push(actor);
        }
        for mut group in groups {
            group.children.iter_mut().for_each(|c| *c += cluster_base);
            group.outputs.iter_mut().for_each(|c| *c += cluster_base);
            self.groups.push(group);
        }
    }

    /// Builds the world's culling hierarchy (`build_culling_bvh`, the one a primitive's is built
    /// by) and renumbers every cluster into its order, the groups' children and outputs with them:
    /// the rank a cluster takes is the rank every product names it by, and the nodes the runtime
    /// descends name ranges of those ranks.
    pub(super) fn in_culling_order(&mut self) {
        let (order, nodes) = build_culling_bvh(&culling_clusters(&self.positions, &self.clusters));
        let mut rank_of = vec![0usize; order.len()];
        for (rank, &slot) in order.iter().enumerate() {
            rank_of[slot] = rank;
        }
        fn permuted<T>(values: &mut Vec<T>, order: &[usize]) {
            let mut taken: Vec<Option<T>> = std::mem::take(values).into_iter().map(Some).collect();
            *values = order
                .iter()
                .map(|&slot| taken[slot].take().expect("a permutation"))
                .collect();
        }
        permuted(&mut self.clusters, &order);
        permuted(&mut self.actors, &order);
        for group in &mut self.groups {
            group.children.iter_mut().for_each(|c| *c = rank_of[*c]);
            group.outputs.iter_mut().for_each(|c| *c = rank_of[*c]);
        }
        self.culling = nodes;
    }
}
