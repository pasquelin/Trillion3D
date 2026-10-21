//! The packing both scenes share: a tree's triangles in its leaf order about an origin, and a
//! tree's boxes recomputed from the corners as packed, so a box holds what the pass reads, not
//! what the CPU rounded. Positions and links are packed as the bake packs them
//! (`flatten/gpu/pack.rs`).
use super::layout::MAX_DEPTH;
use crate::hlod::flatten::gpu::pack::{local, pack_links};
use trillion3d_page_codec::proxy::bvh::Node;

/// The single-precision corners of a triangle as packed.
pub(crate) type Corners = [[f32; 3]; 3];

/// A box in single precision: its least and greatest corners.
pub(crate) type Box32 = ([f32; 3], [f32; 3]);

/// `nodes` refused when deeper than the walk's stack holds (`layout::MAX_DEPTH`).
pub(crate) fn check_depth(nodes: &[Node]) -> crate::Result<()> {
    crate::hlod::flatten::gpu::pack::check_depth(nodes, MAX_DEPTH, "a shell's tree")
}

/// Each of `count` triangles appended, its `corners` about `origin` (`layout::TRIANGLE_RECORDS`);
/// the corners returned as packed.
pub(crate) fn pack_triangles(
    out: &mut Vec<u32>,
    count: usize,
    corners: impl Fn(usize) -> [[f64; 3]; 3],
    origin: [f64; 3],
) -> Vec<Corners> {
    out.reserve(count * 12);
    let mut packed = Vec::with_capacity(count);
    for slot in 0..count {
        let own = corners(slot).map(|c| local(c, origin));
        for c in &own {
            out.extend(c.map(f32::to_bits));
            out.push(0);
        }
        packed.push(own);
    }
    packed
}

/// What a tree node holds below it, as `packed_boxes` reads it: its children's ranks, or a leaf's
/// slots in the triangles' leaf order.
pub(crate) enum Below<'a> {
    Children(&'a [u32]),
    Slots(std::ops::Range<usize>),
}

/// Per node of a tree of `count` nodes in preorder — each node's children after it —, what
/// `below` says it holds: the least box holding its triangles' `packed` corners; and the slack
/// every box is widened by, eight units in the last place of the largest corner — more than a
/// pass's own rounding of a distance, so a box never prunes the triangle it holds.
pub(crate) fn packed_boxes<'a>(
    count: usize,
    below: impl Fn(usize) -> Below<'a>,
    packed: &[Corners],
) -> (Vec<Box32>, f32) {
    let largest = (packed.iter().flatten().flatten()).fold(0.0f32, |m, x| m.max(x.abs()));
    let slack = 8.0 * f32::EPSILON * largest;
    // Children after their parent in preorder: each box from its children's, or its triangles'.
    let mut boxes = vec![([f32::INFINITY; 3], [f32::NEG_INFINITY; 3]); count];
    for at in (0..count).rev() {
        let mut own = ([f32::INFINITY; 3], [f32::NEG_INFINITY; 3]);
        let mut grow = |(low, high): Box32| {
            for k in 0..3 {
                own.0[k] = own.0[k].min(low[k]);
                own.1[k] = own.1[k].max(high[k]);
            }
        };
        match below(at) {
            Below::Slots(slots) => packed[slots].iter().flatten().for_each(|&c| grow((c, c))),
            Below::Children(kids) => kids.iter().for_each(|&kid| grow(boxes[kid as usize])),
        }
        boxes[at] = own;
    }
    (boxes, slack)
}

/// Each of `nodes` appended (`layout::BOX_NODE_RECORDS`): its box (`packed_boxes`), widened by
/// the slack, then its links.
pub(crate) fn pack_boxed_nodes(out: &mut Vec<u32>, nodes: &[Node], packed: &[Corners]) {
    let below = |at: usize| match nodes[at].children() {
        [] => Below::Slots(nodes[at].first..nodes[at].first + nodes[at].count),
        kids => Below::Children(kids),
    };
    let (boxes, slack) = packed_boxes(nodes.len(), below, packed);
    out.reserve(nodes.len() * 16);
    for (node, (low, high)) in nodes.iter().zip(boxes) {
        out.extend(low.map(|x| (x - slack).to_bits()));
        out.push(0);
        out.extend(high.map(|x| (x + slack).to_bits()));
        out.push(0);
        pack_links(out, node);
    }
}
