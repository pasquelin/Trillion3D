//! The hierarchy a triangle is searched as: its heap, its sub-triangles, its sample points.
use crate::displace::hierarchy::{hammersley, heap_pop, heap_push, sub_barycentrics, Node};

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
