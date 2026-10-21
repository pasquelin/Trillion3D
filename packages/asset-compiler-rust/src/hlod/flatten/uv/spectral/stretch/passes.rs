//! An optimisation run's passes over a chart's vertices.
//!
//! A pass puts every vertex in the heap by its stretch and moves them greatest first, skipping
//! those under the run's bar and those of a kind the run leaves in place; each move renews its
//! neighbours' keys. The mean squared runs stop once the largest face stretch drops by less than
//! 0.01. The infinite-stretch run fills the heap with the vertices of infinite stretch and their
//! neighbours only.
use super::optimize::Plan;
use super::INFINITE_STRETCH;
use crate::hlod::flatten::uv::spectral::mesh::Chart;

/// The change of the largest face stretch under which the passes stop.
const MIN_CHANGE: f32 = 0.01;

impl<'a> Chart<'a> {
    /// The run's passes over every vertex.
    pub(super) fn optimize_stretch(&mut self, plan: &mut Plan) {
        if plan.previous_max == 0.0 {
            plan.previous_max = INFINITE_STRETCH;
        }
        plan.weights.copy_from_slice(&plan.vert_stretch);
        let mut pass = 0;
        loop {
            for v in 0..self.verts.len() as u32 {
                plan.heap.insert(v, plan.weights[v as usize]);
            }
            self.optimize_heap(plan);
            if !plan.ln {
                let mut largest = 0.0;
                for &s in &plan.face_stretch {
                    if s > largest {
                        largest = s;
                    }
                }
                if plan.previous_max - largest < MIN_CHANGE {
                    break;
                }
                plan.previous_max = largest;
            }
            pass += 1;
            if pass >= plan.passes {
                break;
            }
        }
    }

    /// The vertices of infinite stretch and their neighbours put in the heap; how many are
    /// infinite.
    pub(super) fn collect_infinite(&self, plan: &mut Plan) -> usize {
        let mut count = 0;
        for v in 0..self.verts.len() {
            if plan.weights[v] < plan.infinite {
                continue;
            }
            if !plan.heap.contains(v as u32) {
                plan.heap.insert(v as u32, plan.weights[v]);
            }
            for &n in &self.verts[v].verts {
                if !plan.heap.contains(n) {
                    plan.heap.insert(n, plan.weights[n as usize]);
                }
            }
            count += 1;
        }
        count
    }

    /// Every vertex in the heap moved, greatest stretch first.
    pub(super) fn optimize_heap(&mut self, plan: &mut Plan) {
        while let Some(v) = plan.heap.pop() {
            if plan.weights[v as usize] < plan.stop_below {
                continue;
            }
            let boundary = self.verts[v as usize].boundary;
            if (!plan.boundary_verts && boundary) || (!plan.inner_verts && !boundary) {
                continue;
            }
            if !self.optimize_vertex(v, plan) {
                continue;
            }
            plan.weights[v as usize] = plan.vert_stretch[v as usize];
            for i in 0..self.verts[v as usize].verts.len() {
                let n = self.verts[v as usize].verts[i];
                plan.weights[n as usize] = plan.vert_stretch[n as usize];
                if plan.heap.contains(n) {
                    plan.heap.update(n, plan.vert_stretch[n as usize]);
                }
            }
        }
    }
}
