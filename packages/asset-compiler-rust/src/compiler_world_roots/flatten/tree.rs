//! The bake's spatial queries over a triangle soup, on the one tree the compiler builds over
//! triangles (`trillion3d_page_codec::proxy::bvh`): the nearest hit of a ray a filter accepts —
//! the sample a ray along the normal reads (`bake::project`) —, whether a ray escapes, whether a
//! point lies within a per-triangle distance — the shell a thin part is thickened by —, and the
//! nearest point of the triangles.
use crate::surface_trace::Traceable;
use trillion3d_math::ray_box::{inverse, ray_aabb};
use trillion3d_math::triangle::{closest_point, ray_triangle};
use trillion3d_math::vec3::point;
use trillion3d_math::vecn::{add, distance2, scale};
use trillion3d_page_codec::proxy::bvh::{build_ordered, Node};
use trillion3d_page_codec::proxy::PROXY_CHILDREN;

/// A tree over triangles: its nodes in preorder, and its leaves' triangles in leaf order, owned
/// or borrowed, each named by its rank in the soup it was built from (`order`).
pub(crate) struct Tree<T = Vec<f32>> {
    pub nodes: Vec<Node>,
    /// Nine floats per triangle, in leaf order.
    pub triangles: T,
    /// Per leaf slot, the triangle's rank in the soup; empty when each slot is its own rank
    /// (`order_sources`).
    pub order: Vec<usize>,
}

/// `sources`' triangles, materials and corners reordered into the leaf order of the tree built on
/// them, in place of a copy: the tree's nodes, each slot then its triangle's rank (`Tree::over`),
/// and per slot the rank its triangle had before. Its primitives' ranges are left as they were: a
/// bake's sources hold none (`sources::traceable`).
pub(super) fn order_sources(sources: &mut Traceable) -> (Vec<Node>, Vec<usize>) {
    let world = &mut sources.world;
    let (nodes, order) = build_ordered(&mut world.triangles, &mut world.tags);
    let mut corners = std::mem::take(&mut sources.corners);
    sources.corners = (order.iter())
        .map(|&rank| std::mem::take(&mut corners[rank]))
        .collect();
    (nodes, order)
}

impl<'a> Tree<&'a [f32]> {
    /// The tree `nodes` over `sources` as `order_sources` left them, their triangles borrowed.
    pub fn over(nodes: Vec<Node>, sources: &'a Traceable) -> Self {
        Self {
            nodes,
            triangles: &sources.world.triangles,
            order: Vec::new(),
        }
    }
}

/// Corner `corner` of the triangle at leaf slot `slot`.
fn corner(triangles: &[f32], slot: usize, corner: usize) -> [f64; 3] {
    point(triangles, (slot * 3 + corner) as u32)
}

/// The squared distance from `point` to `node`'s box, its sides pushed out by `widen` one unit in
/// the last place of single precision: what the nearest walk prunes a node by (`nearest_within`).
fn box_distance2(node: &Node, point: [f64; 3], widen: bool) -> f64 {
    (0..3)
        .map(|k| {
            let (low, high) = (f64::from(node.low[k]), f64::from(node.high[k]));
            let slack = if widen {
                f64::from(f32::EPSILON) * low.abs().max(high.abs())
            } else {
                0.0
            };
            let d = (low - slack - point[k])
                .max(0.0)
                .max(point[k] - high - slack);
            d * d
        })
        .sum::<f64>()
}

/// How far along the line `origin + t·ray`, `inverse` its direction's reciprocal, the nearest
/// point of `node`'s box lies from the origin, `|t|`, on either side — zero when the origin's
/// part of the line crosses it —, `None` when the line misses it: the slab test, each axis in
/// order, a NaN distance passed over by `min` and `max` (`ray_aabb`).
fn line_distance(node: &Node, origin: [f64; 3], inverse: [f64; 3]) -> Option<f64> {
    let (mut entry, mut exit) = (f64::NEG_INFINITY, f64::INFINITY);
    for axis in 0..3 {
        let near = (f64::from(node.low[axis]) - origin[axis]) * inverse[axis];
        let far = (f64::from(node.high[axis]) - origin[axis]) * inverse[axis];
        entry = entry.max(near.min(far));
        exit = exit.min(near.max(far));
    }
    if entry > exit {
        None
    } else if entry > 0.0 {
        Some(entry)
    } else if exit < 0.0 {
        Some(-exit)
    } else {
        Some(0.0)
    }
}

/// Whether `origin + t·ray`, `inverse` its direction's reciprocal, crosses `node`'s box for `t`
/// in `[from, to]`: the slab test from the point at `from`.
fn crosses(
    node: &Node,
    (origin, ray, inverse): ([f64; 3], [f64; 3], [f64; 3]),
    (from, to): (f64, f64),
) -> bool {
    let start = add(origin, scale(ray, from));
    ray_aabb(
        node.low.map(f64::from),
        node.high.map(f64::from),
        start,
        inverse,
        to - from,
    )
}

impl Tree {
    /// The tree of `soup`, nine floats per triangle, taken: its triangles reordered into leaf
    /// order in place of a copy.
    pub fn from_soup(mut triangles: Vec<f32>) -> Self {
        let mut tags = vec![0u32; triangles.len() / 9];
        let (nodes, order) = build_ordered(&mut triangles, &mut tags);
        Self {
            nodes,
            triangles,
            order,
        }
    }
}

impl<T: AsRef<[f32]>> Tree<T> {
    /// The three corners of leaf slot `slot`.
    pub fn corners(&self, slot: usize) -> [[f64; 3]; 3] {
        [0, 1, 2].map(|k| corner(self.triangles.as_ref(), slot, k))
    }

    /// The rank in the soup of the triangle at leaf slot `slot`.
    fn rank(&self, slot: usize) -> usize {
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

/// The triangle `t` of an indexed mesh, its corners as `f64`.
pub(super) fn triangle_of(positions: &[f32], indices: &[u32], t: usize) -> [[f64; 3]; 3] {
    [0, 1, 2].map(|k| point(positions, indices[t * 3 + k]))
}

/// The soup of an indexed mesh: nine floats per triangle.
pub(super) fn soup(positions: &[f32], indices: &[u32]) -> Vec<f32> {
    indices
        .iter()
        .flat_map(|&v| {
            let v = v as usize;
            [positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]]
        })
        .collect()
}
