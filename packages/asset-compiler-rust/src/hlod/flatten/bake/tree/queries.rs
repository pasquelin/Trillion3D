//! The tree's queries: whether a ray escapes, the nearest triangle a ray meets, the nearest point.
use super::{box_distance2, corner, entered, Tree};
use trillion3d_math::geometry::ray_box::inverse;
use trillion3d_math::geometry::triangle::{closest_point, ray_triangle};
use trillion3d_math::vector::vecn::distance2;
use trillion3d_page_codec::proxy::bvh::Node;

/// The boxes a walk holds pending at most. Every child of a node holds a quarter of its
/// triangles, rounded up, or is a leaf of eight at most, so a tree over 2³² triangles has 15 levels
/// of nodes above its leaves; a walk holds, of each level above the node it is in, the siblings
/// still to enter (three at most), and that node's own children (four): under 50.
const PENDING: usize = 64;

/// Whether a meeting at `t` with the triangle `slot` beats `held`: it is nearer, or at the same `t`
/// from a lower slot, so the triangle that wins never depends on the order the walk reaches them in.
pub(super) fn beats(held: Option<(f64, usize)>, (t, slot): (f64, usize)) -> bool {
    held.is_none_or(|(best, at)| t < best || (t == best && slot < at))
}

impl<T: AsRef<[f32]>> Tree<T> {
    /// The three corners of leaf slot `slot`.
    pub fn corners(&self, slot: usize) -> [[f64; 3]; 3] {
        [0, 1, 2].map(|k| corner(self.triangles.as_ref(), slot, k))
    }

    /// The rank in the soup of the triangle at leaf slot `slot`.
    pub(crate) fn rank(&self, slot: usize) -> usize {
        self.order[slot]
    }

    /// Every leaf slot whose node box `enter` accepts, each node entered once, until `visit`
    /// returns `true`. Preorder depth is logarithmic: a fixed stack holds every pending node.
    fn walk(&self, enter: &mut dyn FnMut(&Node) -> bool, mut visit: impl FnMut(usize) -> bool) {
        if self.nodes.is_empty() {
            return;
        }
        let mut stack = [0usize; PENDING];
        let mut depth = 1;
        while depth > 0 {
            depth -= 1;
            let node = &self.nodes[stack[depth]];
            if !enter(node) {
                continue;
            }
            if node.children().is_empty() {
                for slot in node.first..node.first + node.count {
                    if visit(slot) {
                        return;
                    }
                }
            } else {
                for &child in node.children().iter().rev() {
                    stack[depth] = child as usize;
                    depth += 1;
                }
            }
        }
    }

    /// Whether `origin + t·ray` meets any triangle for `t > 0`.
    pub fn blocked(&self, (origin, ray): ([f64; 3], [f64; 3])) -> bool {
        let line = (origin, inverse(ray));
        let mut found = false;
        let mut enter = |node: &Node| entered(node, line, (0.0, f64::INFINITY)).is_some();
        self.walk(&mut enter, |slot| {
            found = ray_triangle(origin, ray, self.corners(slot), (0.0, f64::INFINITY)).is_some();
            found
        });
        found
    }

    /// The point of the triangles nearest `point` — where a vertex is projected back onto them —,
    /// the point itself on an empty tree.
    pub fn closest(&self, point: [f64; 3]) -> [f64; 3] {
        self.nearest(point, f64::INFINITY).1.unwrap_or(point)
    }

    /// The squared distance from `point` to the triangles' nearest point, and that point, among
    /// those nearer than `limit2` (squared): `(limit2, None)` when none is.
    pub fn nearest(&self, point: [f64; 3], limit2: f64) -> (f64, Option<[f64; 3]>) {
        let box_distance = |node: &Node| box_distance2(node, point);
        let mut best: (f64, Option<[f64; 3]>) = (limit2, None);
        // Preorder depth is logarithmic: a fixed stack holds every pending node.
        let mut stack = [(0.0f64, 0usize); PENDING];
        let mut depth = 0;
        if !self.nodes.is_empty() {
            stack[0] = (box_distance(&self.nodes[0]), 0);
            depth = 1;
        }
        while depth > 0 {
            depth -= 1;
            let (near, at) = stack[depth];
            if near >= best.0 {
                continue;
            }
            let node = &self.nodes[at];
            if node.children().is_empty() {
                for slot in node.first..node.first + node.count {
                    let [a, b, c] = self.corners(slot);
                    let p = closest_point(point, a, b, c);
                    let d = distance2(p, point);
                    if d < best.0 {
                        best = (d, Some(p));
                    }
                }
            } else {
                // The nearer children are entered first: they go on the stack last.
                let from = depth;
                for &c in node.children() {
                    let c = c as usize;
                    stack[depth] = (box_distance(&self.nodes[c]), c);
                    depth += 1;
                }
                stack[from..depth].sort_by(|x, y| y.0.total_cmp(&x.0));
            }
        }
        best
    }

    /// The nearest triangle `origin + t·ray` meets for `near < t < 1`, either face — `t` and its
    /// leaf slot —, but for the triangle at leaf slot `skip`: how a ray goes on
    /// past a surface it has met. The nearer boxes along the ray are entered first, so the first
    /// triangle met bounds the rest of the walk; of triangles met at the same `t`, the one at the
    /// lowest leaf slot is returned (`beats`).
    pub fn first_hit_beyond(
        &self,
        (origin, ray): ([f64; 3], [f64; 3]),
        near: f64,
        skip: Option<usize>,
    ) -> Option<(f64, usize)> {
        let line = (origin, inverse(ray));
        let root = self.nodes.first()?;
        let mut found: Option<(f64, usize)> = None;
        // The boxes still to enter and where the ray enters each, the nearest on top.
        let mut pending = [(0.0f64, 0u32); PENDING];
        pending[0].0 = entered(root, line, (near, 1.0))?;
        let mut depth = 1;
        while depth > 0 {
            depth -= 1;
            let (entry, at) = pending[depth];
            // A box entered beyond the nearest meeting holds no nearer one; at it, a tie.
            let reach = found.map_or(1.0, |(t, _)| t);
            if entry > reach {
                continue;
            }
            let node = &self.nodes[at as usize];
            if node.children().is_empty() {
                for slot in (node.first..node.first + node.count).filter(|&s| Some(s) != skip) {
                    let met = ray_triangle(origin, ray, self.corners(slot), (near, 1.0))
                        .map(|(t, _)| (t, slot))
                        .filter(|&met| beats(found, met));
                    found = met.or(found);
                }
            } else {
                let from = depth;
                for &child in node.children() {
                    if let Some(entry) = entered(&self.nodes[child as usize], line, (near, reach)) {
                        pending[depth] = (entry, child);
                        depth += 1;
                    }
                }
                // The nearest is entered first: it goes on the stack last.
                pending[from..depth].sort_unstable_by(|x, y| y.0.total_cmp(&x.0));
            }
        }
        found
    }
}
