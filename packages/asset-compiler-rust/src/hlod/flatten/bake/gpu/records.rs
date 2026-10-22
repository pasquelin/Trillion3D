//! The records every scene holds of its sources, as the compute passes read them, positions taken
//! about the sources' centre so single precision keeps the detail of a cell far from the scene's
//! origin: the tree over them, their corners and their attributes, in the tree's leaf order.
use super::layout::{ATTRIBUTE_RECORDS, CORNER_RECORDS, MAX_DEPTH, NODE_RECORDS};
use crate::hlod::flatten::gpu::layout::NONE;
use crate::hlod::flatten::gpu::pack::{base, check_depth, local, pack_links};
use crate::trace::surface::Traceable;
use trillion3d_page_codec::proxy::{bvh::Node, PROXY_LEAF_TRIANGLES};

/// The bytes a source triangle holds as words while the process packs them, until they go up: its
/// corners, its attributes and its share of the tree over the sources — a node over
/// `PROXY_LEAF_TRIANGLES / 2` triangles at most, the room the tree's builder makes —; a `vec4` of
/// four words a record.
pub(crate) const SOURCE_WORD_BYTES: usize =
    16 * (CORNER_RECORDS + ATTRIBUTE_RECORDS + NODE_RECORDS * 2 / PROXY_LEAF_TRIANGLES);

/// Each node about `origin` (`layout::NODE_RECORDS`): its box, its children padded with `NONE`, a
/// leaf's first slot and count — an empty tree one leaf of none.
pub(super) fn pack_nodes(out: &mut Vec<u32>, nodes: &[Node], origin: [f64; 3]) {
    if nodes.is_empty() {
        out.extend([0; 8]);
        out.extend([NONE; 4]);
        out.extend([0; 4]);
        return;
    }
    out.reserve(nodes.len() * NODE_RECORDS * 4);
    for node in nodes {
        for bound in [node.low, node.high] {
            out.extend(local(bound.map(f64::from), origin).map(f32::to_bits));
            out.push(0);
        }
        pack_links(out, node);
    }
}

/// Each source triangle's corners about `origin`, the first corner's fourth word its surface's
/// rank (`layout::CORNER_RECORDS`).
fn pack_corners(out: &mut Vec<u32>, sources: &Traceable, origin: [f64; 3]) {
    for t in 0..sources.corners.len() {
        for k in 0..3 {
            let p = crate::trace::tracer::vertex(&sources.world, t, k);
            out.extend(local(p, origin).map(f32::to_bits));
            out.push(if k == 0 { sources.world.tags[t] } else { 0 });
        }
    }
}

/// Each source triangle's attributes (`layout::ATTRIBUTE_RECORDS`): normals, the first's fourth
/// word whether it has them and the second's whether it has colours; both sets' coordinates;
/// colours.
fn pack_attributes(out: &mut Vec<u32>, sources: &Traceable) {
    for corner in &sources.corners {
        let normals = corner.normals.unwrap_or_default();
        for (k, flag) in [corner.normals.is_some(), corner.colours.is_some(), false]
            .into_iter()
            .enumerate()
        {
            out.extend(normals[k * 3..k * 3 + 3].iter().map(|x| x.to_bits()));
            out.push(u32::from(flag));
        }
        let [set0, set1] = &corner.uv;
        out.extend(set0.iter().chain(set1).map(|x| x.to_bits()));
        let colours = corner.colours.unwrap_or([1.0; 12]);
        out.extend(colours.iter().map(|x| x.to_bits()));
    }
}

/// `sources` appended to `out` about its centre, the tree `nodes` over them — in the tree's leaf
/// order, as `tree::order_sources` leaves them — first, then their corners and their attributes;
/// the `vec4` bases of the three. Refused when the tree is deeper than the walk's stack holds
/// (`MAX_DEPTH`).
pub(super) fn pack_sources(
    out: &mut Vec<u32>,
    sources: &Traceable,
    nodes: &[Node],
) -> crate::Result<[u32; 3]> {
    check_depth(nodes, MAX_DEPTH, "the tree over its sources")?;
    let origin = sources.centre;
    let nodes_at = base(out);
    pack_nodes(out, nodes, origin);
    let corners_at = base(out);
    pack_corners(out, sources, origin);
    let attributes_at = base(out);
    pack_attributes(out, sources);
    Ok([nodes_at, corners_at, attributes_at])
}
