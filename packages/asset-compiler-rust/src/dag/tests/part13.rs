//! The texture charts the solve of a seam-locked group reads (`charts.rs`).
use super::*;
use charts::{folded_span, Chart};

// Behaviour: where a chart meets its mirror image — a sheet whose coordinates run back from its
// middle column — that column's positions are mirror vertices, and only those.
#[test]
fn a_mirror_column_is_found() {
    let (positions, indices) = grid(8);
    let uvs: Vec<f32> = positions
        .chunks(3)
        .flat_map(|p| [4.0 - (p[0] - 4.0).abs(), p[1]])
        .collect();
    let weld = clusters::weld_positions(&positions, &indices);
    let found = charts::vertex_charts(&weld, &weld, &[&uvs], &indices);
    let mirrors: Vec<bool> = found.iter().map(|c| charts::on_mirror(c.sides)).collect();
    let column: Vec<bool> = (0..positions.len() / 3).map(|v| v % 9 == 4).collect();
    assert_eq!(mirrors, column);
}

// Behaviour: a face whose corners lie in two texture islands is charged its longest edge, and so,
// when the solve crosses mirrors, is one whose corners' charts turn both ways; any other is not.
#[test]
fn a_face_across_islands_or_a_crossed_mirror_is_charged_its_longest_edge() {
    let positions = [0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 1.0, 1.0, 0.0];
    let indices = [0, 1, 2, 1, 3, 2];
    let span = |sides: u8, island: u32, mirrors: bool| {
        let chart = |v: u32| match v {
            3 => Chart { sides, island },
            _ => Chart {
                sides: 1,
                island: 0,
            },
        };
        folded_span(&indices, &positions, chart, mirrors)
    };
    let diagonal = 2.0_f64.sqrt();
    assert_eq!(span(1, 0, true), 0.0);
    assert_eq!(span(1, 1, false), diagonal);
    assert_eq!(span(2, 0, true), diagonal);
    assert_eq!(span(2, 0, false), 0.0);
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
            charts: Vec::new(),
        }),
    };
    let (mut grown, base) = (None, (positions.len() / 3) as u32);
    grown::Grown::place(
        &mut grown,
        &positions,
        attributes,
        &mut welds,
        &mut reduction,
        base,
    );
    assert!(grown.is_none());
    assert_eq!(reduction.clusters, [indices]);
}
