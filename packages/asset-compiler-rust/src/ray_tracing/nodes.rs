//! The bytes of the wide tree: a node (`RAY_TRACING_NODE_BYTES`) and a triangle
//! (`RAY_TRACING_TRIANGLE_BYTES`) as `rayTracing.bin` holds them, little-endian.
//!
//! A node is laid out in this order:
//! - the low corner of its box, `p` (three `f32`);
//! - the exponent `e` of each axis (three `i8`) and the mask of its internal children (a byte,
//!   bit `s` set for slot `s`): a child box is `p + 2^e · q` with `q` a byte, so the node's own
//!   box, at most 255 steps wide, is all it spans;
//! - the rank of its first internal child and of its first triangle (two `u32`);
//! - a meta byte for each slot: 0 for an empty one and for an internal child, which the mask says
//!   (its node is the one of rank `child_base` plus the internal children before its slot); for a
//!   leaf child, the count of its triangles (1 to `RAY_TRACING_LEAF_TRIANGLES`) from bit
//!   `RAY_TRACING_LEAF_COUNT_SHIFT` over its offset from the node's first triangle in the bits of
//!   `RAY_TRACING_LEAF_OFFSET_MASK`;
//! - the low corner of each child's box, x then y then z, a byte a slot, and then its high corner.
//!
//! A child box is rounded outwards: the low corner down, the high corner up.
use super::abi::{
    RAY_TRACING_LEAF_COUNT_SHIFT, RAY_TRACING_LEAF_OFFSET_MASK, RAY_TRACING_LEAF_TRIANGLES,
    RAY_TRACING_MIN_EXPONENT, RAY_TRACING_NODE_BYTES, RAY_TRACING_TRIANGLE_BYTES,
    RAY_TRACING_WIDTH,
};
use super::bvh::Box3;
use super::cut::CutTriangle;
use super::wide::{Slot, WideNode};

/// The largest quantised coordinate.
const STEPS: f64 = 255.0;

/// The exponent `e` of the least power of two that `STEPS` steps of `2^e` span `extent`, no less
/// than `RAY_TRACING_MIN_EXPONENT`, which a flat box gets: its scale is as good as any, its steps
/// being zero. The shader reads no less (`sceneTraceWgsl.ts`).
pub(super) fn exponent(extent: f64) -> i8 {
    if extent <= 0.0 {
        return RAY_TRACING_MIN_EXPONENT;
    }
    let mut e = (extent / STEPS).log2().ceil();
    // `log2` is rounded: make sure the steps reach.
    while 2f64.powf(e) * STEPS < extent {
        e += 1.0;
    }
    e.clamp(f64::from(RAY_TRACING_MIN_EXPONENT), 127.0) as i8
}

/// The coordinate `value` of a child's box, in steps of `scale` from `origin`, taken to a whole
/// step by `round`, held in a byte.
fn quantised(value: f32, origin: f32, scale: f64, round: fn(f64) -> f64) -> u8 {
    round((f64::from(value) - f64::from(origin)) / scale).clamp(0.0, STEPS) as u8
}

/// The meta byte of the child `child`.
fn meta(child: &Slot) -> u8 {
    match *child {
        Slot::Empty | Slot::Inner(_) => 0,
        Slot::Leaf { count, offset, .. } => {
            debug_assert!((1..=RAY_TRACING_LEAF_TRIANGLES).contains(&count));
            debug_assert!(offset <= usize::from(RAY_TRACING_LEAF_OFFSET_MASK));
            ((count as u8) << RAY_TRACING_LEAF_COUNT_SHIFT) | offset as u8
        }
    }
}

/// The mask of the node's internal children: bit `s` for slot `s`.
fn inner_mask(slots: &[Slot; RAY_TRACING_WIDTH]) -> u8 {
    (slots.iter().enumerate())
        .filter(|(_, child)| matches!(child, Slot::Inner(_)))
        .fold(0, |mask, (slot, _)| mask | 1 << slot)
}

/// Writes the bytes of the node `node` to the end of `out`.
pub(super) fn write_node(node: &WideNode, out: &mut Vec<u8>) {
    let start = out.len();
    let (origin, high) = node.bounds;
    let exponents = [0, 1, 2].map(|axis| exponent(f64::from(high[axis]) - f64::from(origin[axis])));
    for corner in origin {
        out.extend_from_slice(&corner.to_le_bytes());
    }
    out.extend(exponents.map(|e| e as u8));
    out.push(inner_mask(&node.slots));
    for link in [node.child_base, node.triangle_base] {
        out.extend_from_slice(&(link as u32).to_le_bytes());
    }
    out.extend(node.slots.iter().map(meta));
    // The low corners rounded down, the high corners up, an axis at a time.
    let rounds: [(bool, fn(f64) -> f64); 2] = [(false, f64::floor), (true, f64::ceil)];
    for (high_end, round) in rounds {
        let corner = |(low, high): Box3| if high_end { high } else { low };
        for axis in 0..3 {
            let scale = 2f64.powi(i32::from(exponents[axis]));
            out.extend(node.slots.iter().map(|child| {
                (child.bounds()).map_or(0, |bounds| {
                    quantised(corner(bounds)[axis], origin[axis], scale, round)
                })
            }));
        }
    }
    debug_assert_eq!(out.len() - start, RAY_TRACING_NODE_BYTES);
}

/// Writes the bytes of the triangle `triangle` to the end of `out`: its corners, its cluster and its
/// rank in the cluster, its tag (zero but in the world's directory).
pub(super) fn write_triangle(triangle: &CutTriangle, out: &mut Vec<u8>) {
    let start = out.len();
    for corner in triangle.corners.iter().flatten() {
        out.extend_from_slice(&corner.to_le_bytes());
    }
    for word in [triangle.cluster, triangle.triangle, triangle.tag] {
        out.extend_from_slice(&word.to_le_bytes());
    }
    debug_assert_eq!(out.len() - start, RAY_TRACING_TRIANGLE_BYTES);
}
