//! What both programs pack alike: values as the shaders read them, positions about a scene's
//! origin in single precision, a record's rank, a tree's depth checked against its walk's, a tree
//! node's links.
use super::failed;
use super::layout::NONE;
use trillion3d_page_codec::proxy::bvh::Node;
use trillion3d_page_codec::proxy::PROXY_CHILDREN;

/// A value as the shaders read it: its single-precision bits.
pub(crate) fn float(x: f64) -> u32 {
    (x as f32).to_bits()
}

/// `p` about `origin`, in single precision.
pub(crate) fn local(p: [f64; 3], origin: [f64; 3]) -> [f32; 3] {
    std::array::from_fn(|k| (p[k] - origin[k]) as f32)
}

/// The `vec4` rank the next record of `words` takes.
pub(crate) fn base(words: &[u32]) -> u32 {
    (words.len() / 4) as u32
}

/// The edges from the root to the deepest leaf of a tree of `count` nodes in preorder, its
/// children after it, `children(at)` naming node `at`'s.
pub(crate) fn depth<'a>(count: usize, children: impl Fn(usize) -> &'a [u32]) -> usize {
    let mut below = vec![0usize; count];
    for at in (0..count).rev() {
        below[at] = (children(at).iter())
            .map(|&kid| below[kid as usize] + 1)
            .max()
            .unwrap_or(0);
    }
    below.first().copied().unwrap_or(0)
}

/// `nodes`, `what`, refused when deeper than a walk's `deepest` edges.
pub(crate) fn check_depth(nodes: &[Node], deepest: usize, what: &str) -> crate::Result<()> {
    let depth = depth(nodes.len(), |at| nodes[at].children());
    if depth > deepest {
        return Err(failed(format!(
            "{what} is {depth} deep, past the walk's {deepest}"
        )));
    }
    Ok(())
}

/// A node's children padded with `NONE`, then a leaf's first slot and count: the last two records
/// of every tree node.
pub(crate) fn pack_links(out: &mut Vec<u32>, node: &Node) {
    let kids = node.children();
    out.extend((0..PROXY_CHILDREN).map(|k| kids.get(k).copied().unwrap_or(NONE)));
    let span = if kids.is_empty() {
        [node.first as u32, node.count as u32]
    } else {
        [0, 0]
    };
    out.extend([span[0], span[1], 0, 0]);
}
