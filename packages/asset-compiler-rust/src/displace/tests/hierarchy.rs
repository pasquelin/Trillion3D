//! The hierarchy a triangle is searched as: its heap, its sub-triangles, its sample points.
use crate::displace::hierarchy::{
    hammersley, heap_pop, heap_push, snapped, sub_barycentrics, Node,
};

fn node(error_max: f32) -> Node {
    Node {
        error_min: 0.0,
        error_max,
        x: 0,
        y: 0,
        flipped: false,
        level: 0,
    }
}

#[test]
fn the_heap_gives_the_greatest_bound_first() {
    let mut heap = Vec::new();
    for bound in [3.0, 1.0, 2.0, 5.0, 4.0] {
        heap_push(&mut heap, node(bound));
    }
    let mut order = Vec::new();
    while !heap.is_empty() {
        order.push(heap_pop(&mut heap).error_max);
    }
    assert_eq!(order, vec![5.0, 4.0, 3.0, 2.0, 1.0]);
}

#[test]
fn a_sub_triangle_is_a_quarter_upright_or_flipped() {
    let whole = sub_barycentrics(0, 0, false, 1);
    assert_eq!(whole, [[0.0, 0.0, 1.0], [0.0, 1.0, 0.0], [1.0, 0.0, 0.0]]);
    let corner = sub_barycentrics(0, 0, false, 2);
    assert_eq!(corner, [[0.0, 0.0, 1.0], [0.0, 0.5, 0.5], [0.5, 0.0, 0.5]]);
    let middle = sub_barycentrics(0, 0, true, 2);
    assert_eq!(middle, [[0.0, 0.5, 0.5], [0.5, 0.5, 0.0], [0.5, 0.0, 0.5]]);
}

#[test]
fn the_first_sample_of_the_sequence_lies_inside_the_triangle() {
    assert_eq!(hammersley(0, 1), [0.25, 0.5, 0.25]);
    for i in 0..16 {
        let [x, y, z] = hammersley(i, 16);
        assert!(x >= 0.0 && y >= 0.0 && z >= 0.0, "{i}: {x} {y} {z}");
    }
}

/// An equilateral triangle of side 1, its area; a point of weight `w` on the corner opposite an
/// edge lies `2 · w · area` from it.
const AREA: f32 = 0.433_012_7;
const SIDES: [f32; 3] = [1.0; 3];
/// How near an edge a sample may lie.
const NEAR: f32 = 0.05;

#[test]
fn a_sample_far_from_every_edge_is_kept_as_it_is() {
    let kept = snapped([1.0 / 3.0; 3], (&SIDES, AREA, &[false; 3]), NEAR);
    assert_eq!(kept, Some([1.0 / 3.0; 3]));
}

#[test]
fn a_sample_near_an_edge_that_cannot_be_flipped_moves_onto_it() {
    // 0.0087 from edge 0, which cannot be flipped; the others are far and may be.
    let moved = snapped(
        [0.5, 0.49, 0.01],
        (&SIDES, AREA, &[false, true, true]),
        NEAR,
    );
    let [a, b, on] = moved.expect("moved onto the edge");
    assert!(
        (a - 0.5 / 0.99).abs() < 1e-6 && (b - 0.49 / 0.99).abs() < 1e-6,
        "{a} {b}"
    );
    assert_eq!(on, 0.0);
}

#[test]
fn a_sample_near_an_edge_that_can_be_flipped_is_dropped() {
    assert_eq!(
        snapped([0.5, 0.49, 0.01], (&SIDES, AREA, &[true; 3]), NEAR),
        None
    );
}

#[test]
fn a_sample_that_moves_to_a_corner_between_two_unflippable_edges_is_dropped() {
    // Edge 0 is the nearest; onto it the sample lies 0.0175 from edge 1, which cannot be flipped
    // either.
    assert_eq!(
        snapped([0.02, 0.97, 0.01], (&SIDES, AREA, &[false; 3]), NEAR),
        None
    );
}
