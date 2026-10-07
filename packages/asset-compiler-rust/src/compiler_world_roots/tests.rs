//! World super-roots on a synthetic world. A tile is 1 km square and holds 4 × 4 objects,
//! each a bumped plate lying down and a smaller one standing, two primitives of two materials,
//! their root covers taken from their real DAG. The world is one tile (1 km), 2 × 2 tiles or 8 × 8
//! tiles (8 km, 64 times the objects), one cell per tile.
use super::world::world_dag;
use super::*;
use crate::compiler_world::translation;
use crate::dag::{build_dag_tallied, DagAttributes, DAG_CLUSTER_TRIANGLES, DAG_GROUP_MAX};

const TILE: f64 = 1000.0;
const SIDE: usize = 4;

/// A plate of `n` × `n` quads, `size` metres across, bumped, standing when `upright`.
pub(super) fn plate(n: usize, size: f32, upright: bool) -> (Vec<f32>, Vec<u32>) {
    let w = n + 1;
    let mut positions = Vec::with_capacity(w * w * 3);
    for y in 0..w {
        for x in 0..w {
            let (u, v) = (x as f32 * size / n as f32, y as f32 * size / n as f32);
            let bump = (u * 1.3).sin() * (v * 0.7).cos() * size * 0.05;
            positions.extend(if upright { [u, v, bump] } else { [u, bump, v] });
        }
    }
    let indices = crate::tests::fixtures::grid_indices(n, n, |x, y| (y * w + x) as u32);
    (positions, indices)
}

/// The root cover of the primitive DAG of `mesh`, every page in bundle 0.
fn cover((positions, indices): (Vec<f32>, Vec<u32>)) -> RootCover {
    let strategy = DagStrategy::QemEndpoints;
    let attributes = DagAttributes::default();
    let (dag, ..) =
        build_dag_tallied(&positions, attributes, &indices, strategy, &|| Ok(())).expect("dag");
    let pages = vec![json!({"stream": 0}); dag.len()];
    let page_of: Vec<usize> = (0..dag.len()).collect();
    RootCover::of(strategy, &dag, (&positions, &[]), &pages, &page_of)
}

pub(super) fn covers() -> [RootCover; 2] {
    [cover(plate(16, 12.0, false)), cover(plate(8, 4.0, true))]
}

/// A world of `tiles` × `tiles` tiles, one cell each: every object places both covers.
pub(super) fn world(covers: &[RootCover; 2], tiles: usize) -> Vec<Instance<'_>> {
    let mut instances = Vec::new();
    for cell in 0..tiles * tiles {
        let corner = [(cell % tiles) as f64 * TILE, (cell / tiles) as f64 * TILE];
        for object in 0..SIDE * SIDE {
            let step = TILE / SIDE as f64;
            let at = [(object % SIDE) as f64 * step, (object / SIDE) as f64 * step];
            let matrix = translation([corner[0] + at[0], 0.0, corner[1] + at[1]]);
            for (primitive, cover) in covers.iter().enumerate() {
                let node = cell * SIDE * SIDE + object;
                let material = Some(primitive as u64);
                instances.push(Instance {
                    cell,
                    node,
                    primitive,
                    material,
                    matrix,
                    cover,
                });
            }
        }
    }
    instances
}

pub(super) fn cooked(instances: &[Instance], cells: usize, budget: usize) -> Result<Cooked> {
    cook(instances, cells, budget, &|| Ok(()))
}

/// The largest page `cooked` wrote, and the bytes of its pinned top.
pub(super) fn sizes(cooked: &Cooked) -> (usize, usize) {
    let pages = cooked.table["pages"].as_array().expect("pages").iter();
    let largest = pages.filter_map(|page| page["bytes"].as_u64()).max();
    let top = cooked.report["pinnedTopBytes"].as_u64();
    (largest.unwrap_or(0) as usize, top.unwrap_or(0) as usize)
}

