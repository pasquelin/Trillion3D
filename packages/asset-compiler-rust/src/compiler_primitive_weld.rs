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
use crate::dag::weld::{normalized_bits as bits, Welder};
use crate::geometry_page::Attribute;

/// What the weld found: how many vertices the index list names, how many of them it welded.
pub(super) struct WeldReport {
    pub vertices: usize,
    pub welded: usize,
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
            let width = a.source_width;
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
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn attribute(values: Vec<f32>, width: usize) -> Attribute {
        Attribute {
            offset: 12,
            width,
            source_width: width,
            flag: crate::geometry_page::FLAG_NORMAL,
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
