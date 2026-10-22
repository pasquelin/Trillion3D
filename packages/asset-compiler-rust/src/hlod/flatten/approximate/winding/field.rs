//! One wrapped mesh's winding field (Barill et al. 2018): a binary tree over its triangles and,
//! per node read from afar, the expansion of its triangles' winding number to the second order.
//!
//! The tree is split top-down: a node of more than `LEAF_TRIANGLES` triangles cut at the middle
//! of its triangles' centroids along one axis — the axes taken in turn with the depth, laid out up
//! along `z` as the rule is written, swapped into the scene's `y` up —, the centroids at or below
//! the middle first, gathered in place by two cursors walking in from both ends; a cut that leaves
//! one side empty, or centroids spread over no more than `FLAT_SPREAD`, halved by count instead.
//!
//! A node's expansion, about the area-weighted centre `P` of its triangles: their area vectors'
//! sum, and the sum of each one's area times the outer product of its centroid's offset from `P`
//! and its unit normal; it is read for a point farther than `BETA` times its radius `R` — the
//! farthest of its corners from `P` —. The root and the leaves carry none: the root is always
//! opened, a leaf's triangles always read by their exact solid angles. A node whose triangles have
//! no area carries none either, as its centre is undefined. Everything is measured in double
//! precision, packed in single (`pack.rs`) and read on the GPU (`gpu/winding.wgsl`).
use super::Link;
use trillion3d_math::geometry::aabb::{aabb_of, merge_aabb};
use trillion3d_math::geometry::triangle::{centroid, triangle_area};
use trillion3d_math::scalar::not_above;
use trillion3d_math::vector::vec3::cross;
use trillion3d_math::vector::vecn::{distance2, sub};

/// The most triangles a leaf holds.
const LEAF_TRIANGLES: usize = 3;
/// The spread of centroids, metres, at or under which a node is halved by count rather than cut at
/// its middle.
const FLAT_SPREAD: f64 = 1e-10;
/// The axis each depth cuts along, in turn: the rule's `x`, `y`, `z`, up along `z`, as the scene's
/// `y`-up axes.
const AXES: [usize; 3] = [0, 2, 1];
/// How far past its radius a node is read from afar.
const BETA: f64 = 2.0;

/// A node read from afar: its centre and the square of `BETA` times its radius, its area vectors'
/// sum, and its second-order sum, row by row.
#[derive(Clone, Copy)]
pub(super) struct Far {
    pub(super) centre: [f64; 3],
    pub(super) reach: f64,
    pub(super) first: [f64; 3],
    pub(super) second: [[f64; 3]; 3],
}

/// A wrapped mesh's field: its tree's nodes in preorder, the root first — each its box, its link
/// and its expansion where it is read from afar —, and its triangles in the leaves' order.
pub(super) struct Field {
    pub(super) boxes: Vec<([f64; 3], [f64; 3])>,
    pub(super) links: Vec<Link>,
    pub(super) far: Vec<Option<Far>>,
    pub(super) triangles: Vec<[[f64; 3]; 3]>,
}

/// The tree being split: the triangles in their current order, their centroids beside them, and
/// the nodes made so far.
struct Split<'a> {
    triangles: &'a [[[f64; 3]; 3]],
    order: Vec<usize>,
    centres: Vec<[f64; 3]>,
    boxes: Vec<([f64; 3], [f64; 3])>,
    links: Vec<Link>,
    depths: Vec<usize>,
}

