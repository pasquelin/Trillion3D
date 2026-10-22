//! The world DAG: the HLOD builds of `builds.rs` — per HLOD cell one actor, one mesh with its own
//! DAG, at every layer of the chain — spliced into one DAG on one vertex buffer,
//! the record files' order. No build reaches another: an HLOD actor is its own mesh, its own
//! subtree of the world's culling hierarchy, and its cell's switch shows or hides it whole.
use super::bundles::with_world_laying;
use crate::compiler::hierarchy::{culling_parts, paged_order, permuted, ranks_of};
use crate::compiler::pages::bundles::{assign_pages, Assignment};
use crate::compiler::tables::partition::HlodNode;
use crate::dag::bounds::culling_clusters;
use crate::dag::{append_dag, DagCluster, DagGroup};
use crate::Result;
use trillion3d_page_codec::bits::grid::Extent;
use trillion3d_page_codec::culling::{build_culling_bvh, CullingNode, CullingPart};
use trillion3d_page_codec::encode::Attribute;
use trillion3d_page_codec::facts::PageFacts;

/// Every cluster of the world, on one world-space vertex buffer and the normals and texture
/// coordinates every actor carries. Per cluster, the rank of the actor whose flattened material it
/// wears (`actors`); per actor, the HLOD cell whose switch shows it (`cells`, a rank of the chain,
/// `HlodNode`; its level is that cell's `actor_level`). Once built, the clusters lie in the order their
/// streaming pages are filled in (`assigned`, `in_culling_order`), the leaves of the world's
/// culling hierarchy their group parts (`culling`), every node at or under an actor's subtree root
/// that actor's alone. A voxel actor's clusters each hold a voxel page (`voxels`), their one
/// triangle on their box's corners naming the bounds the culling reads.
#[derive(Default)]
pub(super) struct WorldDag {
    pub positions: Vec<f32>,
    /// Each actor's first vertex (`splice`), and the positions its pages decode to
    /// (`pages.rs`, `encode_pages`): what the world's boxes bound.
    pub vertex_bases: Vec<usize>,
    pub decoded: Vec<f32>,
    pub carried: Vec<Attribute>,
    /// Per actor, the boxes of every cluster its build made, a trim's cut-away ones included
    /// (`builds::Built`): what sets the grid of its pages (`pages.rs`).
    pub extents: Vec<Vec<Extent>>,
    pub clusters: Vec<DagCluster>,
    pub groups: Vec<DagGroup>,
    pub actors: Vec<usize>,
    pub cells: Vec<usize>,
    pub culling: Vec<CullingNode>,
    /// Each cluster's voxel page, none for a cluster of triangles (`voxel::voxel_dag`).
    pub voxels: Vec<Option<crate::voxel::VoxelPage>>,
    /// Each cluster's page (`pages.rs`), in culling order once ordered.
    pub pages: Vec<PageFacts>,
    /// The streaming pages its clusters were assigned to, by their ranks, which `pack_world` lays
    /// (`bundles.rs`); none before `in_culling_order`.
    pub assigned: Option<Assignment>,
}

impl WorldDag {
    /// The HLOD cell whose switch shows cluster `slot`: its actor's.
    pub(crate) fn hlod(&self, slot: usize) -> usize {
        self.cells[self.actors[slot]]
    }

    /// Appends the next actor's build on its own `arrays` — its attributes laid out as the world's
    /// (`place::conform`) —, its clusters and groups renumbered after the world's, each cluster's
    /// voxel page if it is a voxel actor's (`voxels`, one per cluster, or none), the actor shown by
    /// the switch of HLOD cell `cell`, its build's boxes `extents`.
    pub(super) fn splice(
        &mut self,
        (dag, groups): (Vec<DagCluster>, Vec<DagGroup>),
        (positions, attributes): (&[f32], &[&Attribute]),
        (voxels, cell): (Vec<crate::voxel::VoxelPage>, usize),
        extents: Vec<Extent>,
    ) {
        let mut voxels = voxels.into_iter();
        let actor = self.cells.len();
        self.cells.push(cell);
        self.extents.push(extents);
        let vertex_base = (self.positions.len() / 3) as u32;
        self.vertex_bases.push(vertex_base as usize);
        let vertices = positions.len() / 3;
        for (target, source) in self.carried.iter_mut().zip(attributes) {
            target
                .values
                .extend_from_slice(&source.values[..vertices * target.width]);
        }
        self.positions.extend_from_slice(positions);
        let count = dag.len();
        append_dag(
            (&mut self.clusters, &mut self.groups),
            (dag, groups),
            vertex_base,
        );
        self.actors.extend(std::iter::repeat_n(actor, count));
        self.voxels.extend((0..count).map(|_| voxels.next()));
    }

