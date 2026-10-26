//! Where to split a triangle: the point whose displacement strays most from what the triangle's
//! corners' displacements interpolate there. The triangle is searched as a hierarchy of
//! sub-triangles, each a quarter of its parent, and the error the displacement may carry over each
//! is bounded (`Displacer::error_bounds`): a sub-triangle whose bound cannot beat the best point
//! found so far, or the target, is dropped; the one whose bound is highest is searched next; a
//! sub-triangle that is small enough, or whose bound is tight enough, is sampled instead of divided
//! — at most 64 points of a Hammersley sequence, none too close to an edge that cannot be flipped
//! —, and the point of greatest error taken. The hierarchy goes down 12 levels.
use super::hierarchy::{
    child_of, hammersley, heap_pop, heap_push, snapped, stray, sub_area, sub_barycentrics, Node,
};
use super::policy::Shape;
use super::tessellate::{Tessellation, COSINE_THRESHOLD};
use trillion3d_math::vector::vec3::cross;
use trillion3d_math::vector::vecn::{dot, length, sub};

/// The deepest level of the hierarchy a triangle is divided to.
const DEEPEST_LEVEL: u32 = 12;
/// The most points a sub-triangle is sampled at, and the most it is sampled at without being
/// divided further when its texture covers more samples than that.
const MOST_SAMPLES: i32 = 64;
const UNDIVIDED_SAMPLES: i32 = 16;
/// The area of an equilateral triangle with the side one sample is, a constant times the side to
/// the fourth.
const EQUILATERAL: f32 = 0.433_012_7;

/// The search of one triangle: what it holds of the triangle — its displacement's reads of its
/// corners among it —, and the point of greatest error found so far.
struct Search<'s, 'a> {
    work: &'s Tessellation<'a>,
    shape: Shape<'a>,
    displacements: [[f32; 3]; 3],
    can_flip: [bool; 3],
    lengths: [f32; 3],
    area: f32,
    best: [f32; 3],
    best_error: f32,
}

impl Search<'_, '_> {
    /// The least and the most error the displacement may carry over the sub-triangle of weights
    /// `bary`.
    fn bounds(&self, bary: &[[f32; 3]; 3]) -> [f32; 2] {
        self.shape.error_bounds(bary, &self.displacements)
    }

    /// The error a sub-triangle's bound must exceed to be worth searching: the best found, a
    /// quarter again, and the target.
    fn threshold(&self) -> f32 {
        self.best_error * 1.25 + self.work.target_error
    }

