//! Source covers: one compiled primitive's full source geometry, its DAG's level 0, kept where its
//! positions and the attributes its pages carry are all in hand — further on, its clusters exist
//! only as cache objects. The world's HLOD 1 remeshes them, the layers above from it (`place.rs`,
//! `world.rs`), and reads their materials onto every layer: a source mesh of one LOD — a glTF mesh
//! — gives its LOD 0.
use crate::dag::{DagCluster, DagStrategy};
use crate::qem::compact_region;
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
    /// The LODs the `MeshMerge` builder may take of it (`flatten::mesh_merge::Lods`).
    pub lods: super::flatten::mesh_merge::Lods,
}

impl SourceCover {
    /// The level 0 of `dag` on `pos` and the attributes its pages carry (`carried`, one value set
    /// per vertex of `pos`), with the LODs a merged layer takes at the object-space error
    /// `merged` — none where no merged layer takes it (`merge_lod_error`). A scene cooked with
    /// exact clusters (`simplification` `none`) is never simplified, so no HLOD is built of it: it
    /// carries none.
    pub(crate) fn of(
        strategy: DagStrategy,
        dag: &[DagCluster],
        (pos, carried): (&[f32], &[&Attribute]),
        merged: Option<f64>,
    ) -> Self {
        if strategy == DagStrategy::ExactClusters {
            return Self::default();
        }
        let (positions, carried_level0, indices) = level0(dag, (pos, carried));
        let lods = (merged
            .map(|error| super::flatten::mesh_merge::Lods::of(dag, (pos, carried), error)))
        .unwrap_or_default();
        Self {
            positions,
            carried: carried_level0,
            indices,
            lods,
        }
    }
}

/// The level 0 of `dag` on the vertices it uses: its positions, the attributes `carried` holds on
/// them (one value set per vertex of `pos`) and its triangles.
pub(super) fn level0(
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

/// `attribute` on the vertices `remap` keeps, in its order (`qem::push_vertex`, which refuses a
/// vertex the attribute lacks).
pub(super) fn compact_attribute(attribute: &Attribute, remap: &[u32]) -> Attribute {
    let width = attribute.width;
    let mut values = Vec::with_capacity(remap.len() * width);
    for &source in remap {
        crate::qem::push_vertex(&mut values, &attribute.values, width, source);
    }
    Attribute {
        flag: attribute.flag,
        width,
        values,
    }
}
