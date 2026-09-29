//! The texture charts the solve of a seam-locked group reads (`charts.rs`).
use super::*;
use charts::folded_span;

// Behaviour: a face across two texture islands is charged its longest edge, one within one not.
#[test]
fn a_face_across_islands_is_charged_its_longest_edge() {
    let positions = [0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 1.0, 1.0, 0.0];
    let indices = [0, 1, 2, 1, 3, 2];
    let span = |island: u32| folded_span(&indices, &positions, &[0, 0, 0, island], |v| v as usize);
    assert_eq!(span(0), 0.0);
    assert_eq!(span(1), 2.0_f64.sqrt());
}

// Behaviour: a solve whose every survivor snapped back to its source placed nothing: its clusters
// keep their numbers and no array is copied (`Grown::place`).
#[test]
fn a_solve_that_placed_nothing_copies_no_array() {
    let (positions, indices) = grid(2);
    let attributes = DagAttributes { carried: &[] };
    let mut welds = welds::Welds::of(&positions, attributes, &indices);
    let mut reduction = GroupReduction {
        error: 0.0,
        sphere: [0.0; 4],
        clusters: vec![indices.clone()],
        source_rank: 0,
        relocked: false,
        placed: Some(grown::Placed {
            positions: Vec::new(),
            carried: Vec::new(),
            origins: Vec::new(),
            columns: welds::Columns::default(),
        }),
    };
    let (mut grown, base) = (None, (positions.len() / 3) as u32);
    grown::Grown::place(&mut grown, &mut welds, &mut reduction, base);
    assert!(grown.is_none());
    assert_eq!(reduction.clusters, [indices]);
}