#[test]
fn the_published_pinned_top_is_bounded_whatever_the_size_of_the_world() {
    let covers = covers();
    // A world of one cell pins nothing: that cell holds every root of it.
    let lone = cooked(&world(&covers, 1), 1, WORLD_TOP_BUDGET_BYTES).expect("1 km");
    assert_eq!(sizes(&lone).1, 0, "1 km");
    let (small, large) = (world(&covers, 2), world(&covers, 8));
    let one = cooked(&small, 4, WORLD_TOP_BUDGET_BYTES).expect("2 km");
    let many = cooked(&large, 64, WORLD_TOP_BUDGET_BYTES).expect("8 km");
    // The bound owes nothing to the world: per material, one group's pages at most, each no
    // larger than the largest page either cook wrote.
    let ((first, one), (second, many)) = (sizes(&one), sizes(&many));
    let page = first.max(second);
    let bound = covers.len() * DAG_GROUP_MAX * page;
    assert!(one > 0 && one <= bound, "2 km: {one} of {bound}");
    assert!(many > 0 && many <= bound, "8 km: {many} of {bound}");
    // The object roots the runtime pins today grew 16 times; the top did not follow them.
    let roots: usize = large
        .iter()
        .map(|i| i.cover.positions.len() * 4 + i.cover.clusters.len() * DAG_CLUSTER_TRIANGLES)
        .sum();
    assert!(many * 8 <= roots, "8 km top {many} of {roots} root bytes");
    let spread = covers.len() * page; // each material ends on one page at either size
    assert!(many.abs_diff(one) <= spread, "2 km {one}, 8 km {many}");
}

#[test]
fn errors_stay_monotone_across_the_super_roots() {
    let covers = covers();
    let instances = world(&covers, 2);
    let world = world_dag(&instances, &|| Ok(())).expect("world");
    assert!(!world.groups.is_empty(), "the object roots are continued");
    for group in &world.groups {
        for &child in &group.children {
            let child = &world.clusters[child];
            assert!(
                child.lod_error <= group.error,
                "{} > {}",
                child.lod_error,
                group.error
            );
            assert_eq!(child.parent_error, group.error);
        }
        for &output in &group.outputs {
            assert_eq!(world.clusters[output].lod_error, group.error);
            assert!(world.clusters[output].level > world.clusters[group.children[0]].level);
        }
    }
    for cluster in &world.clusters {
        assert!(cluster.lod_error <= cluster.parent_error);
        // A parent's sphere holds its child's, or the child's projected error can pass its own.
        let (s, p) = (cluster.sphere, cluster.parent_sphere);
        let apart = ((0..3).map(|a| (s[a] - p[a]).powi(2)).sum::<f64>()).sqrt();
        let slack = p[3] * 1e-6 + 1e-6;
        assert!(apart + s[3] <= p[3] + slack, "{s:?} out of {p:?}");
    }
    // Past its cell, the grouping continues across cells, one material at a time.
    let spanning = |output: &usize| world.cells[*output].len() == 4;
    assert!(world.groups.iter().any(|g| g.outputs.iter().any(spanning)));
    for group in &world.groups {
        let material = world.materials[group.outputs[0]];
        assert!(group
            .children
            .iter()
            .all(|&c| world.materials[c] == material));
    }
}

#[test]
fn every_object_root_reaches_the_world_top_through_its_dependencies() {
    let covers = covers();
    let instances = world(&covers, 2);
    let cooked = cooked(&instances, 4, WORLD_TOP_BUDGET_BYTES).expect("cooked");
    let pinned = cooked.table["pinned"].as_u64().expect("pinned");
    let cells = cooked.table["cells"].as_array().expect("cells");
    assert_eq!(cells.len(), 4);
    let mut objects = 0;
    for cell in cells {
        for object in cell["objects"].as_array().expect("objects") {
            let needs = object["dependencies"].as_array().expect("dependencies");
            let top = needs.iter().filter_map(Value::as_u64).any(|b| b < pinned);
            assert!(top, "{object} reaches the top");
            assert_eq!(object["roots"], json!([0]), "its own root bundle");
            objects += 1;
        }
    }
    assert_eq!(objects, instances.len(), "every object, both primitives");
    // The same in the DAG: from every object root, the groups above lead to a root of the world.
    let world = world_dag(&instances, &|| Ok(())).expect("world");
    for (slot, origin) in world.origins.iter().enumerate() {
        if origin.is_none() {
            continue;
        }
        let mut at = slot;
        while let Some(group) = world.clusters[at].group {
            at = world.groups[group].outputs[0];
        }
        assert!(world.clusters[at].is_root() && world.clusters[at].level > 0);
    }
}