    /// Assigns the world's clusters to streaming pages (`assign_pages`, by the one laying
    /// `with_world_laying`, over the pages `encode_pages` made), builds the world's culling
    /// hierarchy over their group parts (`actor_subtrees`), and renumbers every cluster into the
    /// pages' fill order, its page and the groups' children and outputs with them: the rank a
    /// cluster takes is the rank every product names it by, and the leaves the runtime descends to
    /// name runs of those ranks. The assignment is kept, by rank, for `pack_world`.
    pub(super) fn in_culling_order(&mut self, chain: (&[HlodNode], &crate::Hlod)) -> Result<()> {
        let assigned = with_world_laying(self, chain, |laying| {
            let size = |slot: usize| self.pages[slot].bytes.len();
            assign_pages((&self.clusters, &self.groups), laying, &size)
        })?;
        let order = paged_order(&assigned);
        let boxes = culling_clusters(&self.decoded, &self.clusters);
        let parts = culling_parts(&self.clusters, &boxes, &order, &assigned.page_of);
        let nodes = actor_subtrees(&parts, &|part| self.actors[order[part.first]]);
        let rank_of = ranks_of(&order);
        permuted(&mut self.clusters, &order);
        permuted(&mut self.actors, &order);
        permuted(&mut self.voxels, &order);
        permuted(&mut self.pages, &order);
        for group in &mut self.groups {
            group.children.iter_mut().for_each(|c| *c = rank_of[*c]);
            group.outputs.iter_mut().for_each(|c| *c = rank_of[*c]);
        }
        let pages = (assigned.pages.iter())
            .map(|page| page.iter().map(|&slot| rank_of[slot]).collect())
            .collect();
        let page_of = order.iter().map(|&slot| assigned.page_of[slot]).collect();
        self.assigned = Some(Assignment {
            pages,
            page_of,
            ..assigned
        });
        self.culling = nodes;
        Ok(())
    }
}

/// The world's culling hierarchy over its group parts `parts`, laid in rank order, `actor` naming
/// each one's actor — an actor's parts one run, its pages its own cover's: each actor's subtree
/// built as a primitive's (`build_culling_bvh`), and above them a tree built alike over one item
/// per actor — its subtree root's box, ball and errors —, each of whose leaves is that actor's
/// root, opening on its children. A node at or under an actor's root holds that actor's clusters
/// alone, so its cell's switch closes the subtree at its root (`worldGateWgsl.ts`,
/// `worldNodeHides`), as a scene without the actor would hold none of it. Returns the nodes: the
/// tree's, the actors' roots among them, then each actor's other nodes, every node's children
/// after it.
fn actor_subtrees(
    parts: &[CullingPart],
    actor: &dyn Fn(&CullingPart) -> usize,
) -> Vec<CullingNode> {
    let mut runs: Vec<(usize, usize)> = Vec::new();
    for (at, part) in parts.iter().enumerate() {
        if at > 0 && actor(&parts[at - 1]) == actor(part) {
            runs.last_mut().expect("the actor's run").1 = at + 1;
        } else {
            runs.push((at, at + 1));
        }
    }
    let mut subtrees: Vec<Vec<CullingNode>> = (runs.iter())
        .map(|&(from, to)| build_culling_bvh(&parts[from..to]))
        .collect();
    if subtrees.len() < 2 {
        return subtrees.pop().unwrap_or_else(|| build_culling_bvh(&[]));
    }
    let items: Vec<CullingPart> = (subtrees.iter().enumerate())
        .map(|(at, nodes)| CullingPart {
            min: nodes[0].min,
            max: nodes[0].max,
            level: 0,
            sphere: nodes[0].sphere,
            min_error: nodes[0].min_error,
            parent_error: nodes[0].max_parent_error,
            first: at,
            count: 1,
        })
        .collect();
    let mut nodes = build_culling_bvh(&items);
    let tree = nodes.len();
    let mut below: Vec<CullingNode> = Vec::new();
    let leaves: Vec<usize> = (0..tree).filter(|&at| nodes[at].child_count == 0).collect();
    for at in leaves {
        // The leaf of actor `first_cluster` becomes its root — the same box, ball and errors —, its
        // other nodes laid after every node so far, their links moved with them.
        let own = &subtrees[nodes[at].first_cluster];
        let base = tree + below.len();
        nodes[at] = laid_after(&own[0], base);
        below.extend(own[1..].iter().map(|node| laid_after(node, base)));
    }
    nodes.extend(below);
    nodes
}

/// `node` of an actor's subtree laid after the `base` nodes before it, the subtree's root having
/// taken the place of its own leaf: its first child's link moved with it.
fn laid_after(node: &CullingNode, base: usize) -> CullingNode {
    let mut node = node.clone();
    if node.child_count > 0 {
        node.first_child += base - 1;
    }
    node
}
