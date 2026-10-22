//! The tree's queries: whether a ray escapes, the nearest point.
use super::{box_distance2, corner, crosses, Tree};
use trillion3d_math::geometry::ray_box::inverse;
use trillion3d_math::geometry::triangle::{closest_point, ray_triangle};
use trillion3d_math::vector::vecn::distance2;
use trillion3d_page_codec::proxy::bvh::Node;

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
        let mut stack = [0usize; 256];
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
        let line = (origin, ray, inverse(ray));
        let mut found = false;
        let mut enter = |node: &Node| crosses(node, line, (0.0, f64::INFINITY));
        self.walk(&mut enter, |slot| {
            found = ray_triangle(origin, ray, self.corners(slot), (0.0, f64::INFINITY)).is_some();
            found
        });
        found
    }

    /// The point of the triangles nearest `point` — where a vertex is projected back onto them —,
    /// the point itself on an empty tree: a best-first walk, nearer boxes first, pruning a box
    /// farther than the best so far, each triangle measured on its single-precision corners.
    pub fn closest(&self, point: [f64; 3]) -> [f64; 3] {
        self.nearest(point, f64::INFINITY).1.unwrap_or(point)
    }

    /// The squared distance from `point` to the triangles' nearest point, and that point, among
    /// those nearer than `limit2` (squared): `(limit2, None)` when none is.
    pub fn nearest(&self, point: [f64; 3], limit2: f64) -> (f64, Option<[f64; 3]>) {
        let box_distance = |node: &Node| box_distance2(node, point);
        let mut best: (f64, Option<[f64; 3]>) = (limit2, None);
        // Preorder depth is logarithmic: a fixed stack holds every pending node.
        let mut stack = [(0.0f64, 0usize); 256];
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

    /// The nearest triangle `origin + t·ray` meets for `0 < t < 1`, either face: `t` and its leaf
    /// slot.
    pub fn first_hit(&self, (origin, ray): ([f64; 3], [f64; 3])) -> Option<(f64, usize)> {
        let line = (origin, ray, inverse(ray));
        let best = std::cell::Cell::new(1.0f64);
        let mut found = None;
        let mut enter = |node: &Node| crosses(node, line, (0.0, best.get()));
        self.walk(&mut enter, |slot| {
            let hit = ray_triangle(origin, ray, self.corners(slot), (0.0, best.get()));
            if let Some((t, _)) = hit {
                best.set(t);
                found = Some((t, slot));
            }
            false
        });
        found
    }
}
