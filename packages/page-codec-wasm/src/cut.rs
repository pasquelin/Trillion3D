//! Node walk of the CPU cut: the descent of `traverse` in
//! `packages/sdk-browser/src/page/cut/visit.ts`, outside the forcing fallback, without its pages.
//!
//! It pops the same stack in the same order, runs the same node tests (`cut_error.rs`) and writes
//! each leaf it reaches as the stack entry that reached it — `node << 2 | settled << 1 | inside` —
//! in visiting order. The caller then takes that leaf's pages exactly where the JavaScript descent
//! would have taken them: the node tests read nothing a page decides, so moving them ahead changes
//! no order and no answer.
//!
//! Anything outside the domain it can reproduce to the bit — an index outside the hierarchy, a
//! non-integer child range, a node popped twice, a full stack or leaf list, parameters the
//! JavaScript projection refuses — is a `Bail`: the caller then runs the JavaScript descent from
//! the start, which throws, loops or reads what it always did. Nothing was written to the cut.

use crate::cut_error::{
    frustum_clip_box, node_ceiling_error, subtree_decision, Lens, BOUND_STRIDE,
};

/// Smallest node stride the manifest allows (`cullingNodes`): box, sphere, ceiling, children, pages.
pub const MIN_STRIDE: usize = 15;

/// What a walk counted, beside the leaves it wrote.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Walk {
    pub leaves: usize,
    pub nodes_tested: u32,
    pub frustum_rejected: u32,
}

/// The walk left its domain: the JavaScript descent must run instead.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Bail;

/// A child range `[first, first + children)` read from a node, if it names whole nodes that exist.
fn child_range(first: f64, children: f64, count: usize) -> Option<(usize, usize)> {
    let whole = |x: f64| x >= 0.0 && x.fract() == 0.0 && x < count as f64;
    if !whole(first) || !whole(children) || first + children > count as f64 {
        return None;
    }
    Some((first as usize, children as usize))
}

/// The descent of `traverse` over `nodes` (`stride` floats each) and their `bounds`, from node 0.
/// `stack` is the JavaScript stack's capacity, `leaves` the output list.
pub fn walk(
    nodes: &[f64],
    stride: usize,
    bounds: &[f64],
    lens: &Lens,
    stack: &mut [u32],
    leaves: &mut [u32],
) -> Result<Walk, Bail> {
    if stride < MIN_STRIDE || stack.is_empty() {
        return Err(Bail);
    }
    let count = nodes.len() / stride;
    if count == 0 || bounds.len() < count * BOUND_STRIDE || count > (u32::MAX >> 2) as usize {
        return Err(Bail);
    }
    let mut out = Walk {
        leaves: 0,
        nodes_tested: 0,
        frustum_rejected: 0,
    };
    let mut popped = 0usize;
    let mut top = 1usize;
    stack[0] = 0;
    while top > 0 {
        top -= 1;
        let entry = stack[top];
        // A tree pops each node once: more pops than nodes is a cycle or a shared child.
        popped += 1;
        if popped > count {
            return Err(Bail);
        }
        let node = (entry >> 2) as usize;
        let base = node * stride;
        let mut inside = entry & 1 == 1;
        let mut settled = entry & 2 == 2;
        if !inside || !settled {
            out.nodes_tested += 1;
        }
        if !inside {
            let clipped = frustum_clip_box(&lens.planes, &nodes[base..base + 6]);
            if clipped == 0 {
                out.frustum_rejected += 1;
                continue;
            }
            inside = clipped == 2;
        }
        if !settled {
            let bound = nodes[base + 10];
            let cut = if lens.exact {
                bound == 0.0
            } else {
                bound >= 0.0
                    && node_ceiling_error(bound, nodes, base + 6, lens).map_err(|_| Bail)?
                        <= lens.pixel_error
            };
            if cut {
                continue;
            }
            let decision = subtree_decision(bounds, node, lens).map_err(|_| Bail)?;
            if decision < 0 {
                continue;
            }
            settled = decision > 0;
        }
        let children = nodes[base + 12];
        if children > 0.0 {
            let (first, children) = child_range(nodes[base + 11], children, count).ok_or(Bail)?;
            if top + children > stack.len() {
                return Err(Bail);
            }
            let flag = u32::from(inside) | u32::from(settled) << 1;
            for child in 0..children {
                stack[top] = ((first + child) as u32) << 2 | flag;
                top += 1;
            }
            continue;
        }
        if out.leaves == leaves.len() {
            return Err(Bail);
        }
        leaves[out.leaves] = (node as u32) << 2 | u32::from(inside) | u32::from(settled) << 1;
        out.leaves += 1;
    }
    Ok(out)
}

#[cfg(test)]
#[path = "cut_tests.rs"]
mod cut_tests;
