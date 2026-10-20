//! The field the approximation solidifies: the sum over the scene's parts of each one's value —
//! the generalized winding number of a solid part (Jacobson et al. 2013), evaluated fast by a
//! tree (Barill et al. 2018: a node far enough, `β = 2` times its radius, read as its dipole, a
//! near triangle by its exact solid angle), one inside the shell a thin part is thickened by.
//! Each closed part has its own tree: its winding number is zero outside the box that holds it,
//! so a point reads only the closed parts whose boxes hold it, and a far part costs nothing; the
//! open solids share one tree.
use super::tree::Tree;
use trillion3d_math::aabb::{aabb_of, merge_aabb};
use trillion3d_math::vec3::cross;
use trillion3d_math::vecn::{dot, length, sub};

/// Barill's accuracy: a node is read as its dipole past `BETA` times its radius.
const BETA: f64 = 2.0;

/// A tree over solid triangles and, per node, its dipole: the sum of its triangles' area vectors,
/// their area-weighted centre, and the radius about it that holds them — apart, so the walk reads
/// only the centres and reaches of the nodes it opens.
struct Field {
    tree: Tree,
    /// Per node: its centre, and the square of `BETA` times its radius.
    reaches: Vec<([f64; 3], f64)>,
    /// Per node: its area vector sum.
    normals: Vec<[f64; 3]>,
}

/// The solid angle triangle `[a, b, c]` subtends at the origin, over 4π: Van Oosterom and
/// Strackee's formula.
fn solid_angle([a, b, c]: [[f64; 3]; 3]) -> f64 {
    let (la, lb, lc) = (length(a), length(b), length(c));
    let numerator = dot(a, cross(b, c));
    let denominator = la * lb * lc + dot(a, b) * lc + dot(b, c) * la + dot(c, a) * lb;
    numerator.atan2(denominator) / (2.0 * std::f64::consts::PI)
}

impl Field {
    /// The field of `soup`, nine floats per triangle, wound outwards.
    fn new(soup: Vec<f32>) -> Self {
        let tree = Tree::from_soup(soup);
        let mut reaches = vec![([0.0; 3], 0.0); tree.nodes.len()];
        let mut normals = vec![[0.0; 3]; tree.nodes.len()];
        // Area vector and area-weighted centre sums, children before parents (preorder reversed).
        let mut sums = vec![([0.0f64; 3], [0.0f64; 3], 0.0f64); tree.nodes.len()];
        for at in (0..tree.nodes.len()).rev() {
            let node = &tree.nodes[at];
            let mut sum = ([0.0f64; 3], [0.0f64; 3], 0.0f64);
            let mut add = |(n, c, w): ([f64; 3], [f64; 3], f64)| {
                for k in 0..3 {
                    sum.0[k] += n[k];
                    sum.1[k] += c[k];
                }
                sum.2 += w;
            };
            if node.children().is_empty() {
                for slot in node.first..node.first + node.count {
                    let [a, b, c] = tree.corners(slot);
                    let n = cross(sub(b, a), sub(c, a)).map(|x| x * 0.5);
                    let area = length(n);
                    let centre = trillion3d_math::triangle::centroid([a, b, c]);
                    add((n, centre.map(|x| x * area), area));
                }
            } else {
                for &child in node.children() {
                    add(sums[child as usize]);
                }
            }
            sums[at] = sum;
            let centre = if sum.2 > 0.0 {
                sum.1.map(|x| x / sum.2)
            } else {
                std::array::from_fn(|k| f64::from(node.low[k] + node.high[k]) * 0.5)
            };
            // The radius about the centre that holds the node's box: every triangle within it.
            let reach: [f64; 3] = std::array::from_fn(|k| {
                (centre[k] - f64::from(node.low[k])).max(f64::from(node.high[k]) - centre[k])
            });
            let radius = length(reach);
            reaches[at] = (centre, (BETA * radius).powi(2));
            normals[at] = sum.0;
        }
        Self {
            tree,
            reaches,
            normals,
        }
    }

    /// The fast winding number at `point`: one inside a closed part wound outwards, zero outside.
    fn at(&self, point: [f64; 3]) -> f64 {
        if self.tree.nodes.is_empty() {
            return 0.0;
        }
        let mut total = 0.0;
        // Preorder depth is logarithmic: a fixed stack holds every pending node.
        let mut stack = [0usize; 256];
        let mut depth = 1;
        while depth > 0 {
            depth -= 1;
            let at = stack[depth];
            let (centre, reach) = self.reaches[at];
            let offset = sub(centre, point);
            let squared = dot(offset, offset);
            if squared > reach {
                let distance = squared.sqrt();
                total += dot(self.normals[at], offset)
                    / (4.0 * std::f64::consts::PI * squared * distance);
                continue;
            }
            let node = &self.tree.nodes[at];
            if node.children().is_empty() {
                // Each triangle's corners read from the tree, single precision widened exactly.
                for slot in node.first..node.first + node.count {
                    total += solid_angle(self.tree.corners(slot).map(|c| sub(c, point)));
                }
            } else {
                for &child in node.children() {
                    stack[depth] = child as usize;
                    depth += 1;
                }
            }
        }
        total
    }
}

/// A box: its least and greatest corners.
type Bounds = ([f64; 3], [f64; 3]);

