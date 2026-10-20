//! The world's HLOD on a synthetic world. A tile is 1 km square and holds 4 × 4 objects, each a
//! bumped plate lying down and a smaller one standing, two primitives of two materials, their source
//! covers taken from their real DAG. The world is 2 × 2 tiles, one HLOD 0 cell per tile.
use super::world::world_dag;
use super::*;
use crate::dag::{build_dag, DagAttributes};
use trillion3d_math::matrix::translation;
use trillion3d_math::vecn::{length, sub};

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

/// The source cover of the primitive DAG of `mesh`.
fn cover((positions, indices): (Vec<f32>, Vec<u32>)) -> SourceCover {
    let strategy = DagStrategy::QemEndpoints;
    let attributes = DagAttributes::default();
    let dag = build_dag(&positions, attributes, &indices, strategy, &|| Ok(()))
        .expect("dag")
        .clusters;
    SourceCover::of(strategy, &dag, (&positions, &[]), None)
}

pub(super) fn covers() -> [SourceCover; 2] {
    [cover(plate(16, 12.0, false)), cover(plate(8, 4.0, true))]
}

/// A world of `tiles` × `tiles` tiles, one cell each: every object places both covers.
pub(super) fn world(covers: &[SourceCover; 2], tiles: usize) -> Vec<Instance<'_>> {
    let mut instances = Vec::new();
    for cell in 0..tiles * tiles {
        let corner = [(cell % tiles) as f64 * TILE, (cell / tiles) as f64 * TILE];
        for object in 0..SIDE * SIDE {
            let step = TILE / SIDE as f64;
            let at = [(object % SIDE) as f64 * step, (object / SIDE) as f64 * step];
            let matrix = translation([corner[0] + at[0], 0.0, corner[1] + at[1]]);
            for (primitive, cover) in covers.iter().enumerate() {
                let material = Some(primitive as u64);
                instances.push(Instance {
                    hlod: cell,
                    material,
                    matrix,
                    cover,
                });
            }
        }
    }
    instances
}

/// The chain over `cells` HLOD 0 cells: one HLOD 1 cell over them all, one HLOD 2 cell over it.
pub(super) fn tree(cells: usize) -> Vec<HlodNode> {
    // Each level a cell of the chain's layer of that rank (`fixtures::hlod_chain`).
    let node = |parent, level| HlodNode {
        parent,
        level,
        layer: Some(level),
        shown: [0.0, 0.0, 0.0, 1.0, 1.0, 1.0],
    };
    let mut tree: Vec<HlodNode> = (0..cells).map(|_| node(Some(cells), 0)).collect();
    tree.push(node(Some(cells + 1), 1));
    tree.push(node(None, 2));
    tree
}

/// Builds a world of `instances`' materials, their atlases cooked under a scratch cache.
pub(super) fn built<T>(instances: &[Instance], run: impl FnOnce(&world::Builder) -> T) -> T {
    let cache = crate::tests::directories::scratch("world-roots", "atlas");
    let o = crate::tests::fixtures::options(cache.clone(), cache);
    let materials: BTreeSet<Option<u64>> = instances.iter().map(|i| i.material).collect();
    let source = (&json!({}), &[][..], Path::new("."));
    let library = flatten::Library::new(source, &materials, (&o, 0)).expect("the library");
    let hlod = crate::tests::fixtures::hlod_chain();
    let builder = world::Builder {
        checkpoint: &|| Ok(()),
        library: &library,
        o: &o,
        hlod: &hlod,
        room: o.ram_budget_bytes(),
    };
    run(&builder)
}

pub(super) fn cooked(instances: &[Instance], cells: usize) -> Result<Cooked> {
    built(instances, |builder| cook(instances, &tree(cells), builder)).map(|(cooked, _)| cooked)
}

#[test]
fn errors_stay_monotone_across_the_hlod() {
    let covers = covers();
    let instances = world(&covers, 2);
    let chain = tree(4);
    let (world, actors, failures, _) =
        built(&instances, |builder| world_dag(&instances, &chain, builder)).expect("world");
    // Each cell of the layer below has its actor or its failure with the reason, never both and
    // never neither: a shell that cannot be made is reported with its reason, never lost unsaid.
    let mut cells: Vec<(usize, usize)> =
        (actors.iter().map(|a| (chain[a.cell].actor_level(), a.cell)))
            .chain(failures.iter().map(|&(layer, cell, _)| (layer, cell)))
            .collect();
    cells.sort_unstable();
    let expected: Vec<(usize, usize)> = (0..4).map(|c| (1, c)).chain([(2, 4), (3, 5)]).collect();
    assert_eq!(
        cells, expected,
        "each cell's actor or failure, once: {failures:?}"
    );
    assert!(
        failures.iter().all(|(_, _, reason)| !reason.is_empty()),
        "each failure says why"
    );
    assert!(!actors.is_empty(), "actors are built");
    for &(_, cell, _) in &failures {
        assert!(!world.cells.contains(&cell), "a failed cell holds no root");
    }
    assert!(
        actors.iter().all(|a| a.images().len() == 3),
        "each wears its flattened material"
    );
    assert!(
        !world.groups.is_empty(),
        "the actors' geometry is simplified"
    );
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
        let apart = length(sub([s[0], s[1], s[2]], [p[0], p[1], p[2]]));
        let slack = p[3] * 1e-6 + 1e-6;
        assert!(apart + s[3] <= p[3] + slack, "{s:?} out of {p:?}");
    }
    for group in &world.groups {
        let actor = world.actors[group.outputs[0]];
        assert!(group.children.iter().all(|&c| world.actors[c] == actor));
    }
}
