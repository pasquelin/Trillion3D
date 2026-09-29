use super::*;
use crate::compiler_page_object::{geometry_record, page_record};

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
    assert!(TILE_TRIANGLES * JOLT_TRIANGLE_BYTES >= JOLT_FULL_TILE_PEAK);
    assert!(WORKER_BYTES >= TILE_BYTES && WORKER_BYTES >= BUNDLE_BYTES);
    assert!(WORKER_BYTES >= JOLT_FULL_TILE_PEAK + TILE_TRIANGLES * 3 * size_of::<u32>());
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
    let packed = crate::geometry_page::encode(&[0, 1, 2], &pos, &[], -4, 0).expect("encode");
    let digest = "0".repeat(64);
    let cluster = DagCluster {
        indices: vec![0, 1, 2],
        level: 1,
        lod_error: 0.5,
        parent_error: 1.0,
        sphere: [0.0; 4],
        parent_sphere: [0.0; 4],
        replacement: Some(0),
        source_rank: 0,
        group: Some(0),
        source: Some(0),
    };
    let record = page_record(
        (0, &cluster),
        (&digest, 12),
        ([0.0; 3], [1.0; 3]),
        [0.0, 0.0, 1.0, 0.5],
        geometry_record(&digest, &packed, 3),
        (0, 0),
    );
    let mut found = (0, 0, 0, 0);
    shape(&record, &mut found);
    let role = record["role"].as_str().expect("role").len();
    assert_eq!(
        found,
        (
            PAGE_ENTRIES,
            PAGE_ARRAY_VALUES,
            PAGE_TEXT_BYTES + role,
            KEY_BYTES
        )
    );
}