    /// Searches the hierarchy, the node of the greatest bound first, `heap` holding the nodes to
    /// divide: emptied here, so one serves every triangle a thread searches.
    fn run(&mut self, heap: &mut Vec<Node>) {
        let whole = [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]];
        let [error_min, error_max] = self.bounds(&whole);
        let mut node = Node {
            error_min,
            error_max,
            x: 0,
            y: 0,
            flipped: false,
            level: 0,
        };
        let mut error_minimum = self.work.target_error;
        heap.clear();
        while node.error_max >= error_minimum && node.error_max > self.threshold() {
            for index in 0..4 {
                let child = child_of(&node, index);
                self.visit(&node, child, (&mut error_minimum, &mut *heap));
            }
            if heap.is_empty() {
                break;
            }
            node = heap_pop(heap);
        }
    }

    /// Looks at `child`, a quarter of `parent`: it is dropped when it cannot beat the target or
    /// the best found, sampled when it is small enough or its bound tight enough, else queued to
    /// be divided. `error_minimum` is the least of the target and the least error any child
    /// reached is sure to carry.
    fn visit(
        &mut self,
        parent: &Node,
        mut child: Node,
        (error_minimum, heap): (&mut f32, &mut Vec<Node>),
    ) {
        let bary = sub_barycentrics(child.x, child.y, child.flipped, 1 << child.level);
        let bounds = self.bounds(&bary);
        // The bounds nest, but float precision may leave them a hair apart.
        child.error_min = bounds[0].max(parent.error_min);
        child.error_max = bounds[1].min(parent.error_max);
        if *error_minimum > child.error_max {
            return;
        }
        if *error_minimum < child.error_min {
            *error_minimum = child.error_min;
        }
        let worth = child.error_max > self.threshold();
        if !worth {
            return;
        }
        let target = self.work.target_error;
        let mut samples = MOST_SAMPLES;
        let mut stop = child.level == DEEPEST_LEVEL || child.error_max - child.error_min < target;
        if !stop {
            let area = sub_area(&bary, self.area);
            let sample_area = self.work.sample_area();
            samples = samples.min((area / sample_area).ceil() as i32);
            stop = area < sample_area * 16.0;
        }
        if !stop {
            samples = samples.min(self.shape.samples(&bary));
            stop = samples <= UNDIVIDED_SAMPLES;
        }
        if stop {
            self.sample_points(samples);
        } else {
            heap_push(heap, child);
        }
    }

    /// Samples `samples` points of the Hammersley sequence, and keeps the one of greatest error.
    fn sample_points(&mut self, samples: i32) {
        for i in 0..samples {
            let Some(split) = self.sample(hammersley(i, samples)) else {
                continue;
            };
            let at = self.shape.at(split);
            let error = stray(&at, &split, &self.displacements);
            if self.best_error < error {
                self.best = split;
                self.best_error = error;
            }
        }
    }

    /// The point `split` of a sequence, kept, moved onto an edge or dropped by where it lies
    /// (`snapped`), a sample rate's half the nearness that counts.
    fn sample(&self, split: [f32; 3]) -> Option<[f32; 3]> {
        let near = 0.5 * self.work.sample_rate;
        snapped(split, (&self.lengths, self.area, &self.can_flip), near)
    }
}

impl Tessellation<'_> {
    /// The area of an equilateral triangle with the side one sample is.
    fn sample_area(&self) -> f32 {
        let square = self.sample_rate * self.sample_rate;
        EQUILATERAL * (square * square)
    }

    /// Whether the edge `edge` of `triangle` may be flipped: it has a triangle across it, which
    /// names the same two vertices and the same material and lies nearly in its plane.
    pub(super) fn could_flip(&self, triangle: usize, edge: usize) -> bool {
        let Some(other) = self.mesh.across(triangle, edge) else {
            return false;
        };
        self.mesh.manifold(triangle, edge)
            && self.mesh.material(triangle) == self.mesh.material(other)
            && dot(self.mesh.normal(triangle), self.mesh.normal(other)) > COSINE_THRESHOLD
    }

    /// The weights of the point to split `triangle` at, none where it does not stray by more than
    /// the target anywhere that a split may be made; `heap` the nodes its search divides, whatever
    /// it holds.
    pub(super) fn find_split(&self, triangle: usize, heap: &mut Vec<Node>) -> Option<[f32; 3]> {
        let [p0, p1, p2] = self.mesh.corners(triangle);
        let (edge01, edge12, edge20) = (sub(p1, p0), sub(p2, p1), sub(p0, p2));
        let lengths = [length(edge01), length(edge12), length(edge20)];
        if lengths.iter().all(|&l| l < self.sample_rate) {
            return None;
        }
        let mut search = Search {
            work: self,
            shape: self.policy.shape(
                &self.mesh,
                self.mesh.triangle(triangle),
                self.mesh.material(triangle),
            ),
            displacements: self
                .mesh
                .triangle(triangle)
                .map(|v| self.displacements[v as usize]),
            can_flip: [0, 1, 2].map(|edge| self.could_flip(triangle, edge)),
            lengths,
            area: 0.5 * length(cross(edge01, edge20)),
            best: [0.0; 3],
            best_error: -1.0,
        };
        search.run(heap);
        (search.best_error > self.target_error).then_some(search.best)
    }
}
