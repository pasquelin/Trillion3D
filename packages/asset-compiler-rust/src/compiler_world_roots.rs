//! World super-roots: the root cover at the scale of the world, not of the object.
//!
//! Every primitive ends at its own roots, so an open world that pins every object's roots pins
//! memory that grows with the world. At cook, the objects placed in each cell of the partition
//! (`compiler_tables/partition.rs`) — each one level-0 cluster, its whole root cover (`place.rs`) —
//! are grouped per material and attribute layout through the DAG builder
//! (`dag::build_dag_from_roots`) into the cell's super-roots, with the same grouping, the same
//! simplification, the same monotone error and the same attributes as inside an object: normals,
//! texture sets and colour, so a super-root wears its material's own textures. The super-roots of
//! every cell of a material continue the same way up to a small world top. An object nothing
//! grouped stands alone: a copy of it is its own root (`world.rs`). The world DAG is packed and
//! linked like a primitive's: the top is pinned, and every object's root bundles depend on the
//! super-roots above them up to the top — or up to a root one cell alone needs, a lone object's
//! copy among them, held with that cell and never pinned (`top.rs`), so the pinned top grows with
//! the materials, never the objects. A
//! super-root's page is a `WGP3` page (`pages.rs`), drawn as any page. The cook publishes the
//! pinned top's bytes and refuses a world whose top exceeds [`WORLD_TOP_BUDGET_BYTES`], naming the
//! cell that pins the most.
use super::*;
use crate::compiler_world::{world_matrices, Mat4};
use crate::dag::DagStrategy;

#[cfg(test)]
mod alone_tests;
#[cfg(test)]
mod attribute_tests;
mod cells;
mod cover;
mod dag_records;
#[cfg(test)]
mod decoded;
mod merge;
mod pack;
mod pages;
mod place;
mod records;
#[cfg(test)]
mod table_tests;
#[cfg(test)]
mod tests;
mod top;
mod world;
#[cfg(test)]
use cover::RootCluster;
pub(crate) use cover::RootCover;

/// Version of the world-roots products: 2 since their records, 3 since an object root names its
/// object by its table rank, 4 since a placed object is one level-0 cluster and a super-root a
/// `WGP3` page carrying its attributes, 5 since a cell names each node's first object.
pub(crate) const WORLD_ROOTS_VERSION: u32 = 5;
/// The table a load reads: bundles, pages, cells and placed objects, as records (`records.rs`).
pub(crate) const WORLD_ROOTS_FILE: &str = "world-roots.table";
/// The world clusters and groups the world stream reads on its first use, as records.
pub(crate) const WORLD_ROOTS_DAG: &str = "world-roots.dag";
/// The super-root bundles, end to end: each bundle's range and digest is in the table.
pub(crate) const WORLD_ROOTS_BIN: &str = "world-roots.bin";
/// The most bytes the world's pinned top may hold, whatever the world's size: four bootstrap
/// bundles. A world over it is refused at cook, its cell named.
pub(crate) const WORLD_TOP_BUDGET_BYTES: usize = 4 * BOOTSTRAP_BUNDLE_BYTES;

/// One primitive of one placed object: its cell, its node and the node's rank among its cell's —
/// the order the cell's file places them in —, the primitive's rank in the manifest, its material,
/// its world matrix and the root cover it places.
pub(crate) struct Instance<'a> {
    pub cell: usize,
    pub node: usize,
    pub slot: usize,
    pub primitive: usize,
    pub material: Option<u64>,
    pub matrix: Mat4,
    pub cover: &'a RootCover,
}

/// The super-root bundles end to end, the table and the DAG records that describe them
/// (`records.rs`), and the cook report.
pub(crate) struct Cooked {
    pub payload: Vec<u8>,
    pub table: Vec<u8>,
    pub dag: Vec<u8>,
    pub report: Value,
}

/// The world super-roots of `instances` spread over `cells` cells, refused when their pinned
/// top exceeds `budget` bytes.
pub(crate) fn cook(
    instances: &[Instance],
    cells: usize,
    budget: usize,
    checkpoint: &(dyn Fn() -> Result<()> + Sync),
) -> Result<Cooked> {
    let world = world::world_dag(instances, checkpoint)?;
    pack::pack_world(&world, instances, cells, budget)
}

/// Compilation stage: the super-roots of the objects the partition placed, `cells` naming the
/// published nodes of each cell. Written as `world-roots.bin`, `world-roots.table` and
/// `world-roots.dag`; the report
/// goes to the manifest. Exact clusters carry no simplification, so no super-root either. The
/// builds run on the job's `pool`: its threads, its phase counters.
pub(super) fn stage_world_roots(
    (o, pool): (&Options, &rayon::ThreadPool),
    (published, directory): (&Value, &Path),
    (primitives, covers): (&[Value], Vec<RootCover>),
    cells: &[Vec<usize>],
) -> Result<(Vec<Product>, Value)> {
    if DagStrategy::named(&o.simplification) == DagStrategy::ExactClusters {
        return Ok((Vec::new(), Value::Null));
    }
    let world = world_matrices(published)?;
    let nodes = values(published, "nodes")?;
    let by_mesh = crate::proxy::primitives_by_mesh(primitives);
    let mut instances = Vec::new();
    for (cell, members) in cells.iter().enumerate() {
        for (slot, &node) in members.iter().enumerate() {
            let mesh = nodes.get(node).and_then(|n| n["mesh"].as_u64());
            for &primitive in mesh.and_then(|m| by_mesh.get(&m)).into_iter().flatten() {
                instances.push(Instance {
                    cell,
                    node,
                    slot,
                    primitive,
                    material: primitives[primitive]["material"].as_u64(),
                    matrix: world[node],
                    cover: &covers[primitive],
                });
            }
        }
    }
    if instances.iter().all(|i| i.cover.clusters.is_empty()) {
        return Ok((Vec::new(), Value::Null));
    }
    let cooked = pool.install(|| {
        cook(&instances, cells.len(), WORLD_TOP_BUDGET_BYTES, &|| {
            check(o)
        })
    })?;
    let bin = product(directory, WORLD_ROOTS_BIN, &cooked.payload)?;
    let table = product(directory, WORLD_ROOTS_FILE, &cooked.table)?;
    let dag = product(directory, WORLD_ROOTS_DAG, &cooked.dag)?;
    Ok((vec![bin, table, dag], cooked.report))
}
