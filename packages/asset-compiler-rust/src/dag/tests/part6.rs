use super::*;
use crate::dag::border::{live_triangles, lock_triangles_touching, lost_locks, required_locks};

/// `grid` grid exploded into soup: three vertices per triangle, none shared. Form
/// of FBX whose attributes are written corner by corner, on which meshoptimizer
/// reduces nothing until positions welded.
fn soup(n: usize) -> (Vec<f32>, Vec<u32>) {
    let (positions, indices) = grid(n);
    let mut soup_positions = Vec::with_capacity(indices.len() * 3);
    for &id in &indices {
        soup_positions.extend_from_slice(&positions[id as usize * 3..id as usize * 3 + 3]);
    }
    (soup_positions, (0..indices.len() as u32).collect())
}

// Behavior: vertex soup ascends to single root — position welding
// takes over when raw reduction yields no fewer clusters —, and coarse levels
// cite only vertices retained by welding.
#[test]
fn a_vertex_soup_still_climbs_to_a_single_root() {
    let (positions, indices) = soup(64);
    let (dag, _, tallies) = build_of(&positions, &indices);
    let depth = dag.iter().map(|c| c.level).max().unwrap_or(0);
    assert!(depth > 0, "soup must have coarse levels");
    assert_eq!(dag.iter().filter(|c| c.is_root()).count(), 1, "single root");
    assert!(
        tallies.iter().any(|t| t.welded > 0),
        "at least one group had to weld"
    );
    let weld = weld_positions(&positions, &indices);
    for cluster in dag.iter().filter(|c| c.level > 0) {
        for &id in &cluster.indices {
            assert_eq!(
                weld[id as usize], id,
                "a coarse level cites the canonical copy"
            );
        }
    }
}

#[test]
fn lost_locks_lists_the_locked_vertices_that_vanished_by_welded_id() {
    // 0 and 3 welded; 0 locked and absent, but double 3 survives — nothing lost.
    let weld = [0u32, 1, 2, 0, 4];
    let locks = [true, false, true, false, true];
    let required = required_locks(&[0, 1, 2], &locks, &weld);
    assert_eq!(required, vec![0, 2]);
    assert_eq!(lost_locks(&required, &[3, 1], &weld), vec![2]);
    assert_eq!(
        lost_locks(&required_locks(&[0, 1, 4], &locks, &weld), &[1], &weld),
        vec![0, 4]
    );
}

#[test]
fn lock_triangles_touching_locks_every_corner_of_a_triangle_that_lost_a_lock() {
    // Two triangles; only first touches lost vertex 5 (via welded double 7).
    let weld = [0u32, 1, 2, 3, 4, 5, 6, 5];
    let source = [0u32, 1, 7, 2, 3, 4];
    let mut extra = vec![9];
    lock_triangles_touching(&source, &[5], &weld, &mut extra);
    assert_eq!(
        extra,
        vec![0, 1, 5, 9],
        "the three corners, welded, plus what was already there"
    );
}

#[test]
fn live_triangles_drops_a_triangle_with_two_corners_on_one_position() {
    let kept = live_triangles([0u32, 1, 2, 3, 3, 4, 5, 6, 5, 7, 8, 9].into_iter());
    assert_eq!(kept, vec![0, 1, 2, 7, 8, 9]);
}

// Behaviour: under the attribute strategy an unindexed soup climbs to a single root too, its
// stalled groups falling back on the (position, uv) weld exactly as the positional one does.
#[test]
fn a_vertex_soup_climbs_under_the_attribute_strategy() {
    let (positions, indices) = soup(64);
    let source = positions.len() / 3;
    let uvs: Vec<f32> = (0..source)
        .flat_map(|v| [positions[v * 3] / 64.0, positions[v * 3 + 1] / 64.0])
        .collect();
    let attributes = [Attribute {
        flag: crate::geometry_page::FLAG_UV,
        width: 2,
        values: uvs,
    }];
    let built = build_dag_tallied(
        DagVertices {
            positions: &positions,
            attributes: &attributes,
        },
        &indices,
        DagStrategy::QemAttributes,
        &|| Ok(()),
    )
    .expect("dag");
    assert_eq!(built.clusters.iter().filter(|c| c.is_root()).count(), 1);
    assert!(
        built.tallies.iter().any(|t| t.welded > 0),
        "the fallback weld was used"
    );
    let count = positions.len() / 3;
    for cluster in &built.clusters {
        assert!(cluster.indices.iter().all(|&id| (id as usize) < count));
    }
}

// Behaviour: a mirrored texture island is protected like a seam. Its two halves share the
// middle column — same position, same texture coordinate, opposite parameterisation — so
// nothing but the orientation of the chart tells the simplifier not to collapse across it. No
// coarse triangle may then span the mirror line, which is what folding the texture would look
// like (`mirror.rs`).
#[test]
fn a_mirrored_texture_island_keeps_the_edge_its_two_halves_share() {
    let n = 48usize;
    let half = n as f32 / 2.0;
    let (positions, indices) = grid(n);
    let uvs: Vec<f32> = positions
        .as_chunks::<3>()
        .0
        .iter()
        .flat_map(|[x, y, _]| [(x - half).abs() / half, y / n as f32])
        .collect();
    let attributes = [Attribute {
        flag: crate::geometry_page::FLAG_UV,
        width: 2,
        values: uvs,
    }];
    let built = build_dag_tallied(
        DagVertices {
            positions: &positions,
            attributes: &attributes,
        },
        &indices,
        DagStrategy::QemAttributes,
        &|| Ok(()),
    )
    .expect("dag");
    let coarse = built.clusters.iter().filter(|c| c.level > 0);
    assert!(coarse.clone().count() > 0, "the DAG did not climb");
    let side = |corner: u32| {
        positions[corner as usize * 3]
            .partial_cmp(&half)
            .expect("x")
    };
    for cluster in coarse {
        for corners in cluster.indices.as_chunks::<3>().0 {
            let sides: Vec<_> = corners.iter().map(|&c| side(c)).collect();
            assert!(
                !sides.iter().any(|s| s.is_lt()) || !sides.iter().any(|s| s.is_gt()),
                "a coarse triangle spans the mirror line"
            );
        }
    }
}
