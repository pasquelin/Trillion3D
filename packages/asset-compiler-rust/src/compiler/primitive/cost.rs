//! What compiling one primitive holds in memory, derived from its triangle and vertex counts
//! and from the structures the compiler allocates for them, never from a measured scene.
//!
//! `working` lives while the primitive compiles and is freed when it returns: the DAG's index
//! lists and clusters, the per-vertex arrays of its welds, and what the collider cook and the page
//! packing hold beside it, since both run side by side on the finished DAG. `retained` stays until
//! the job ends: the manifest record of every page (`pages::record::page_record`), its
//! culling and structure entries, its cluster plane, and the record's serialized text when the
//! manifest is published. The decoded accessors and the primitive's index buffer are already
//! charged by `plan_buffers`, and so is what one worker holds whatever the scene (`WORKER_BYTES`).
use super::*;
use crate::coplanar::ClusterPlane;
use crate::dag::{DagCluster, DAG_CLUSTER_TRIANGLES};
use crate::physics_cook::TILE_TRIANGLES;
use std::mem::size_of;
use trillion3d_page_codec::culling::CULLING_STRIDE;
use trillion3d_page_codec::encode::cells::Cell;

#[cfg(test)]
mod tests;

/// Entries of one page record, nested objects included: 16 top-level fields, its bundle and place
/// there among them, and the 5 of its geometry object.
const PAGE_ENTRIES: usize = 21;
/// Numbers held in the record's arrays: `min` and `max` (3 each), `sphere` and `parentSphere` (4
/// each).
const PAGE_ARRAY_VALUES: usize = 14;
/// Longest key of a record, and the longest text of a JSON number (`f64` round trip).
const KEY_BYTES: usize = "uncompressedBytes".len();
const NUMBER_BYTES: usize = 24;
/// Floats a vertex carries at most beside its position, a page holding no more: the normal's 3,
/// the tangent's 4, the colour's 4 and the 2 of each of four texture sets. The bones, which grow
/// with their influences, are not counted.
const ATTRIBUTE_FLOATS: usize = 3 + 4 + 4 + 2 * 4;
/// Per vertex while the DAG builds: the build's own copy of it (`dag/input/built.rs`) — its
/// position, its bitangent and the tangent direction its weld reads (3 `f32` each), its attributes
/// and the source vertex a piece of it copies (`u32`) —, then its first use and its three welds
/// (`u32` each, `dag/build.rs`, `dag/welds.rs`).
const VERTEX_BYTES: usize = 3 * size_of::<[f32; 3]>()
    + ATTRIBUTE_FLOATS * size_of::<f32>()
    + size_of::<u32>()
    + 4 * size_of::<u32>();
/// Per vertex a solve places (`dag/grown.rs`): its position and attributes, the source vertex it
/// deforms as (`u32`) and its three welds (`u32` each). Each level keeps about half the vertices
/// of the level below and places one for each, so every level together places about as many as
/// the source has: they are charged beside each source vertex.
const PLACED_VERTEX_BYTES: usize = size_of::<[f32; 3]>()
    + ATTRIBUTE_FLOATS * size_of::<f32>()
    + size_of::<u32>()
    + 3 * size_of::<u32>();

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
/// A geometry page's bytes, about four bytes a corner: cooked caches measure 1.5 KB at the median
/// for a full cluster.
const ENCODED_PAGE_BYTES: usize = 3 * DAG_CLUSTER_TRIANGLES * size_of::<u32>();
/// Per DAG cluster, the primitive's pages (`compiler/primitive/pages.rs`): its record and encoded
/// bytes, its rank, bundle and place there, its packing entry with up to four parent bundles, and
/// its bytes copied into the run.
const PACKING_CLUSTER_BYTES: usize = size_of::<(Value, Vec<u8>)>()
    + size_of::<[usize; 8]>()
    + size_of::<Vec<usize>>()
    + 2 * ENCODED_PAGE_BYTES;

