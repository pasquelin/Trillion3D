//! Vertex deduplication, once for every source format.
//!
//! A driver may write a vertex per face corner (FBX, OBJ, USD written by some exporters) or a
//! glTF may carry the same vertex twice: identical position, identical attributes, two indices.
//! The simplifier reads such copies as an attribute seam — it can only slide them along the
//! seam — and a mesh made of them barely reduces. The compiler therefore welds, before any
//! partition, every vertex whose position and attributes are bit for bit those of an earlier
//! one: the index list is rewritten onto the first copy, the vertex buffer is left as it is,
//! and the drawn surface is unchanged. Drivers keep the compaction they do for their own
//! buffer size; this stage is the one the DAG relies on, whatever the format.
//!
//! One refusal: a source that draws the same face twice — a sign modelled as two coincident
//! quads — welds into edges shared by more than two triangles, which the simplifier locks
//! (measured: Emerald's street signs, 484 triangles, 52 such edges, one level lost). When the
//! weld creates a non-manifold edge the source indexing stands, and the report says so.
use crate::dag::weld::{normalized_bits as bits, Welder};
use crate::geometry_page::Attribute;
use crate::topology::{classify_topology, TopologyReport};
use crate::Result;

/// What the weld found: how many vertices the index list names, how many of them it welded,
/// and the non-manifold edges it would have created when it was refused for that reason.
pub(super) struct WeldReport {
    pub vertices: usize,
    pub welded: usize,
    pub refused: Option<usize>,
}

/// The indices a primitive is compiled from, and their topology: welded when the DAG reads
/// them, as they came otherwise — a `shared-blend` primitive draws the source as is.
pub(super) fn prepare_indices(
    dag_primitive: bool,
    positions: &[f32],
    attributes: &[Attribute],
    indices: &mut Vec<u32>,
) -> Result<(Option<WeldReport>, TopologyReport)> {
    if dag_primitive {
        let (weld, topology) = weld_unless_non_manifold(positions, attributes, indices)?;
        Ok((Some(weld), topology))
    } else {
        Ok((None, classify_topology(indices, positions.len() / 3)?))
    }
}

/// Welds `indices` unless the weld makes an edge non-manifold, and classifies the topology of
/// what is kept.
fn weld_unless_non_manifold(
    positions: &[f32],
    attributes: &[Attribute],
    indices: &mut Vec<u32>,
) -> Result<(WeldReport, TopologyReport)> {
    let vertices = positions.len() / 3;
    let source = classify_topology(indices, vertices)?;
    let mut welded = indices.clone();
    let mut report = weld_identical(positions, attributes, &mut welded);
    if report.welded == 0 {
        return Ok((report, source));
    }
    let topology = classify_topology(&welded, vertices)?;
    if topology.non_manifold_edges > source.non_manifold_edges {
        report.refused = Some(topology.non_manifold_edges - source.non_manifold_edges);
        report.welded = 0;
        return Ok((report, source));
    }
    *indices = welded;
    Ok((report, topology))
}

/// Rewrites `indices` onto the first copy of each (position, attributes) tuple.
pub(super) fn weld_identical(
    positions: &[f32],
    attributes: &[Attribute],
    indices: &mut [u32],
) -> WeldReport {
    let count = positions.len() / 3;
    let key = |id: u32| -> Vec<u32> {
        let id = id as usize;
        let mut key: Vec<u32> = positions[id * 3..id * 3 + 3]
            .iter()
            .map(|v| bits(*v))
            .collect();
        for a in attributes {
            let width = a.width;
            key.extend(
                a.values[id * width..id * width + width]
                    .iter()
                    .map(|v| bits(*v)),
            );
        }
        key
    };
    let welder = Welder::by_indices(count, indices, key);
    let mut named = vec![false; count];
    let mut welded = 0usize;
    for index in indices.iter_mut() {
        let slot = *index as usize;
        if slot < count && !named[slot] {
            named[slot] = true;
            welded += usize::from(welder.canonical[slot] != *index);
        }
        *index = welder.canonical.get(slot).copied().unwrap_or(*index);
    }
    WeldReport {
        vertices: named.iter().filter(|&&used| used).count(),
        welded,
        refused: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn attribute(values: Vec<f32>, width: usize) -> Attribute {
        Attribute {
            flag: crate::geometry_page::FLAG_NORMAL,
            width,
            values,
        }
    }

    // Behaviour: two vertices identical in position and attributes become one index; a copy
    // that differs by one attribute bit stays its own vertex.
    #[test]
    fn identical_copies_are_welded_and_a_differing_attribute_keeps_its_copy() {
        let positions = vec![0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, -0.0, 0.0, 0.0];
        let normals = attribute(
            vec![0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 1.0, 0.0, 0.0],
            3,
        );
        let mut indices = vec![0, 1, 2, 1, 3, 2];
        let report = weld_identical(&positions, &[normals], &mut indices);
        assert_eq!(indices, vec![0, 1, 0, 1, 3, 0]);
        assert_eq!((report.vertices, report.welded), (4, 1));
    }

    // Behaviour: two coincident triangles weld into an edge of three faces, which the
    // simplifier would lock: the weld is refused and the source indexing stands.
    #[test]
    fn a_weld_that_makes_an_edge_non_manifold_is_refused() {
        // A fan of three triangles around edge (0,1), one of them written twice on copies.
        let positions = vec![
            0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0,
            0.0, 0.0, -1.0, 0.0,
        ];
        let mut indices = vec![0, 1, 2, 1, 0, 3, 4, 5, 6];
        let (report, topology) =
            weld_unless_non_manifold(&positions, &[], &mut indices).expect("weld");
        assert_eq!(
            indices,
            vec![0, 1, 2, 1, 0, 3, 4, 5, 6],
            "source indexing kept"
        );
        assert_eq!((report.welded, report.refused), (0, Some(1)));
        assert_eq!(topology.non_manifold_edges, 0);
    }

    // Behaviour: a mesh without a copy is left word for word as it came.
    #[test]
    fn a_mesh_without_copies_is_unchanged() {
        let positions = vec![0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0];
        let mut indices = vec![0, 1, 2];
        let report = weld_identical(&positions, &[], &mut indices);
        assert_eq!(indices, vec![0, 1, 2]);
        assert_eq!((report.vertices, report.welded), (3, 0));
    }
}
