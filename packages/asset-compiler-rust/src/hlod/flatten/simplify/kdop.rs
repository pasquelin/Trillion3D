//! A bounding-volume tree over triangles (`Tree`) — a k-DOP of three slab pairs, that is
//! axis-aligned boxes, two children a node, up to four triangles a leaf — and the nearest point a
//! segment meets on them (`Tree::closest`): the transfer's rays and the walls' edges both cast
//! through it.
//!
//! The build splits each node's triangles at the mean of their centroids along the axis they
//! spread most along, the triangles at or past the mean going left; a split leaving one side empty
//! halves the run instead (`build.rs`). A node keeps four boxes, its two children's and its left
//! child's two children's, so one test of a node's boxes serves two levels (`walk.rs`). A leaf's
//! triangles keep their plane, the unit normal of their corners and its offset (`face.rs`).
//!
//! The walk enters the child whose box it enters first, the right one on a tie, and the other one
//! only while its box is entered before the nearest hit so far. A triangle is met where the
//! segment's ends lie on its plane's two sides by more than a ten-thousandth — the product of their
//! distances to it at most −0.0001 —, before the nearest hit so far, and within 0.0001 of the
//! inside of each of its three edges; of a leaf's triangles met at the same point, the first. Every
//! value is in double precision but the nearest hit's fraction of the segment, kept in single
//! precision as each hit narrows it.
use rayon::prelude::*;
mod build;
mod face;
mod walk;
use build::Built;
use face::Face;

/// A box: its low corner, then its high corner.
type Bounds = [[f64; 3]; 2];

/// What a node holds: two children — the left one's rank, the right one's the next —, or a leaf's
/// triangles, the first one's rank among the tree's faces and their count, four at most.
#[derive(Clone, Copy)]
enum Below {
    Children(u32),
    Faces(u32, u32),
}

/// A node of the tree: the boxes of its left child, its right child and its left child's two
/// children, in that order — a leaf's four its own —, and what it holds.
struct Node {
    boxes: [Bounds; 4],
    below: Below,
}

/// The tree: its nodes, the root first, each parent before its children; and the leaves'
/// triangles, leaf after leaf in the nodes' order.
pub(super) struct Tree {
    nodes: Vec<Node>,
    faces: Vec<Face>,
}

/// The nearest triangle a segment meets: its rank among the triangles the tree was built over, and
/// the fraction of the segment, from its start to its end, at which it meets it.
#[derive(Clone, Copy)]
pub(super) struct Hit {
    pub triangle: u32,
    pub time: f32,
}

/// What a walk still has to visit, kept from one segment to the next so its steps are not
/// allocated anew each time.
#[derive(Default)]
pub(super) struct Walk {
    steps: Vec<walk::Step>,
}

impl Tree {
    /// The tree over `count` triangles, triangle `t`'s corners `corners(t)`.
    pub(super) fn over(count: usize, corners: impl Fn(usize) -> [[f32; 3]; 3] + Sync) -> Self {
        let triangles: Vec<Built> = (0..count)
            .into_par_iter()
            .map(|t| Built::of(t as u32, corners(t)))
            .collect();
        let (nodes, faces) = build::built(triangles);
        Self { nodes, faces }
    }

    /// The nearest triangle the segment from `start` to `end` meets, if any (module doc); `walk`
    /// the steps' scratch.
    pub(super) fn closest(
        &self,
        (start, end): ([f64; 3], [f64; 3]),
        walk: &mut Walk,
    ) -> Option<Hit> {
        walk::closest(self, &walk::Segment::of(start, end), &mut walk.steps)
    }
}
