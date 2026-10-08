//! A root of the world one cell alone needs — a lone object's copy, a material one cell wears — is
//! held with its cell, never pinned; the tops several cells share pin, a top over the budget is
//! refused, its cell named and its content said, and an object the world build placed nothing for
//! ships with its own pages, told. On the synthetic world of `tests.rs`.
use super::decoded::decoded;
use super::pack::pack_world;
use super::tests::{cooked, covers, sizes, world};
use super::world::world_dag;
use super::*;
use crate::compiler_world::translation;
use crate::dag::DAG_GROUP_MAX;

/// The materials the island wears beside the lone ones: one the whole world shares, then one per
/// cell, from `REGIONAL`.
const SHARED: u64 = 1 << 40;
const REGIONAL: u64 = 1 << 41;

/// The world of `tiles` × `tiles` tiles shaped like an open island: per cell, a quarter of its
/// large plates wear the material the whole world shares, a quarter one of their cell's own,
/// every other primitive a material of its own.
fn island(covers: &[RootCover; 2], tiles: usize) -> Vec<Instance<'_>> {
    let mut instances = world(covers, tiles);
    for (rank, instance) in instances.iter_mut().enumerate() {
        instance.material = Some(match (instance.primitive, instance.node % 4) {
            (0, 0) => SHARED,
            (0, 1) => REGIONAL + instance.cell as u64,
            _ => rank as u64,
        });
    }
    instances
}

/// The table's `key` as a list.
fn list<'a>(table: &'a Value, key: &str) -> &'a Vec<Value> {
    table[key].as_array().expect(key)
}

/// Cooks `instances` over `cells` cells and asserts every root one cell alone needs lies past the
/// pinned top, in a bundle of that cell's roots alone, one run of them per cell right past the
/// top, each lone copy named by its object's list,
/// and every root several cells share in the pinned top; returns the pinned top's bytes, the
/// materials it pins and the copies.
fn cooked_held(instances: &[Instance], cells: usize) -> (u64, BTreeSet<Option<u64>>, usize) {
    let cooked = cooked(instances, cells, WORLD_TOP_BUDGET_BYTES).expect("within the budget");
    let table = decoded(&cooked);
    let world = world_dag(instances, &|| Ok(())).expect("world");
    let pinned = table["pinned"].as_u64().expect("pinned") as usize;
    let clusters = list(&table, "clusters");
    let objects: Vec<&Value> = (list(&table, "cells").iter())
        .flat_map(|cell| list(cell, "objects"))
        .collect();
    let (mut holds, mut materials, mut copies) = (BTreeMap::new(), BTreeSet::new(), 0);
    for slot in (0..world.clusters.len()).filter(|&slot| world.clusters[slot].is_root()) {
        let at = clusters[slot]["bundle"].as_u64().expect("written") as usize;
        let [cell] = world.cells[slot][..] else {
            assert!(at < pinned, "a top several cells share is pinned");
            materials.insert(world.materials[slot]);
            continue;
        };
        assert!(at >= pinned, "root {slot} of cell {cell} pinned");
        assert_eq!(*holds.entry(at).or_insert(cell), cell, "bundle {at}");
        // A lone copy: the output of a group whose one child is a placed object.
        let group = &world.groups[world.clusters[slot].source.expect("its group")];
        if let ([child], Some(_)) = (&group.children[..], world.origins[group.children[0]]) {
            let object = clusters[*child]["origin"].as_u64().expect("its object");
            let needs = list(objects[object as usize], "dependencies");
            assert!(needs.contains(&json!(at)), "object {object} needs {at}");
            copies += 1;
        }
    }
    // Every held root right past the pinned top, every level together, one run per cell.
    let bundles: Vec<usize> = holds.keys().copied().collect();
    assert_eq!(
        bundles,
        (pinned..pinned + bundles.len()).collect::<Vec<_>>()
    );
    let cells_held = holds.values().collect::<BTreeSet<_>>().len();
    let runs = (bundles.windows(2)).filter(|w| holds[&w[0]] != holds[&w[1]]);
    assert_eq!(
        runs.count() + 1,
        cells_held.max(1),
        "one run of bundles per cell"
    );
    let top = table["pinnedTopBytes"].as_u64().expect("top");
    (top, materials, copies)
}

