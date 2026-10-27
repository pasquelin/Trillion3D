//! The wide tree holds every triangle in one leaf, every box around its child, and a single item
//! in one node.
use super::{decode, node_of, soup, wide_of};
use crate::ray_tracing::abi::{RAY_TRACING_LEAF_COUNT_SHIFT, RAY_TRACING_LEAF_TRIANGLES};
use crate::ray_tracing::nodes::exponent;
use crate::ray_tracing::wide::Slot;

#[test]
fn every_triangle_is_in_one_leaf_and_every_box_holds_its_child() {
    let triangles = soup(500, 0x5eed);
    let wide = wide_of(&triangles);
    let mut seen = wide.triangles.clone();
    seen.sort_unstable();
    assert_eq!(seen, (0..500).collect::<Vec<_>>());
    let mut leaf_triangles = 0;
    let mut inner_slots = 0;
    for node in &wide.nodes {
        let decoded = decode(&node_of(node));
        let mut inner = 0;
        for (slot, child) in node.slots.iter().enumerate() {
            let Some((low, high)) = child.bounds() else {
                assert_eq!(decoded.metas[slot], 0);
                assert_eq!((decoded.mask >> slot) & 1, 0);
                continue;
            };
            let (box_low, box_high) = decoded.child_box(slot);
            for axis in 0..3 {
                assert!(box_low[axis] <= f64::from(low[axis]));
                assert!(box_high[axis] >= f64::from(high[axis]));
            }
            match *child {
                Slot::Inner(_) => {
                    // The mask alone says it: its meta is the empty slot's.
                    assert_eq!(decoded.metas[slot], 0);
                    assert_eq!((decoded.mask >> slot) & 1, 1);
                    // Its node lies where the base and the count of the inner slots before say.
                    let held = &wide.nodes[node.child_base + inner];
                    assert_eq!(held.bounds, (low, high));
                    inner += 1;
                    inner_slots += 1;
                }
                Slot::Leaf { count, offset, .. } => {
                    assert!((1..=RAY_TRACING_LEAF_TRIANGLES).contains(&count));
                    assert_eq!(
                        decoded.metas[slot],
                        ((count as u8) << RAY_TRACING_LEAF_COUNT_SHIFT) | offset as u8
                    );
                    assert_eq!((decoded.mask >> slot) & 1, 0);
                    leaf_triangles += count;
                }
                Slot::Empty => unreachable!("an empty slot has no box"),
            }
        }
        assert_eq!(decoded.child_base, node.child_base);
        assert_eq!(decoded.triangle_base, node.triangle_base);
    }
    assert_eq!(leaf_triangles, 500);
    assert_eq!(inner_slots + 1, wide.nodes.len());
}

#[test]
fn a_flat_or_a_single_item_tree_is_one_node() {
    let one = soup(1, 3);
    let wide = wide_of(&one);
    assert_eq!(wide.nodes.len(), 1);
    assert_eq!(wide.triangles, [0]);
    assert_eq!(exponent(0.0), -127);
    assert!(2f64.powi(i32::from(exponent(255.0))) * 255.0 >= 255.0);
    assert!(2f64.powi(i32::from(exponent(1e-9))) * 255.0 >= 1e-9);
}
