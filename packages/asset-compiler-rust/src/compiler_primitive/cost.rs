//! What compiling one primitive holds in memory, derived from its triangle and vertex counts
//! and from the structures the compiler allocates for them, never from a measured scene.
//!
//! `working` lives while the primitive compiles and is freed when it returns: the DAG's index
//! lists and clusters, and the per-vertex arrays of its welds. `retained` stays until the job
//! ends: the manifest record of every page, its culling and structure entries, its cluster
//! plane, and the page record's serialized text when the manifest is published. The decoded
//! accessors and the primitive's index buffer are already charged by `plan_buffers`.
use super::*;
use crate::coplanar::ClusterPlane;
use crate::dag::{DagCluster, DAG_CLUSTER_TRIANGLES};
use std::mem::size_of;

/// Entries of one page record in `compiler_primitive_bundle.rs`: 20 top-level fields, the 2 of
/// its normal cone and the 8 of its geometry object.
const PAGE_ENTRIES: usize = 30;
/// Numbers held in the record's arrays: `min`, `max`, cone axis (3 each), `sphere` and
/// `parentSphere` (4 each).
const PAGE_ARRAY_VALUES: usize = 17;
/// Text of the record's two object names and two SHA-256 digests.
const PAGE_TEXT_BYTES: usize = 2 * ("../../objects/".len() + 64 + ".bin".len()) + 2 * 64;
/// Longest key of a record, and the longest text of a JSON number (`f64` round trip).
const KEY_BYTES: usize = 16;
const NUMBER_BYTES: usize = 24;
/// Per vertex while the DAG builds: its first use and three welds (`u32`), seam flag, part
/// extent (`f64`) and level lock (`bool`), in `dag/build.rs` and `dag/attributes.rs`.
const VERTEX_BYTES: usize = 4 * size_of::<u32>() + 2 * size_of::<bool>() + size_of::<f64>();

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct PrimitiveCost {
    /// The source index buffer, three `u32` per triangle, held from decoding to the job's end.
    pub indices: usize,
    pub working: usize,
    pub retained: usize,
}

/// Bytes one page keeps until the job ends. A B-tree node is at least half full, so an entry
/// costs at most twice its key and value; the serialized text follows the same fields.
fn page_bytes() -> usize {
    let record = 2 * PAGE_ENTRIES * (size_of::<(String, Value)>() + KEY_BYTES)
        + PAGE_ARRAY_VALUES * size_of::<Value>()
        + PAGE_TEXT_BYTES;
    let text = PAGE_ENTRIES * (KEY_BYTES + NUMBER_BYTES + 4)
        + PAGE_ARRAY_VALUES * (NUMBER_BYTES + 1)
        + PAGE_TEXT_BYTES;
    // One culling node per cluster at most, and its child and output links in the structure.
    let links = (CULLING_STRIDE + 2) * size_of::<Value>() + size_of::<Option<ClusterPlane>>();
    record + text + links
}

/// Cost of `triangles` triangles over `vertices` vertices. Level zero cuts
/// `DAG_CLUSTER_TRIANGLES` per cluster and each coarser level at most halves the one below, so
/// the whole DAG holds at most twice level zero's clusters and index lists.
pub(crate) fn of_counts(triangles: usize, vertices: usize) -> Option<PrimitiveCost> {
    let clusters = triangles.div_ceil(DAG_CLUSTER_TRIANGLES).checked_mul(2)?;
    let indices = triangles.checked_mul(3 * size_of::<u32>())?;
    let working = indices
        .checked_mul(2)?
        .checked_add(vertices.checked_mul(VERTEX_BYTES)?)?
        .checked_add(clusters.checked_mul(size_of::<DagCluster>())?)?;
    let retained = clusters.checked_mul(page_bytes())?;
    Some(PrimitiveCost {
        indices,
        working,
        retained,
    })
}

/// Cost of the glTF primitive `p`.
pub(crate) fn of(g: &Value, p: &Value) -> Result<PrimitiveCost> {
    let position = p
        .get("attributes")
        .and_then(|a| a.get("POSITION"))
        .ok_or_else(|| invalid("primitive.attributes.POSITION is required"))?;
    let accessor = item(
        values(g, "accessors")?,
        required_index(Some(position), "primitive.attributes.POSITION")?,
        "accessor",
    )?;
    let vertices = required_index(accessor.get("count"), "accessor.count")?;
    of_counts(primitive_triangles(g, p)?, vertices).ok_or_else(|| invalid("Working set overflow"))
}

#[cfg(test)]
mod tests {
    use super::*;

    // Behaviour: the cost grows with the geometry and the working part is freed, not retained.
    #[test]
    fn cost_follows_the_counts() {
        let small = of_counts(1_000, 600).expect("fits");
        let large = of_counts(1_000_000, 600_000).expect("fits");
        assert!(large.working > 900 * small.working, "{small:?} {large:?}");
        assert!(large.retained > 900 * small.retained, "{small:?} {large:?}");
        // At least the DAG's index lists over every level: 24 bytes per source triangle.
        assert!(large.working >= 24_000_000, "{large:?}");
    }

    // Behaviour: a count whose cost cannot be represented is refused, never wrapped.
    #[test]
    fn an_overflowing_count_is_refused() {
        assert_eq!(of_counts(usize::MAX, 3), None);
    }
}
