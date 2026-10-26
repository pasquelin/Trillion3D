use super::*;
use crate::compiler::pages::record::{geometry_record, page_record};

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

// Behaviour: the climb of a carrier over the roots of its instances' parts is charged for every
// instance's copy of them — 65,535 instances of a part that ends in 128 triangles hold about eight
// million triangles — not as the one triangle of its placeholder.
#[test]
fn a_carriers_climb_is_charged_for_every_instance() {
    let instances = 65_535;
    let one = of_counts(1, 3).expect("fits").working;
    let root = (DAG_CLUSTER_TRIANGLES, DAG_CLUSTER_TRIANGLES + 2);
    let climb = climb_working(std::iter::repeat_n(root, instances));
    // At least the DAG's index lists over every level: 24 bytes per triangle.
    assert!(climb >= 24 * DAG_CLUSTER_TRIANGLES * instances, "{climb}");
    let room = 256 << 20;
    assert!(one < room && climb > room, "{one} {climb}");
    assert_eq!(climb_working([(usize::MAX, 3)]), usize::MAX);
}

// Behaviour: a count whose cost cannot be represented is refused, never wrapped.
#[test]
fn an_overflowing_count_is_refused() {
    assert_eq!(of_counts(usize::MAX, 3), None);
}

// Behaviour: the collider cook and the page packing are charged inside the primitive, beside
// the DAG they both read.
#[test]
fn the_collider_and_the_packing_are_charged_with_the_dag() {
    let triangles = 1_000_000;
    let cost = of_counts(triangles, 600_000).expect("fits");
    let clusters = 2 * triangles.div_ceil(DAG_CLUSTER_TRIANGLES);
    let beside = triangles * COLLIDER_TRIANGLE_BYTES + clusters * PACKING_CLUSTER_BYTES;
    let dag = 2 * triangles * 3 * size_of::<u32>() + clusters * size_of::<DagCluster>();
    assert!(cost.working >= dag + beside, "{cost:?}");
    // Two Hausdorff grids at least: a link and a cell per triangle each.
    assert!(COLLIDER_TRIANGLE_BYTES >= 2 * (4 + size_of::<([i64; 3], Vec<u32>)>()));
}

// Behaviour: what one worker is charged holds a full collider tile with Jolt's own cook of it
// (1,175,616 bytes of heap at peak for 4096 triangles), not the Rust side alone.
#[test]
fn a_worker_charge_holds_a_full_tile_and_its_jolt_cook() {
    const JOLT_FULL_TILE_PEAK: usize = 1_175_616;
    const {
        assert!(TILE_TRIANGLES * JOLT_TRIANGLE_BYTES >= JOLT_FULL_TILE_PEAK);
        assert!(WORKER_BYTES >= TILE_BYTES && WORKER_BYTES >= PAGE_ENCODE_BYTES);
        assert!(WORKER_BYTES >= JOLT_FULL_TILE_PEAK + TILE_TRIANGLES * 3 * size_of::<u32>());
    }
}

/// Entries of every object, array values of every array, texts, and the longest key of `value`.
fn shape(value: &Value, into: &mut (usize, usize, usize, usize)) {
    match value {
        Value::Object(map) => {
            into.0 += map.len();
            for (key, field) in map {
                into.3 = into.3.max(key.len());
                shape(field, into);
            }
        }
        Value::Array(items) => {
            into.1 += items.len();
            items.iter().for_each(|item| shape(item, into));
        }
        Value::String(text) => into.2 += text.len(),
        _ => {}
    }
}

// Behaviour: the page-record constants are those of the record the compiler writes.
#[test]
fn page_constants_are_the_page_record() {
    let pos = [0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0];
    let grid = trillion3d_page_codec::bits::grid::PageGrid::at(4);
    let packed =
        trillion3d_page_codec::encode::encode(&[0, 1, 2], &pos, &[], grid).expect("encode");
    let cluster = DagCluster {
        indices: vec![0, 1, 2],
        level: 1,
        lod_error: 0.5,
        parent_error: 1.0,
        sphere: [0.0; 4],
        whole_box: None,
        parent_sphere: [0.0; 4],
        source_rank: 0,
        group: Some(0),
        source: Some(0),
    };
    // The record as the job keeps it: placed in its bundle.
    let mut record = page_record(
        (0, &cluster),
        ([0.0; 3], [1.0; 3]),
        geometry_record(&packed, 3),
    );
    record["stream"] = 0.into();
    record["streamOffset"] = 0.into();
    record["geometry"]["residentOffset"] = 0.into();
    let mut found = (0, 0, 0, 0);
    shape(&record, &mut found);
    let role = record["role"].as_str().expect("role").len();
    assert_eq!(found, (PAGE_ENTRIES, PAGE_ARRAY_VALUES, role, KEY_BYTES));
}

// Behaviour: a primitive whose displacement is baked is charged for the triangles the tessellation
// may make under its cap, whatever the counts it was read at, its source's indices apart; the baked
// arrays a voxelized mesh keeps are in what stays; a map held is charged per texel, once each.
#[test]
fn a_primitive_that_bakes_is_charged_for_its_cap() {
    let cap = 1_000_000;
    let plain = of_counts(1_000, 600).expect("fits");
    let baked = of_baked_counts(1_000, 600, 0, cap).expect("fits");
    let at_the_cap = of_counts(cap, 600 + cap / 2).expect("fits");
    assert!(
        baked.working >= at_the_cap.working,
        "{baked:?} {at_the_cap:?}"
    );
    assert!(
        baked.retained > at_the_cap.retained,
        "the arrays a voxel stage reads stay"
    );
    assert_eq!(baked.indices, plain.indices);
    // A mesh already past the cap is not tessellated: it is charged as it is.
    let past = of_baked_counts(12_000_000, 6_000_000, 0, cap).expect("fits");
    assert!(past.working >= of_counts(12_000_000, 6_000_000).expect("fits").working);
    // The decode of the largest map joins the tessellation's peak.
    let with_map = of_baked_counts(cap, cap / 2, 1 << 26, cap).expect("fits");
    assert!(with_map.working >= of_baked_counts(cap, cap / 2, 0, cap).expect("fits").working);
    assert_eq!(maps_bytes([2, 3]), Some(5 * MAP_TEXEL_BYTES));
    assert_eq!(maps_bytes([usize::MAX]), None);
}

// Behaviour: the cap follows the room: the charge at the cap the room allows fits the room, one
// triangle more does not, and a room that holds the most the tessellation makes lets it make it. A
// bake charged at the cap of no room would refuse every job that names a height map.
#[test]
fn the_cap_of_a_bake_follows_the_room_it_is_charged_in() {
    for share in [1 << 20, 64 << 20, 1 << 30] {
        let cap = bake_cap(share, 1);
        let at = |cap| of_baked_counts(cap, cap, 0, cap).expect("fits");
        assert!(
            at(cap).working <= share && at(cap).retained <= share,
            "{share}"
        );
        assert!(
            cap == MAX_TRIANGLES || at(cap + 1).working > share || at(cap + 1).retained > share
        );
    }
    assert!(bake_cap(64 << 20, 1) < bake_cap(1 << 30, 1));
    assert_eq!(bake_cap(usize::MAX, 1), MAX_TRIANGLES);
    // The records of every primitive that bakes stay: a hundred share the room one has.
    assert!(bake_cap(1 << 30, 100) < bake_cap(1 << 30, 1));
    assert_eq!(bake_cap(0, 1), 0);
}