/// The scene's winding field: the open solids' tree, each closed part's tree with its box, and a
/// tree over those boxes — per node its box apart from its link, either its two children or its
/// parts (`Link`).
pub(super) struct Winding {
    open: Field,
    parts: Vec<(Field, Bounds)>,
    bounds: Vec<Bounds>,
    links: Vec<Link>,
    /// The leaves' parts, end to end, each leaf a range of them.
    ranks: Vec<u32>,
}

/// A box tree node's link: its two children's ranks, or its parts' range in `Winding::ranks`.
enum Link {
    Inner([u32; 2]),
    Leaf(std::ops::Range<u32>),
}

fn holds((low, high): &Bounds, p: [f64; 3]) -> bool {
    (0..3).all(|k| p[k] >= low[k] && p[k] <= high[k])
}

/// The box tree over `ranks` of `boxes`, its nodes appended in preorder to `bounds` and `links`,
/// its leaves' parts to `leaves`; returns the root's rank.
fn box_tree(
    boxes: &[Bounds],
    mut ranks: Vec<usize>,
    (bounds, links, leaves): (&mut Vec<Bounds>, &mut Vec<Link>, &mut Vec<u32>),
) -> u32 {
    let mut own = ([f64::INFINITY; 3], [f64::NEG_INFINITY; 3]);
    for &r in &ranks {
        merge_aabb(&mut own.0, &mut own.1, boxes[r].0, boxes[r].1);
    }
    let at = links.len();
    bounds.push(own);
    if ranks.len() <= 4 {
        let first = leaves.len() as u32;
        leaves.extend(ranks.iter().map(|&r| r as u32));
        links.push(Link::Leaf(first..leaves.len() as u32));
        return at as u32;
    }
    links.push(Link::Leaf(0..0));
    let axis = (0..3)
        .max_by(|&a, &b| (own.1[a] - own.0[a]).total_cmp(&(own.1[b] - own.0[b])))
        .unwrap_or(0);
    let centre = |r: usize| boxes[r].0[axis] + boxes[r].1[axis];
    ranks.sort_by(|&a, &b| centre(a).total_cmp(&centre(b)));
    let upper = ranks.split_off(ranks.len() / 2);
    let left = box_tree(boxes, ranks, (bounds, links, leaves));
    let right = box_tree(boxes, upper, (bounds, links, leaves));
    links[at] = Link::Inner([left, right]);
    at as u32
}

impl Winding {
    /// The field of `open`, the open solids, and of `parts`, the closed ones, nine floats per
    /// triangle, wound outwards.
    pub fn new(open: Vec<f32>, parts: Vec<Vec<f32>>) -> Self {
        use rayon::prelude::*;
        // Each field built on its own, side by side, kept in the parts' order.
        let (open, parts) = rayon::join(
            || Field::new(open),
            || {
                (parts.into_par_iter())
                    .map(|soup| {
                        let bounds =
                            aabb_of(soup.as_chunks::<3>().0.iter().map(|p| p.map(f64::from)));
                        (Field::new(soup), bounds)
                    })
                    .collect::<Vec<(Field, Bounds)>>()
            },
        );
        let boxes: Vec<Bounds> = parts.iter().map(|p| p.1).collect();
        let (mut bounds, mut links, mut ranks) = (Vec::new(), Vec::new(), Vec::new());
        if !boxes.is_empty() {
            let tree = (&mut bounds, &mut links, &mut ranks);
            box_tree(&boxes, (0..boxes.len()).collect(), tree);
        }
        Self {
            open,
            parts,
            bounds,
            links,
            ranks,
        }
    }

    /// The fast winding number at `point`: the open solids' and the closed parts' whose boxes
    /// hold it.
    pub fn at(&self, point: [f64; 3]) -> f64 {
        let mut total = self.open.at(point);
        if self.links.is_empty() {
            return total;
        }
        // The box tree is balanced: a fixed stack holds every pending node.
        let mut stack = [0u32; 64];
        let mut depth = 1;
        while depth > 0 {
            depth -= 1;
            let at = stack[depth] as usize;
            if !holds(&self.bounds[at], point) {
                continue;
            }
            match &self.links[at] {
                Link::Inner(children) => {
                    for &child in children {
                        stack[depth] = child;
                        depth += 1;
                    }
                }
                Link::Leaf(range) => {
                    for &r in &self.ranks[range.start as usize..range.end as usize] {
                        let (field, bounds) = &self.parts[r as usize];
                        if holds(bounds, point) {
                            total += field.at(point);
                        }
                    }
                }
            }
        }
        total
    }
}

/// The shells thin parts are thickened by: a point is inside one nearer than its radius to one
/// of its triangles.
pub(super) struct Shells {
    tree: Tree,
    radius: Vec<f64>,
    reach: Vec<f64>,
}

impl Shells {
    /// The shells of `soup`, nine floats per triangle, triangle `t` thickened by `radius[t]`.
    pub fn new(soup: Vec<f32>, radius: Vec<f64>) -> Self {
        let tree = Tree::from_soup(soup);
        let reach = tree.node_max(&|t| radius[t]);
        Self {
            tree,
            radius,
            reach,
        }
    }

    pub fn inside(&self, point: [f64; 3]) -> bool {
        self.tree.within(point, &|t| self.radius[t], &self.reach)
    }
}