/// Per triangle of a tile, what Jolt allocates while it cooks the tile's `MeshShape`
/// (`physics_cook::mesh_shape`): its settings' copy of the mesh, the sanitize pass, the AABB tree
/// builder and the packed tree, then the saved shape. A full tile of `TILE_TRIANGLES` peaks at
/// 1.18 MB of heap in use (287 bytes a triangle, sampled across the call), under this charge.
const JOLT_TRIANGLE_BYTES: usize = 320;
/// A collider tile being cooked (`physics_cook/cut.rs`): per corner of its triangles, the index,
/// a compacted vertex and its remap entry; per triangle, Jolt's cook.
const TILE_BYTES: usize = TILE_TRIANGLES
    * (3 * (size_of::<u32>() + 3 * size_of::<f32>() + hashed(size_of::<(u32, u32)>()))
        + JOLT_TRIANGLE_BYTES);
/// A page being encoded (`encode::encode`): per corner, its local and remapped indices; per
/// vertex, its source index and remap entry, its cell, its unique copy and rank entry, its remap
/// and its output bits, its distinct position and rank entry, its stored copy and its link
/// (`stored_positions`).
const PAGE_ENCODE_BYTES: usize = 3
    * DAG_CLUSTER_TRIANGLES
    * (3 * size_of::<u32>()
        + 3 * size_of::<u32>()
        + hashed(size_of::<(u32, u32)>())
        + 3 * size_of::<Cell>()
        + hashed(size_of::<(Cell, u32)>())
        + 2 * size_of::<[u32; 3]>()
        + hashed(size_of::<([u32; 3], u32)>())
        + size_of::<u32>());
/// What one worker holds whatever the scene, one tile or one page at a time; `plan_buffers`
/// charges it once per thread, since every primitive of a wave shares the pool's workers.
pub(crate) const WORKER_BYTES: usize = if TILE_BYTES > PAGE_ENCODE_BYTES {
    TILE_BYTES
} else {
    PAGE_ENCODE_BYTES
};

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
        + PAGE_ARRAY_VALUES * size_of::<Value>();
    let text =
        PAGE_ENTRIES * (KEY_BYTES + NUMBER_BYTES + 4) + PAGE_ARRAY_VALUES * (NUMBER_BYTES + 1);
    // A leaf a cluster at most, and a node over every four more, a third as many (`culling.rs`):
    // four thirds of a node a cluster, rounded up, and its child and output links in the
    // structure.
    let nodes = (CULLING_STRIDE * 4).div_ceil(3);
    let links = (nodes + 2) * size_of::<Value>() + size_of::<Option<ClusterPlane>>();
    record + text + links
}

/// What the DAG's build of `triangles` triangles over `vertices` vertices holds beside the mesh it
/// reads, whoever builds it (a primitive's, an HLOD actor's): the index lists of every level, the
/// vertices' copies and the vertices the solves place, the clusters. Level zero cuts
/// `DAG_CLUSTER_TRIANGLES` per cluster and each coarser level at most halves the one below, so
/// the whole DAG holds at most twice level zero's clusters and index lists.
pub(crate) fn dag_bytes(triangles: usize, vertices: usize) -> Option<usize> {
    let clusters = triangles.div_ceil(DAG_CLUSTER_TRIANGLES).checked_mul(2)?;
    triangles
        .checked_mul(3 * size_of::<u32>())?
        .checked_mul(2)?
        .checked_add(vertices.checked_mul(VERTEX_BYTES + PLACED_VERTEX_BYTES)?)?
        .checked_add(clusters.checked_mul(size_of::<DagCluster>())?)
}

/// Cost of `triangles` triangles over `vertices` vertices: the DAG's build (`dag_bytes`), the
/// collider and the pages' packing beside it.
pub(crate) fn of_counts(triangles: usize, vertices: usize) -> Option<PrimitiveCost> {
    let clusters = triangles.div_ceil(DAG_CLUSTER_TRIANGLES).checked_mul(2)?;
    let indices = triangles.checked_mul(3 * size_of::<u32>())?;
    let working = dag_bytes(triangles, vertices)?
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
    let vertices = required_index(position_accessor(g, p)?.get("count"), "accessor.count")?;
    of_counts(primitive_triangles(g, p)?, vertices).ok_or_else(|| invalid("Working set overflow"))
}
