//! `world-roots.dag` as fixed-size little-endian records (docs/FORMAT.md, World
//! super-roots): every world cluster — object roots included — and the group list, the
//! per-cluster metadata the runtime's cut projects, what the world stream reads on its first use,
//! written as `records.rs` writes the table, straight from the world.
use super::merge::WorldDag;
use super::records::{index, nullable, Records, DAG_MAGIC};
use super::*;
use crate::dag::bounds::cluster_bounds;
use crate::geometry_page::Encoded;

/// Where each super-root's page lies in the binary, and the page itself; none for a placed object.
pub(super) type Pages<'a> = (&'a [Option<(usize, usize)>], &'a [Option<Encoded>]);

/// What a page's geometry descriptor says of it, as a primitive page's `geometry` does
/// (`compiler_page_object::geometry_record`), without its address — the world names it by its
/// bundle and offset —: five words and an `f32`; zeros for a placed object, which has no page.
fn page_facts(r: &mut Records, page: Option<&Encoded>) -> Result<()> {
    let Some(page) = page else {
        (0..6).for_each(|_| r.word(0));
        return Ok(());
    };
    let header = &page.header;
    for value in [
        page.bytes.len(),
        header.vertex_count,
        header.index_count,
        header.flags as usize,
        header.decoded_bytes(),
    ] {
        r.word(index(value)?);
    }
    let error = header.quantization_error;
    r.out
        .extend(if error.is_finite() { error } else { 0.0 }.to_le_bytes());
    Ok(())
}

/// The primitive whose material and attribute layout world cluster `slot` wears: its own object's,
/// or for a super-root the first object it descends from — every object of its build wears the
/// same (`world.rs`). The runtime draws a super-root in that primitive's material.
fn wearer(world: &WorldDag, instances: &[Instance], mut slot: usize) -> Option<usize> {
    loop {
        if let Some(instance) = world.origins[slot] {
            return Some(instances[instance].primitive);
        }
        slot = world.groups[world.clusters[slot].source?].children[0];
    }
}

/// World cluster `slot`, named by its world rank, the same rank its group's `children` and
/// `outputs` use: a super-root names its page's place in the binary (bundle, offset) and what its
/// geometry descriptor reads of it (`page_facts`); each the primitive it wears (`wearer`); a placed
/// object its origin, the placed object of the table that draws it (`object_of` its instance, its
/// rank `object_dependencies` gives), and keeps its own pages in the primitive's streams.
fn cluster(
    r: &mut Records,
    (world, instances): (&WorldDag, &[Instance]),
    (located, encoded): Pages,
    (object_of, slot): (&[Option<usize>], usize),
) -> Result<()> {
    let cluster = &world.clusters[slot];
    let (min, max) = cluster_bounds(&world.positions, &cluster.indices);
    let root = !cluster.parent_error.is_finite();
    r.word(index(cluster.level)?);
    r.word(index(cluster.triangles())?);
    r.word(nullable(wearer(world, instances, slot))?);
    r.word(nullable(located[slot].map(|(bundle, _)| bundle))?);
    r.word(nullable(located[slot].map(|(_, offset)| offset))?);
    r.word(nullable(
        world.origins[slot].and_then(|instance| object_of[instance]),
    )?);
    r.float(cluster.lod_error);
    r.float(cluster.parent_error);
    r.floats(Some(&cluster.sphere));
    r.floats((!root).then_some(&cluster.parent_sphere));
    r.floats(Some(&min));
    r.floats(Some(&max));
    page_facts(r, encoded[slot].as_ref())
}

/// `world-roots.dag` of `world`'s clusters and groups: a 24-byte header (magic, version, the two
/// counts, the pool's length, zero), then 176-byte clusters — level, triangles, then the primitive
/// it wears, bundle, offset and origin (`u32::MAX` for none), then as `f64` the error, the
/// parent's (NaN for a root), the sphere, the parent's (NaN for a root), the minimum and the
/// maximum, then its page's length, vertex count, index count, attribute flags and decoded bytes,
/// and its quantization error as an `f32` (all zero for a placed object, which has no page) —,
/// 64-byte groups — level, its children and outputs in the pool, zero, then as `f64` its error and
/// sphere — and the pool.
pub(super) fn encode_dag(
    placed: (&WorldDag, &[Instance]),
    pages: Pages,
    object_of: &[Option<usize>],
) -> Result<Vec<u8>> {
    let world = placed.0;
    let mut r = Records::default();
    r.out.extend(DAG_MAGIC);
    for value in [
        WORLD_ROOTS_VERSION,
        world.clusters.len() as u32,
        world.groups.len() as u32,
        0,
        0,
    ] {
        r.word(value);
    }
    for slot in 0..world.clusters.len() {
        cluster(&mut r, placed, pages, (object_of, slot))?;
    }
    for group in &world.groups {
        r.word(index(group.level)?);
        r.pooled(group.children.iter())?;
        r.pooled(group.outputs.iter())?;
        r.word(0);
        r.float(group.error);
        r.floats(Some(&group.sphere));
    }
    Ok(r.end(16))
}