#[test]
fn a_root_one_cell_needs_is_held_with_it_the_shared_tops_pinned() {
    let covers = covers();
    let (small, large) = (world(&covers, 2), world(&covers, 8));
    for instances in [&small, &large] {
        let alone: Vec<_> = (instances.iter().enumerate())
            .map(|(rank, i)| Instance {
                material: Some(rank as u64),
                ..*i
            })
            .collect();
        // Every object alone in its material: no top at all, each copy held by its cell.
        let (top, _, copies) = cooked_held(&alone, alone.len() / 32);
        assert_eq!(top, 0);
        assert!(copies >= alone.len(), "every object stands alone");
    }
    // Shaped like an island: the shared material alone pins its top; the regional and lone ones,
    // each worn in one cell, are held by it, whatever the cells.
    let (four, many) = (island(&covers, 2), island(&covers, 8));
    let ((top4, pinned4, copies4), (top64, pinned64, copies64)) =
        (cooked_held(&four, 4), cooked_held(&many, 64));
    assert_eq!(pinned4, BTreeSet::from([Some(SHARED)]));
    assert_eq!(
        pinned64, pinned4,
        "the regional and lone materials pin nothing"
    );
    assert!(
        copies64 >= 16 * copies4,
        "{copies4} copies in 4 cells, {copies64} in 64"
    );
    let page = sizes(&cooked(&many, 64, WORLD_TOP_BUDGET_BYTES).expect("64")).0 as u64;
    assert!(
        top4.max(top64) <= DAG_GROUP_MAX as u64 * page,
        "{top4}, {top64}"
    );
}

#[test]
fn an_object_the_world_build_placed_nothing_for_ships_its_own_pages_told() {
    let covers = covers();
    let instances = world(&covers, 2);
    // The world built without the last object, which it then packs among the placed ones.
    let world = world_dag(&instances[..instances.len() - 1], &|| Ok(())).expect("world");
    let cooked = pack_world(&world, &instances, 4, WORLD_TOP_BUDGET_BYTES).expect("cooked");
    let table = decoded(&cooked);
    let last = instances.last().expect("an object");
    assert_eq!(cooked.report["outsideWorld"], json!([last.node]));
    let objects = (list(&table, "cells").iter()).map(|cell| list(cell, "objects").len());
    assert_eq!(
        objects.sum::<usize>(),
        instances.len() - 1,
        "out of the table"
    );
}

#[test]
fn a_world_root_covering_no_cell_is_refused_by_name() {
    let covers = covers();
    let instances = world(&covers, 2);
    let mut world = world_dag(&instances, &|| Ok(())).expect("world");
    let root = (0..world.clusters.len())
        .find(|&slot| world.clusters[slot].is_root())
        .expect("a root");
    world.cells[root].clear();
    let error = pack_world(&world, &instances, 4, WORLD_TOP_BUDGET_BYTES)
        .err()
        .expect("refused");
    assert_eq!(error.code, "INVALID_WORLD_ROOTS");
    assert!(
        error.message.contains(&format!("World root {root} ")),
        "{}",
        error.message
    );
}

#[test]
fn a_world_whose_pinned_top_exceeds_the_budget_is_refused_naming_its_cell() {
    let covers = covers();
    let mut instances = world(&covers, 2);
    // Cell 3 shares a third material with cell 2 and a fourth with cell 1: their tops cover it
    // twice, so it pins the most.
    let shared = [
        (2, 7, 500.0),
        (3, 7, 1500.0),
        (1, 8, 1500.0),
        (3, 8, 1520.0),
    ];
    for (node, (cell, material, x)) in (96..).zip(shared) {
        instances.push(Instance {
            cell,
            node,
            slot: node,
            primitive: 2,
            material: Some(material),
            matrix: translation([x, 0.0, 1500.0]),
            cover: &covers[0],
        });
    }
    let fits = cooked(&instances, 4, WORLD_TOP_BUDGET_BYTES).expect("within the budget");
    let error = cooked(&instances, 4, sizes(&fits).1 - 1)
        .err()
        .expect("refused");
    assert_eq!(error.code, "WORLD_TOP_OVER_BUDGET");
    assert!(error.message.contains("cell 3 pins"), "{}", error.message);
    // What fills it: four material tops, one material in one layout each.
    assert!(
        error.message.contains("in 4 material tops (4 materials"),
        "{}",
        error.message
    );
}
