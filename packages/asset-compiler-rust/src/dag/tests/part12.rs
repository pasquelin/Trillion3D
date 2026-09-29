//! Seam-locked groups coarsen with solved vertices (`solved.rs`, `placed.rs`, `grown.rs`).
use super::*;
use crate::geometry_page::{Attribute, FLAG_NORMAL, FLAG_UV};

/// `island_per_quad(n)` with up normals, as the pages carry it.
fn sheet(n: usize) -> (Vec<f32>, Vec<Attribute>, Vec<u32>) {
    let (positions, uvs, indices) = island_per_quad(n);
    let normals = [0.0, 0.0, 1.0].repeat(positions.len() / 3);
    let carried = vec![
        Attribute {
            flag: FLAG_NORMAL,
            width: 3,
            values: normals,
        },
        Attribute {
            flag: FLAG_UV,
            width: 2,
            values: uvs,
        },
    ];
    (positions, carried, indices)
}

fn dag_of(positions: &[f32], carried: &[Attribute], indices: &[u32]) -> build::DagBuild {
    let carried: Vec<&Attribute> = carried.iter().collect();
    let attributes = DagAttributes { carried: &carried };
    let strategy = DagStrategy::QemEndpoints;
    build_dag_tallied(positions, attributes, indices, strategy, &|| Ok(())).expect("dag")
}

// Behaviour: a sheet whose every position is a seam corner no longer stalls seam-locked: its
// groups reduce on placed vertices, appended after the source's, which stay as they were.
#[test]
fn a_seam_locked_sheet_climbs_on_placed_vertices() {
    let (positions, carried, indices) = sheet(32);
    let (dag, _, _, stalls, grown) = dag_of(&positions, &carried, &indices);
    let grown = grown.expect("placed vertices");
    assert_eq!(grown.positions[..positions.len()], positions[..]);
    assert_eq!(
        grown.carried[1].values[..carried[1].values.len()],
        carried[1].values[..]
    );
    let seam_locked = stalls
        .iter()
        .filter(|s| s.outcome.cause == StallCause::SeamLocked);
    assert_eq!(seam_locked.count(), 0, "stalls {stalls:?}");
    assert_eq!(dag.iter().filter(|c| c.is_root()).count(), 1);
    let count = (grown.positions.len() / 3) as u32;
    assert!(dag.iter().flat_map(|c| &c.indices).all(|&v| v < count));
    quality::check(&dag, &grown.positions, Some(&grown.carried[0].values)).expect("cook check");
}

// Behaviour: a sheet under one texture chart reduces as before: no vertex placed, no group solved.
#[test]
fn an_unblocked_sheet_places_nothing() {
    let (positions, indices) = grid(32);
    let uvs = positions
        .chunks(3)
        .flat_map(|p| [p[0] / 32.0, p[1] / 32.0])
        .collect();
    let carried = [Attribute {
        flag: FLAG_UV,
        width: 2,
        values: uvs,
    }];
    let (.., grown) = dag_of(&positions, &carried, &indices);
    assert!(grown.is_none());
}

// Behaviour: a texture set weighs the surface length one unit of it spans: the same sheet under
// coordinates half as wide spans twice the surface per unit.
#[test]
fn a_texture_density_follows_its_coordinates() {
    let (positions, carried, indices) = sheet(8);
    let halved: Vec<f32> = carried[1].values.iter().map(|c| c * 0.5).collect();
    let density = |uvs: &[f32]| charts::densities(&positions, &[uvs], &indices)[0];
    let (full, half) = (density(&carried[1].values), density(&halved));
    assert!(
        full > 0.0 && (half / full - 2.0).abs() < 1e-5,
        "{full} then {half}"
    );
}

// Behaviour: a solved group publishes at least what `measured::step_error` measures from its
// children to its outputs on the grown arrays, its placed vertices included: the removed parts,
// the Hausdorff distance and the texture deviation, each placed vertex in its origin's island.
#[test]
fn a_solved_group_publishes_at_least_its_measured_step_error() {
    let (positions, carried, indices) = sheet(32);
    let (dag, groups, _, _, grown) = dag_of(&positions, &carried, &indices);
    let grown = grown.expect("placed vertices");
    let every: Vec<u32> = dag.iter().flat_map(|c| c.indices.iter().copied()).collect();
    let (grown_positions, uvs) = (&grown.positions[..], &grown.carried[1].values[..]);
    let weld = clusters::weld_positions(grown_positions, &every);
    let mut weld_seam = clusters::weld_positions_and_uv(grown_positions, &[uvs], &every);
    let source = positions.len() / 3;
    for (p, &origin) in grown.origin.iter().enumerate() {
        weld_seam[source + p] = weld_seam[origin as usize];
    }
    let extents = vanished::part_extents(grown_positions, &every, &weld);
    let surface = measured::Surface {
        positions: grown_positions,
        weld: &weld,
        weld_seam: &weld_seam,
        extents: &extents,
        uv_sets: vec![uvs],
    };
    let on_placed = |ids: &[usize]| {
        let indices = indices_of(&dag, ids);
        indices.iter().any(|&v| v as usize >= source)
    };
    let solved_groups = groups.iter().filter(|g| on_placed(&g.outputs));
    let mut checked = 0;
    for group in solved_groups {
        let children = indices_of(&dag, &group.children);
        let outputs = indices_of(&dag, &group.outputs);
        let measured = measured::step_error(&surface, &children, &outputs, 0.0, 0.0);
        assert!(
            group.error >= measured,
            "level {}: {} published below {measured}",
            group.level,
            group.error
        );
        checked += 1;
    }
    assert!(checked > 0, "no solved group");
}
