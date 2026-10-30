//! The world's trees: one record for each HLOD actor and the directory of them all.
//!
//! Every HLOD actor is its own mesh with its own DAG (`hlod/chain/builds.rs`), all spliced into the
//! world's one DAG on one vertex buffer in the world's space. Each is cut as a primitive's DAG is,
//! at the error of its own finest clusters (`cut::error_over`), never at one error for the world,
//! whose size no actor has; its tree is a record of its own, wearing its material's flags, carrying
//! its corners' attributes and the coordinates of the texture set its mask reads as a primitive's
//! does, and naming the HLOD cell whose switch shows it and the rank of the material it wears
//! (`Traced::actor`). Which actors draw is the cut's to
//! say this frame, cell by cell, so a ray enters only the actors whose cell it draws
//! (`sceneTraceWgsl.ts`): to find them without trying every actor it walks the directory, a tree
//! over the actors' boxes whose entries stand where triangles do.
use super::attributes::{mask_set_of, TRIANGLE_ATTRIBUTE_BYTES, TRIANGLE_MASK_BYTES};
use super::cut::{cut_over, error_over, is_finest, Cut, CutTriangle};
use super::tree::{tree_of, PrimitiveTree, Traced};
use super::word::word;
use crate::dag::DagCluster;
use crate::Result;
use std::collections::BTreeMap;
use trillion3d_page_codec::encode::Attribute;

/// What a cluster of the world DAG says to the ray tracer: the rank of its actor, the HLOD cell
/// whose switch shows that actor and the flags of the actor's material (`material_flags`).
#[derive(Clone, Copy)]
pub(crate) struct WorldGate {
    pub actor: usize,
    pub cell: usize,
    pub flags: u32,
}

/// The world's trees: an HLOD actor's each, then the directory over them, whose entry `k` is the
/// actor of rank `k` here.
pub(crate) struct WorldTrees {
    pub actors: Vec<PrimitiveTree>,
    pub directory: PrimitiveTree,
}

impl WorldTrees {
    /// The trees in the order the file lays them: the actors', then the directory.
    pub(crate) fn in_file_order(&self) -> impl Iterator<Item = &PrimitiveTree> {
        self.actors.iter().chain(std::iter::once(&self.directory))
    }
}

/// The tree of actor `actor`, whose gated clusters are `ranks` of the world DAG `clusters`, over
/// `positions` and the attributes `carried`; none when its cut holds no triangle.
fn actor_tree(
    (positions, carried): (&[f32], &[&Attribute]),
    clusters: &[DagCluster],
    (ranks, gates): (&[usize], &[Option<WorldGate>]),
) -> Result<Option<PrimitiveTree>> {
    let finest = ranks
        .iter()
        .map(|&rank| &clusters[rank])
        .filter(|c| is_finest(c));
    let error = error_over(positions, finest);
    let gate = gates[ranks[0]].expect("a gated cluster");
    let cell = word(gate.cell, "HLOD cell rank")?;
    let material = word(gate.actor, "actor rank")?;
    let cut = cut_over(
        (positions, carried),
        ranks.iter().map(|&rank| (rank, &clusters[rank])),
        (error, mask_set_of(gate.flags)),
    )?;
    tree_of(cut, Traced::actor(gate.flags, cell, material))
}

/// The directory over `actors`: one entry for each, standing where a triangle does — the low and the
/// high corner of the actor's box and the low corner again, so that the entry's box is the actor's —
/// naming the actor by its rank among them (`cluster`) and its HLOD cell (the tag).
fn directory_of(actors: &[PrimitiveTree]) -> Result<Option<PrimitiveTree>> {
    let triangles = (actors.iter().enumerate())
        .map(|(rank, actor)| -> Result<CutTriangle> {
            Ok(CutTriangle {
                corners: [actor.low, actor.high, actor.low],
                cluster: word(rank, "actor rank")?,
                triangle: 0,
                tag: actor.traced.cell,
                attributes: [0; TRIANGLE_ATTRIBUTE_BYTES],
                mask: [0; TRIANGLE_MASK_BYTES],
            })
        })
        .collect::<Result<_>>()?;
    let error = actors.iter().map(|actor| actor.error).fold(0.0, f32::max);
    let cut = Cut {
        error,
        triangles,
        attributed: false,
        normalled: false,
        masked: false,
    };
    tree_of(cut, Traced::WORLD)
}

/// The trees of the world DAG `clusters`, whose indices lie in `positions`, `gates` naming each
/// cluster's actor, cell and flags, none for a cluster that holds no triangle of its own (a voxel
/// page); the attributes `carried` lie beside `positions`; none when no actor's cut holds a
/// triangle, an error when a tree is too large.
pub(crate) fn world_trees(
    (positions, carried): (&[f32], &[&Attribute]),
    clusters: &[DagCluster],
    gates: &[Option<WorldGate>],
) -> Result<Option<WorldTrees>> {
    debug_assert_eq!(clusters.len(), gates.len());
    let mut of_actor: BTreeMap<usize, Vec<usize>> = BTreeMap::new();
    for (rank, gate) in gates.iter().enumerate() {
        if let Some(gate) = gate {
            of_actor.entry(gate.actor).or_default().push(rank);
        }
    }
    let mut actors = Vec::new();
    for ranks in of_actor.values() {
        actors.extend(actor_tree((positions, carried), clusters, (ranks, gates))?);
    }
    let Some(directory) = directory_of(&actors)? else {
        return Ok(None);
    };
    Ok(Some(WorldTrees { actors, directory }))
}
