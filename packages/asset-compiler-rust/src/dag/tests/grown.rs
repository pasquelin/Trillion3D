//! The vertices a solve places (`grown.rs`).
use super::*;

// Behaviour: a solve that moved no vertex placed nothing: its clusters keep their numbers and no
// array is copied (`Grown::place`).
#[test]
fn a_solve_that_placed_nothing_copies_no_array() {
    let (positions, indices) = grid(2);
    let attributes = DagAttributes { carried: &[] };
    let mut welds = crate::dag::welds::Welds::of(&positions, attributes, &indices);
    let placed = crate::dag::grown::Placed {
        positions: Vec::new(),
        carried: Vec::new(),
        origins: Vec::new(),
        columns: crate::dag::welds::Columns::default(),
    };
    let mut clusters = vec![indices.clone()];
    let (mut grown, base) = (None, (positions.len() / 3) as u32);
    let source = (&positions[..], attributes);
    crate::dag::grown::Grown::place(&mut grown, source, &mut welds, placed, &mut clusters, base);
    assert!(grown.is_none());
    assert_eq!(clusters, [indices]);
}
