//! `world-roots.dag` as fixed-size little-endian records (docs/FORMAT.md, World HLOD): every
//! world cluster and the group list, the per-cluster metadata the runtime's cut projects, what the
//! world stream reads on its first use, written as `records.rs` writes the table, straight from the
//! world.
use super::merge::WorldDag;
use super::records::{index, Records, DAG_MAGIC};
use super::*;
use trillion3d_page_codec::facts::PageFacts;

/// What a page's geometry descriptor says of it, as a primitive page's `geometry` does
/// (`compiler/pages/record.rs`, `geometry_record`), without its address — the world names it by its
/// bundle and offset —: five words.
fn page_facts(r: &mut Records, page: &PageFacts) -> Result<()> {
    for value in [
        page.bytes.len(),
        page.vertex_count,
        page.index_count,
        page.flags as usize,
        page.decoded_bytes,
    ] {
        r.word(index(value)?);
    }
    Ok(())
}

/// World cluster `slot`, named by its world rank, the same rank its group's `children` and
/// `outputs` use: its page's place in the binary (bundle, offset), the rank of the actor whose
/// flattened material it wears, its HLOD cell — whose switch shows it, and whose level the table
/// carries —, and what its geometry descriptor reads of its page (`page_facts`).
pub(crate) fn cluster(
    r: &mut Records,
    world: &WorldDag,
    located: &[(usize, usize)],
    slot: usize,
) -> Result<()> {
    let cluster = &world.clusters[slot];
    let (min, max) = cluster.drawn_box(&world.decoded);
    let root = !cluster.parent_error.is_finite();
    r.word(index(cluster.level)?);
    r.word(index(world.pages[slot].triangles)?);
    r.word(index(world.actors[slot])?);
    let (bundle, offset) = located[slot];
    r.word(index(bundle)?);
    r.word(index(offset)?);
    r.word(index(world.hlod(slot))?);
    r.word(0);
    r.word(0);
    r.float(cluster.lod_error);
    r.float(cluster.parent_error);
    r.floats(Some(&cluster.sphere));
    r.floats((!root).then_some(&cluster.parent_sphere));
    r.floats(Some(&min));
    r.floats(Some(&max));
    page_facts(r, &world.pages[slot])
}

/// `world-roots.dag` of `world`'s clusters, groups and culling nodes: a 24-byte header (magic,
/// version, the two counts, the pool's length, the node count), then 180-byte clusters, in the
/// order their streaming pages are filled in (`WorldDag::in_culling_order`) — level, triangles, the
/// rank of the actor it wears, bundle, offset, HLOD cell and two zeros, then as `f64` the error,
/// the parent's (NaN for a root), the sphere, the parent's (NaN for a root), the minimum and the
/// maximum, then its page's length, vertex count, index count, attribute flags and decoded bytes —,
/// 64-byte groups — level, its children and outputs in
/// the pool, zero, then as `f64` its error and sphere —, 128-byte culling nodes — the
/// `CULLING_STRIDE` `f64` of a primitive's (`CullingNode::flat`) — and the pool. Every error is
/// its actor's own build's (`builds.rs`).
pub(super) fn encode_dag(world: &WorldDag, located: &[(usize, usize)]) -> Result<Vec<u8>> {
    let mut r = Records::default();
    r.out.raw(DAG_MAGIC);
    for value in [
        WORLD_ROOTS_VERSION,
        world.clusters.len() as u32,
        world.groups.len() as u32,
        0,
        index(world.culling.len())?,
    ] {
        r.word(value);
    }
    for slot in 0..world.clusters.len() {
        cluster(&mut r, world, located, slot)?;
    }
    for group in &world.groups {
        r.word(index(group.level)?);
        r.pooled(group.children.iter())?;
        r.pooled(group.outputs.iter())?;
        r.word(0);
        r.float(group.error);
        r.floats(Some(&group.sphere));
    }
    // Written as they are: a ceiling of -1 marks a subtree holding a root.
    for node in &world.culling {
        node.flat().into_iter().for_each(|value| r.out.f64(value));
    }
    Ok(r.end(16))
}
