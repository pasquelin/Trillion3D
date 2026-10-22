//! Source covers: one compiled primitive's full source geometry, its DAG's level 0, kept where its
//! positions and the attributes its pages carry are all in hand — further on, its clusters exist
//! only as cache objects. Every level of the world's HLOD remeshes, merges or voxelizes them and
//! reads their materials onto its actors (`place.rs`, `builds.rs`): a source mesh of one LOD — a
//! glTF mesh — gives its LOD 0.
use crate::dag::{DagCluster, DagGroup};
use crate::hlod::flatten::merge::{Lods, Taken};
use crate::simplify::{compact_region, SolveRules};
use crate::Result;
use trillion3d_page_codec::encode::Attribute;

/// A primitive's level-0 triangles on the vertices they use, in object space, with every attribute
/// its pages carry on those vertices — normals, texture sets, colour —. Empty for a primitive no
/// HLOD takes: it keeps drawing its own pages. A blended primitive is a source as any, and the
/// flattened material is opaque — an actor seen from far is one solid shell, so no opacity or mask
/// map is baked —, which the runtime wears (`hlod/worldRecords.ts`).
#[derive(Clone, Debug, Default)]
pub(crate) struct SourceCover {
    pub positions: Vec<f32>,
    pub carried: Vec<Attribute>,
    pub indices: Vec<u32>,
    /// The LODs the `merge` builder may take of it (`flatten::merge::Lods`).
    pub lods: Lods,
}

impl SourceCover {
    /// The level 0 of `dag`, whose clusters its `groups` made, on `pos` and the attributes its
    /// pages carry (`carried`, one value set per vertex of `pos`), with the LODs the merged layers
    /// take (`merged`: what they take, `merged_lods`, and the rules the source's solves kept) —
    /// none where no merged layer takes any. A DAG of exact clusters (`simplification` `none`) has
    /// no group: its level 0 is its every root, the LOD a merged layer takes whatever the screen
    /// size, and its fallback is made from that level 0.
    pub(crate) fn of(
        (dag, groups): (&[DagCluster], &[DagGroup]),
        (pos, carried): (&[f32], &[&Attribute]),
        merged: Option<(Taken, SolveRules)>,
    ) -> Result<Self> {
        let (positions, carried_level0, indices) = level0(dag, (pos, carried));
        let lods = merged
            .map(|(taken, rules)| Lods::of((dag, groups), (pos, carried), taken, rules))
            .transpose()?
            .unwrap_or_default();
        Ok(Self {
            positions,
            carried: carried_level0,
            indices,
            lods,
        })
    }
}

/// The level 0 of `dag` on the vertices it uses: its positions, the attributes `carried` holds on
/// them (one value set per vertex of `pos`) and its triangles.
fn level0(
    dag: &[DagCluster],
    (pos, carried): (&[f32], &[&Attribute]),
) -> (Vec<f32>, Vec<Attribute>, Vec<u32>) {
    let joined: Vec<u32> = (dag.iter().filter(|c| c.level == 0))
        .flat_map(|c| c.indices.iter().copied())
        .collect();
    let (positions, indices, remap) = compact_region(pos, &joined);
    let carried = (carried.iter())
        .map(|attribute| compact_attribute(attribute, &remap))
        .collect();
    (positions, carried, indices)
}

/// `attribute` on the vertices `remap` keeps, in its order (`simplify::push_vertex`, which refuses a
/// vertex the attribute lacks).
pub(crate) fn compact_attribute(attribute: &Attribute, remap: &[u32]) -> Attribute {
    let width = attribute.width;
    let mut values = Vec::with_capacity(remap.len() * width);
    for &source in remap {
        crate::simplify::push_vertex(&mut values, &attribute.values, width, source);
    }
    Attribute {
        flag: attribute.flag,
        width,
        values,
    }
}
