//! The ray-tracing file's tests share one set of builders: a cluster of the DAG, a soup of
//! triangles, the wide tree of a soup, and a node decoded back from its bytes.
use super::abi::RAY_TRACING_NODE_BYTES;
use super::attributes::TRIANGLE_ATTRIBUTE_BYTES;
use super::bvh::{build, Item};
use super::cut::CutTriangle;
use super::nodes::write_node;
use super::wide::{collapse, Wide, WideNode};
use crate::dag::DagCluster;
use crate::support::le::u32_at;
use crate::tests::random::Xorshift;

mod attributes;
mod cut;
mod file;
mod nodes;
mod stack;
mod walk;
mod word;
mod world;

/// A cluster of `indices` at `level` whose error is `lod_error` and its group's `parent_error`;
/// made by a group unless it is a finest one.
fn cluster(indices: Vec<u32>, (lod_error, parent_error): (f64, f64), made: bool) -> DagCluster {
    DagCluster::for_test(
        indices,
        usize::from(made),
        (lod_error, parent_error),
        (None, made.then_some(0)),
    )
}

/// `count` small triangles scattered in a cube of side 10.
fn soup(count: usize, seed: u64) -> Vec<CutTriangle> {
    let mut rng = Xorshift::new(seed);
    (0..count)
        .map(|rank| {
            let centre = [0; 3].map(|_| rng.unit() * 10.0);
            CutTriangle {
                corners: [0; 3].map(|_| centre.map(|c| c + rng.unit() - 0.5)),
                cluster: (rank / 7) as u32,
                triangle: (rank % 7) as u32,
                tag: 0,
                attributes: [0; TRIANGLE_ATTRIBUTE_BYTES],
            }
        })
        .collect()
}

fn wide_of(triangles: &[CutTriangle]) -> Wide {
    let items: Vec<Item> = triangles.iter().map(Item::of).collect();
    collapse(&build(&items, false))
}

/// A node as the file holds it.
struct Decoded {
    origin: [f32; 3],
    exponents: [i8; 3],
    mask: u8,
    child_base: usize,
    triangle_base: usize,
    metas: [u8; 8],
    steps: [[u8; 8]; 6],
}

fn decode(bytes: &[u8]) -> Decoded {
    assert_eq!(bytes.len(), RAY_TRACING_NODE_BYTES);
    let word = |at: usize| f32::from_le_bytes(bytes[at..at + 4].try_into().unwrap());
    Decoded {
        origin: [word(0), word(4), word(8)],
        exponents: [bytes[12] as i8, bytes[13] as i8, bytes[14] as i8],
        mask: bytes[15],
        child_base: u32_at(bytes, 16).unwrap() as usize,
        triangle_base: u32_at(bytes, 20).unwrap() as usize,
        metas: bytes[24..32].try_into().unwrap(),
        steps: std::array::from_fn(|k| bytes[32 + 8 * k..40 + 8 * k].try_into().unwrap()),
    }
}

/// The bytes of `node`.
fn node_of(node: &WideNode) -> Vec<u8> {
    let mut bytes = Vec::new();
    write_node(node, &mut bytes);
    bytes
}

impl Decoded {
    /// The box of the child in `slot`: `p + 2^e · q`.
    fn child_box(&self, slot: usize) -> ([f64; 3], [f64; 3]) {
        let at = |end: usize| {
            [0, 1, 2].map(|axis| {
                let scale = 2f64.powi(i32::from(self.exponents[axis]));
                f64::from(self.origin[axis]) + scale * f64::from(self.steps[3 * end + axis][slot])
            })
        };
        (at(0), at(1))
    }
}
