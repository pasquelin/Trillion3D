//! What compiling one primitive holds in memory, derived from its triangle and vertex counts
//! and from the structures the compiler allocates for them, never from a measured scene.
//!
//! `working` lives while the primitive compiles and is freed when it returns: the DAG's index
//! lists and clusters, the per-vertex arrays of its welds, and what the collider cook and the page
//! packing hold beside it, since both run side by side on the finished DAG. `retained` stays until
//! the job ends: the manifest record of every page (`compiler_page_object::page_record`), its
//! culling and structure entries, its cluster plane, and the record's serialized text when the
//! manifest is published. The decoded accessors and the primitive's index buffer are already
//! charged by `plan_buffers`, and so is what one worker holds whatever the scene (`WORKER_BYTES`).
use super::*;
use crate::coplanar::ClusterPlane;
use crate::dag::{DagCluster, DAG_CLUSTER_TRIANGLES};
use crate::geometry_page_cells::Cell;
use crate::physics_cook::TILE_TRIANGLES;
use std::mem::size_of;

#[cfg(test)]
mod tests;

/// Entries of one page record, nested objects included: 20 top-level fields, the 2 of its normal
/// cone and the 8 of its geometry object.
const PAGE_ENTRIES: usize = 30;
/// Numbers held in the record's arrays: `min`, `max`, cone axis (3 each), `sphere` and
/// `parentSphere` (4 each).
const PAGE_ARRAY_VALUES: usize = 17;
/// Text of the record's two object names and two SHA-256 digests.
const PAGE_TEXT_BYTES: usize = 2 * ("../../objects/".len() + 64 + ".bin".len()) + 2 * 64;
/// Longest key of a record, and the longest text of a JSON number (`f64` round trip).
const KEY_BYTES: usize = "quantizationError".len();
const NUMBER_BYTES: usize = 24;
/// Per vertex while the DAG builds: its first use and three welds (`u32`), seam flag, part
/// extent (`f64`) and level lock (`bool`), in `dag/build.rs` and `dag/attributes.rs`.
const VERTEX_BYTES: usize = 4 * size_of::<u32>() + 2 * size_of::<bool>() + size_of::<f64>();

/// A hash-map entry costs at most 16/7 of its pair: 7/16 is hashbrown's lowest load after growth.
const fn hashed(pair: usize) -> usize {
    pair * 16 / 7
}
/// Per source triangle, one Hausdorff grid (`physics_cook/hausdorff.rs`). The grid puts about one
/// triangle per cell, so a triangle spans at most two cells along each axis: 8 links, each a `u32`
/// in a vector holding up to twice its length; and about one cell per triangle, counted twice.
const GRID_TRIANGLE_BYTES: usize =
    8 * 2 * size_of::<u32>() + 2 * hashed(size_of::<([i64; 3], Vec<u32>)>());
/// Per source triangle, the collider's search (`physics_cook/cut.rs`): the grid of level 0 and the
/// grid of the cut being measured, and three cuts of at most level 0's indices: the best one
/// held, the one tried and its concatenation. A height field (`height.rs`) holds a few words per
/// vertex and its square of samples, under that charge for any grid not far from square.
const COLLIDER_TRIANGLE_BYTES: usize = 2 * GRID_TRIANGLE_BYTES + 3 * 3 * size_of::<u32>();
/// Per DAG cluster, the page packing (`compiler_primitive_bundle.rs`): its culling rank, page,
/// bundle and packing entry with up to four parent bundles, and its record, first in its bundle,
/// then in page order.
const PACKING_CLUSTER_BYTES: usize =
    size_of::<[usize; 8]>() + size_of::<Vec<usize>>() + 2 * size_of::<Value>();

/// A collider tile being cooked (`physics_cook/cut.rs`): per corner of its triangles, the index,
/// a compacted vertex and its remap entry; per triangle, the bytes of the shape (about 100 kB for
/// a full tile).
const TILE_BYTES: usize = TILE_TRIANGLES
    * (3 * (size_of::<u32>() + 3 * size_of::<f32>() + hashed(size_of::<(u32, u32)>())) + 32);
/// A bundle being packed: its payload, one page over and above it, and that page being encoded
/// (`geometry_page::encode`): per corner, its local and remapped indices; per vertex, its source
/// index and remap entry, its cell, its unique copy and rank entry, its remap and its output bits.
const BUNDLE_BYTES: usize = STREAM_BUNDLE_BYTES
    + 3 * DAG_CLUSTER_TRIANGLES
        * (3 * size_of::<u32>()
            + 3 * size_of::<u32>()
            + hashed(size_of::<(u32, u32)>())
            + 3 * size_of::<Cell>()
            + hashed(size_of::<(Cell, u32)>()));
/// What one worker holds whatever the scene, one tile or one bundle at a time; `plan_buffers`
/// charges it once per thread, since every primitive of a wave shares the pool's workers.
pub(crate) const WORKER_BYTES: usize = 1024 * 1024;
const _: () = assert!(TILE_BYTES <= WORKER_BYTES && BUNDLE_BYTES <= WORKER_BYTES);

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
        .checked_add(clusters.checked_mul(size_of::<DagCluster>())?)?
        .checked_add(triangles.checked_mul(COLLIDER_TRIANGLE_BYTES)?)?
        .checked_add(clusters.checked_mul(PACKING_CLUSTER_BYTES)?)?;
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
