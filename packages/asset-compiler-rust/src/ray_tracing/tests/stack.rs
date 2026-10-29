//! The walk's stack: a tree is written only if a walk of it holds the stack the shader has, the
//! compiler splits in halves a tree whose cheapest cuts need more, and the need is the one the
//! shader's traversal has (`wideTraversalWgsl.ts`).
use super::{soup, wide_of};
use crate::ray_tracing::abi::{RAY_TRACING_STACK, RAY_TRACING_WIDTH};
use crate::ray_tracing::attributes::TRIANGLE_ATTRIBUTE_BYTES;
use crate::ray_tracing::bvh::{build, Item};
use crate::ray_tracing::cut::CutTriangle;
use crate::ray_tracing::tree::within_stack;
use crate::ray_tracing::wide::{collapse, stack_need, Slot, Wide, WideNode};

/// A wide tree of the shape `children`: `children[k]` is the number of internal children of node
/// `k`, whose internal children are the next nodes in order, as the collapse lays them.
fn shaped(children: &[usize]) -> Wide {
    let bounds = ([0.0; 3], [1.0; 3]);
    let mut next = 1;
    let nodes = children
        .iter()
        .map(|&inner| {
            let mut slots = [Slot::Empty; RAY_TRACING_WIDTH];
            slots[..inner].fill(Slot::Inner(bounds));
            let child_base = next;
            next += inner;
            WideNode {
                bounds,
                child_base,
                triangle_base: 0,
                slots,
            }
        })
        .collect();
    Wide {
        nodes,
        triangles: Vec::new(),
    }
}

#[test]
fn the_need_is_the_internal_children_but_one_along_the_worst_path() {
    // A leaf node needs none; a node of one internal child keeps nothing for it.
    assert_eq!(stack_need(&shaped(&[0])), 0);
    assert_eq!(stack_need(&shaped(&[1, 0])), 0);
    // Three internal children: two wait while the walk goes into the third.
    assert_eq!(stack_need(&shaped(&[3, 0, 0, 0])), 2);
    // The root keeps one (two internal children); the first of them three more less one.
    assert_eq!(stack_need(&shaped(&[2, 4, 0, 0, 0, 0, 0])), 1 + 3);
    // Eight internal children at every level of a chain of three: seven waits a level.
    let full = shaped(&[8, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    assert_eq!(stack_need(&full), 7 + 7);
}

#[test]
fn a_tree_the_compiler_writes_needs_no_more_than_the_shader_stack_holds() {
    for (count, seed) in [(1, 1), (3, 2), (500, 3), (20_000, 4)] {
        let items: Vec<Item> = soup(count, seed).iter().map(Item::of).collect();
        let (_, wide) = within_stack(&items, RAY_TRACING_STACK).expect("within the stack");
        let need = stack_need(&wide);
        assert!(need <= RAY_TRACING_STACK, "{count} triangles need {need}");
    }
    // Split in halves, 20 000 triangles need no more than the stack the shader holds.
    let balanced = |count: usize| {
        let wide = collapse(&build(
            &soup(count, 9).iter().map(Item::of).collect::<Vec<_>>(),
            true,
        ));
        stack_need(&wide)
    };
    assert!(balanced(20_000) <= RAY_TRACING_STACK);
}

#[test]
fn a_tree_needing_more_is_split_in_halves_or_refused() {
    let items: Vec<Item> = soup(2000, 5).iter().map(Item::of).collect();
    let cheapest = stack_need(&wide_of(&soup(2000, 5)));
    // Room for the cheapest cuts: the tree is theirs.
    let (binary, wide) = within_stack(&items, cheapest).expect("room for the cheapest");
    assert_eq!(stack_need(&wide), cheapest);
    assert_eq!(binary.nodes.len(), build(&items, false).nodes.len());
    // Room for the halves alone: a line of triangles spaced ever wider, each a hundredth of its
    // distance from the origin, whose cheapest cuts peel them one by one, deeper than its halves;
    // the halves are taken.
    let line: Vec<Item> = (0..200)
        .map(|k| {
            let x = 1.1f32.powi(k);
            let side = 0.01 * x;
            let corners = [[x, 0.0, 0.0], [x + side, 0.0, 0.0], [x, side, 0.0]];
            Item::of(&CutTriangle {
                corners,
                cluster: k as u32,
                triangle: 0,
                tag: 0,
                attributes: [0; TRIANGLE_ATTRIBUTE_BYTES],
            })
        })
        .collect();
    let [deepest, halves] =
        [false, true].map(|halved| stack_need(&collapse(&build(&line, halved))));
    assert!(halves < deepest, "halves {halves}, cheapest {deepest}");
    let (binary, wide) = within_stack(&line, halves).expect("room for the halves");
    assert_eq!(stack_need(&wide), halves);
    assert_eq!(binary.nodes.len(), build(&line, true).nodes.len());
    // Room for nothing: refused.
    let refused = within_stack(&items, 0)
        .err()
        .expect("refused with no stack");
    assert_eq!(refused.code, "RAY_TRACING_TREE_TOO_DEEP");
    assert!(
        refused.message.contains("2000 triangles"),
        "{}",
        refused.message
    );
}
