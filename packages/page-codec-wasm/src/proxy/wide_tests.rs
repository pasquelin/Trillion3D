//! The reference values of a wide node's child record (`trillion3d_math::golden`): its box on 8
//! bits per axis in its parent's, rounded outwards, then its links.

use super::{pack, Child};
use trillion3d_math::golden::{f32s, Twin, Value};

/// The child record's twin, checked with the compiler's others (`tests/twins.rs`).
pub(crate) fn twin() -> Twin {
    Twin {
        file: "proxy_child_box",
        name: "proxy_child_box",
        about: "a proxy BVH child record (asset-compiler-rust proxy/wide.rs pack; read by sdk-browser bounce nodeWgsl.ts proxyChild): per axis the child's bounds in its parent's span, times 255, floored low and ceiled high, a flat or non-finite axis the full width; word 0 low x, y, z and high x bytes, word 1 high y, z bytes, count and the presence bit, word 2 the offset",
        inputs: "parent low: 3 f32, parent high: 3 f32, child low: 3 f32, child high: 3 f32, count: u32, offset: u32",
        outputs: "3 u32",
        cases,
        compute: |v| {
            let f = |at: usize| [0, 1, 2].map(|c| v[at + c].f32());
            let child = Child {
                low: f(6),
                high: f(9),
                count: v[12].u32(),
                offset: v[13].u32(),
            };
            pack(&child, f(0), f(3)).map(Value::U32).to_vec()
        },
    }
}

/// Children inside, astride and outside their parent, flat and inverted axes, non-finite and
/// subnormal bounds, the widest count and offset.
fn cases() -> Vec<Vec<Value>> {
    let boxes: [[f32; 6]; 8] = [
        [0.0, 0.0, 0.0, 1.0, 1.0, 1.0],
        [-1.0, -2.0, -3.0, 4.0, 5.0, 6.0],
        [0.25, 0.5, 0.75, 0.375, 0.625, 0.875],
        [-0.0, 0.0, 1.0, 0.0, -0.0, 1.0],
        [2.0, 2.0, 2.0, -2.0, -2.0, -2.0],
        [-3.0e38, 0.0, f32::NAN, 3.0e38, f32::INFINITY, 1.0],
        [1e-45, -1e-40, 0.1, 2e-45, 1e-40, 0.1000001],
        [-10.0, 0.001, -0.5, 10.0, 0.002, 0.5],
    ];
    let mut cases = Vec::new();
    for parent in &boxes {
        for (k, child) in boxes.iter().enumerate() {
            let mut case = f32s(&[parent.as_slice(), child.as_slice()].concat());
            let links = [[0, 0], [255, 7], [1, u32::MAX >> 8], [9, u32::MAX]][k % 4];
            case.extend(links.map(Value::U32));
            cases.push(case);
        }
    }
    cases
}
