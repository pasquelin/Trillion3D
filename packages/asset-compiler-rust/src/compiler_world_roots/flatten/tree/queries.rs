//! The tree's queries: the nearest hit a filter accepts, whether a ray escapes, what lies within
//! a radius, the nearest point.
use super::{box_distance2, corner, crosses, line_distance, Tree};
use trillion3d_math::ray_box::inverse;
use trillion3d_math::triangle::{closest_point, ray_triangle};
use trillion3d_math::vecn::distance2;
use trillion3d_page_codec::proxy::bvh::Node;
use trillion3d_page_codec::proxy::PROXY_CHILDREN;

impl<T: AsRef<[f32]>> Tree<T> {
    /// The three corners of leaf slot `slot`.
    pub fn corners(&self, slot: usize) -> [[f64; 3]; 3] {
        [0, 1, 2].map(|k| corner(self.triangles.as_ref(), slot, k))
    }

    /// The rank in the soup of the triangle at leaf slot `slot`.
    pub(super) fn rank(&self, slot: usize) -> usize {
        if self.order.is_empty() {
            slot
        } else {
            self.order[slot]
        }
    }

    /// Every leaf slot whose node box `enter` accepts, each node entered once, until `visit`
    /// returns `true`. Preorder depth is logarithmic: a fixed stack holds every pending node.
    fn walk(
        &self,
        enter: &mut dyn FnMut(usize, &Node) -> bool,
        mut visit: impl FnMut(usize) -> bool,
    ) {
        if self.nodes.is_empty() {
            return;
        }
        let mut stack = [0usize; 256];
        let mut depth = 1;
        while depth > 0 {
            depth -= 1;
            let at = stack[depth];
            let node = &self.nodes[at];
            if !enter(at, node) {
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

    /// The hit of `origin + t·ray` for `t` in `(−limit, limit)`, `t ≠ 0`, nearest the origin, that
    /// `keep` accepts from the triangle's rank in the soup and the barycentric weights of its
    /// second and third corners: its signed distance `t`, rank and weights. Of two hits as near, one
    /// ahead (`t > 0`) wins over one behind, then the lower leaf slot: the same hit whatever order
    /// the walk meets them in. The walk enters the nearer children first and skips a box whose
    /// nearest point along the line lies farther than the best hit so far.
    pub fn nearest(
        &self,
        (origin, ray): ([f64; 3], [f64; 3]),
        limit: f64,
        keep: &dyn Fn(usize, [f64; 2]) -> bool,
    ) -> Option<(f64, usize, [f64; 2])> {
        let inverse = inverse(ray);
        let root = self
            .nodes
            .first()
            .and_then(|n| line_distance(n, origin, inverse))?;
        // The best hit ranked by its distance, behind after ahead, then its slot.
        type Ranked = ((f64, bool, usize), (f64, usize, [f64; 2]));
        let mut best: Option<Ranked> = None;
        // Preorder depth is logarithmic: a fixed stack holds every pending node.
        let mut stack = [(0.0f64, 0usize); 256];
        stack[0] = (root, 0);
        let mut depth = 1;
        while depth > 0 {
            depth -= 1;
            let (near, at) = stack[depth];
            let open = best.as_ref().map_or(limit, |(rank, _)| rank.0);
            if near > open {
                continue;
            }
            let node = &self.nodes[at];
            if node.children().is_empty() {
                for slot in node.first..node.first + node.count {
                    // Closed at the best's distance: a tie may still win on its side or slot.
                    let bound = best.as_ref().map_or(limit, |(rank, _)| rank.0.next_up());
                    let corners = self.corners(slot);
                    let Some((t, weights)) = ray_triangle(origin, ray, corners, (-bound, bound))
                    else {
                        continue;
                    };
                    let rank = (t.abs(), t < 0.0, slot);
                    let better = match &best {
                        None => t.abs() < limit,
                        Some((held, _)) => rank < *held,
                    };
                    if t != 0.0 && better && keep(self.rank(slot), weights) {
                        best = Some((rank, (t, self.rank(slot), weights)));
                    }
                }
            } else {
                // The nearer children are entered first: they go on the stack last, a tie in
                // preorder.
                let mut children = [(0.0f64, 0usize); PROXY_CHILDREN];
                let mut count = 0;
                for &c in node.children() {
                    let c = c as usize;
                    if let Some(near) = line_distance(&self.nodes[c], origin, inverse) {
                        if near <= open {
                            children[count] = (near, c);
                            count += 1;
                        }
                    }
                }
                children[..count].sort_by(|x, y| x.0.total_cmp(&y.0));
                for &child in children[..count].iter().rev() {
                    stack[depth] = child;
                    depth += 1;
                }
            }
        }
        best.map(|(_, hit)| hit)
    }

    /// Whether `origin + t·ray` meets any triangle for `t > 0`.
    pub fn blocked(&self, (origin, ray): ([f64; 3], [f64; 3])) -> bool {
        let line = (origin, ray, inverse(ray));
        let mut found = false;
        let mut enter = |_: usize, node: &Node| crosses(node, line, (0.0, f64::INFINITY));
        self.walk(&mut enter, |slot| {
            found = ray_triangle(origin, ray, self.corners(slot), (0.0, f64::INFINITY)).is_some();
            found
        });
        found
    }

    /// Whether `point` lies nearer than `radius(rank)` to some triangle, `reach[node]` the
    /// largest radius under each node.
    pub fn within(&self, point: [f64; 3], radius: &dyn Fn(usize) -> f64, reach: &[f64]) -> bool {
        let mut found = false;
        let mut enter =
            |at: usize, node: &Node| box_distance2(node, point, false) < reach[at] * reach[at];
        self.walk(&mut enter, |slot| {
            let [a, b, c] = self.corners(slot);
            let r = radius(self.rank(slot));
            found = distance2(closest_point(point, a, b, c), point) < r * r;
            found
        });
        found
    }

    /// The point of the triangles nearest `point` — where a vertex is projected back onto them —,
    /// the point itself on an empty tree.
    pub fn closest(&self, point: [f64; 3]) -> [f64; 3] {
        self.nearest_within(point, f64::INFINITY, None)
            .map_or(point, |(_, p)| p)
    }

    /// The squared distance from `point` to the nearest triangle nearer than `max`, and its point
    /// — a best-first walk, nearer boxes first, pruning a box farther than the best so far —: each
    /// triangle measured on its single-precision corners, or with `corners` on the corners it
    /// gives by the triangle's rank in the soup — the boxes, rounded to single precision, then
    /// widened by one unit in the last place. `None` when none lies nearer.
    pub fn nearest_within(
        &self,
        point: [f64; 3],
        max: f64,
        corners: Option<&dyn Fn(usize) -> [[f64; 3]; 3]>,
    ) -> Option<(f64, [f64; 3])> {
        let widen = corners.is_some();
        let box_distance = |node: &Node| box_distance2(node, point, widen);
        let mut best: (f64, Option<[f64; 3]>) = (max * max, None);
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
                    let [a, b, c] = match corners {
                        Some(corners) => corners(self.rank(slot)),
                        None => self.corners(slot),
                    };
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
        best.1.map(|p| (best.0, p))
    }

    /// Per node, the largest of `value(rank)` over its triangles.
    pub fn node_max(&self, value: &dyn Fn(usize) -> f64) -> Vec<f64> {
        let mut out = vec![0.0f64; self.nodes.len()];
        for at in (0..self.nodes.len()).rev() {
            let node = &self.nodes[at];
            out[at] = if node.children().is_empty() {
                (node.first..node.first + node.count)
                    .map(|slot| value(self.rank(slot)))
                    .fold(0.0, f64::max)
            } else {
                node.children()
                    .iter()
                    .map(|&c| out[c as usize])
                    .fold(0.0, f64::max)
            };
        }
        out
    }
}