impl Split<'_> {
    /// The node over the `count` triangles from `start`, at `depth`, appended with its subtree in
    /// preorder; its rank.
    fn node(&mut self, (start, count): (usize, usize), depth: usize) -> u32 {
        let at = self.links.len();
        self.links.push(Link::Leaf(0..0));
        self.boxes
            .push(([f64::INFINITY; 3], [f64::NEG_INFINITY; 3]));
        self.depths.push(depth);
        if count <= LEAF_TRIANGLES {
            let range = start..start + count;
            let corners = self.order[range.clone()]
                .iter()
                .flat_map(|&t| self.triangles[t]);
            self.boxes[at] = aabb_of(corners);
            self.links[at] = Link::Leaf(range.start as u32..range.end as u32);
            return at as u32;
        }
        let half = self.halves((start, count), AXES[depth % 3]);
        let left = self.node((start, half), depth + 1);
        let right = self.node((start + half, count - half), depth + 1);
        let (mut low, mut high) = self.boxes[left as usize];
        let (l, h) = self.boxes[right as usize];
        merge_aabb(&mut low, &mut high, l, h);
        self.boxes[at] = (low, high);
        self.links[at] = Link::Inner([left, right]);
        at as u32
    }

    /// The `count` triangles from `start` gathered in place, those whose centroid lies at or below
    /// the middle of the centroids along `axis` first; how many come first.
    fn halves(&mut self, (start, count): (usize, usize), axis: usize) -> usize {
        let along = |at: usize, centres: &[[f64; 3]]| centres[start + at][axis];
        let (mut least, mut most) = (f64::INFINITY, f64::NEG_INFINITY);
        for at in 0..count {
            least = least.min(along(at, &self.centres));
            most = most.max(along(at, &self.centres));
        }
        if most - least <= FLAT_SPREAD {
            return count / 2;
        }
        let middle = (least + most) * 0.5;
        let (mut l, mut r) = (0usize, count as isize - 1);
        while (l as isize) < r {
            while l < count && along(l, &self.centres) <= middle {
                l += 1;
            }
            while r >= 0 && along(r as usize, &self.centres) > middle {
                r -= 1;
            }
            if l as isize >= r {
                break;
            }
            self.centres.swap(start + l, start + r as usize);
            self.order.swap(start + l, start + r as usize);
        }
        if l == 0 || l == count {
            count / 2
        } else {
            l
        }
    }
}

/// The expansion of `triangles` about their area-weighted centre, `None` when they have no area.
fn expansion(triangles: &[[[f64; 3]; 3]]) -> Option<Far> {
    let (mut weighted, mut area) = ([0.0f64; 3], 0.0f64);
    for &t in triangles {
        let a = triangle_area(t[0], t[1], t[2]);
        let c = centroid(t);
        area += a;
        (0..3).for_each(|k| weighted[k] += a * c[k]);
    }
    if not_above(area, 0.0) {
        return None;
    }
    let centre = weighted.map(|x| x / area);
    let (mut first, mut second, mut reach) = ([0.0f64; 3], [[0.0f64; 3]; 3], 0.0f64);
    for &t in triangles {
        let vector = cross(sub(t[1], t[0]), sub(t[2], t[0])).map(|x| x * 0.5);
        let offset = sub(centroid(t), centre);
        for row in 0..3 {
            first[row] += vector[row];
            for column in 0..3 {
                second[row][column] += offset[row] * vector[column];
            }
        }
        reach = t
            .iter()
            .map(|&v| distance2(v, centre))
            .fold(reach, f64::max);
    }
    Some(Far {
        centre,
        reach: BETA * BETA * reach,
        first,
        second,
    })
}

impl Field {
    /// The field of `triangles`, each its three corners, wound outwards; a triangle whose centroid
    /// is not finite left out.
    pub(super) fn new(triangles: &[[[f64; 3]; 3]]) -> Self {
        use rayon::prelude::*;
        let order: Vec<usize> = (0..triangles.len())
            .filter(|&t| centroid(triangles[t]).iter().all(|x| x.is_finite()))
            .collect();
        let centres = order.iter().map(|&t| centroid(triangles[t])).collect();
        let count = order.len();
        let mut split = Split {
            triangles,
            order,
            centres,
            boxes: Vec::new(),
            links: Vec::new(),
            depths: Vec::new(),
        };
        if count > 0 {
            split.node((0, count), 0);
        }
        let leaf_order: Vec<[[f64; 3]; 3]> = split.order.iter().map(|&t| triangles[t]).collect();
        // A node's triangles are its range of the leaf order: the first leaf's start to the last's
        // end under it, its children's ranges side by side.
        let mut spans = vec![0..0; split.links.len()];
        for at in (0..split.links.len()).rev() {
            spans[at] = match &split.links[at] {
                Link::Leaf(range) => range.start as usize..range.end as usize,
                Link::Inner([left, right]) => {
                    spans[*left as usize].start..spans[*right as usize].end
                }
            };
        }
        let far = (0..split.links.len())
            .into_par_iter()
            .map(|at| match split.links[at] {
                Link::Inner(_) if split.depths[at] > 0 => expansion(&leaf_order[spans[at].clone()]),
                _ => None,
            })
            .collect();
        Self {
            boxes: split.boxes,
            links: split.links,
            far,
            triangles: leaf_order,
        }
    }
}
