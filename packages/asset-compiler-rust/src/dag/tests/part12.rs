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
    let build::DagBuild {
        clusters: dag,
        tallies,
        stalls,
        grown,
        ..
    } = dag_of(&positions, &carried, &indices);
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
    assert!(GroupTally::total(&tallies).solved > 0);
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
    let build = dag_of(&positions, &carried, &indices);
    let (tallies, grown) = (build.tallies, build.grown);
    assert!(grown.is_none());
    assert_eq!(GroupTally::total(&tallies).solved, 0);
}

// Behaviour: a texture set weighs the surface length one unit of it spans: the same sheet under
// coordinates half as wide weighs its texture twice as much.
#[test]
fn a_texture_weight_follows_its_density() {
    let (positions, carried, indices) = sheet(8);
    let mut halved = carried.clone();
    halved[1].values.iter_mut().for_each(|c| *c *= 0.5);
    let weight = |carried: &[Attribute]| {
        let refs: Vec<&Attribute> = carried.iter().collect();
        let attributes = DagAttributes { carried: &refs };
        let welds = welds::Welds::of(&positions, attributes, &indices);
        let locks = vec![false; positions.len() / 3];
        let bound = quality::NORMAL_DEVIATION_BOUND;
        let weighted = attributes.weighted();
        let input = welds.input(&positions, attributes, &weighted, &locks, bound);
        charts::weighted(&input, &indices, &charts::densities(&input, &indices))[1].weight
    };
    let (full, half) = (weight(&carried), weight(&halved));
    assert!(
        full > 0.0 && (half / full - 2.0).abs() < 1e-5,
        "{full} then {half}"
    );
}

// Behaviour: the step a placed texture coordinate took from the one it was solved from, times
// its set's density, is what the group is charged for it: a coordinate that slid off its chart
// is never drawn under a smaller error than that slide.
#[test]
fn a_placed_coordinate_charges_its_slide() {
    let (positions, carried, indices) = sheet(16);
    let refs: Vec<&Attribute> = carried.iter().collect();
    let attributes = DagAttributes { carried: &refs };
    let welds = welds::Welds::of(&positions, attributes, &indices);
    let locks = vec![false; positions.len() / 3];
    let weighted = attributes.weighted();
    let bound = quality::NORMAL_DEVIATION_BOUND;
    let input = welds.input(&positions, attributes, &weighted, &locks, bound);
    let densities = charts::densities(&input, &indices);
    let region = crate::qem::solve::Region::of(&positions, &weighted, &indices).expect("region");
    let solved = region.solve(indices.len() / 6, &|_| 0).expect("reduced");
    let local = placed::Local::of(&input, solved, &densities);
    let placed = local.placed(&input, (positions.len() / 3) as u32);
    let uvs = &carried[1].values;
    let slide = placed.carried[1]
        .chunks(2)
        .enumerate()
        .map(|(k, uv)| {
            let g = local.from((local.n + k) as u32) * 2;
            f64::from(uv[0] - uvs[g]).hypot(f64::from(uv[1] - uvs[g + 1])) * densities[0]
        })
        .fold(0.0, f64::max);
    assert!(slide > 0.0, "a coordinate slid");
    assert_eq!(local.drift, slide);
}
