//! A chart's optimisation runs: what kind of stretch they lower, which vertices they move, how
//! many passes they take, and the passes themselves.
//!
//! One `Plan` serves every run of one optimisation, its measures carried from run to run as the
//! library carries them: the mean plane edge length is measured once, the largest face stretch so
//! far and the count of infinite vertices keep growing. Each run sets its kind (largest or mean
//! squared, geometric or signal), its vertices (boundary, inner), whether the vertices stay in the
//! chart's least box (found by turning the chart), and measures every face's and vertex's stretch.
//! The passes themselves are in `passes`. The infinite-stretch run repeats until no vertex is
//! infinite or the passes run out, and succeeds when the faces still infinite cover no more of
//! the surface than the tolerance.
use super::INFINITE_STRETCH;
use crate::hlod::flatten::uv::spectral::mesh::Chart;
use crate::hlod::flatten::uv::spectral::util::near_zero;
use trillion3d_math::heap::{Greatest, IndexedHeap};

/// The plane distance under which a vertex stops moving, relative to the mean edge length.
const TOLERANCE: f32 = 1e-4;
/// The largest-stretch runs stop moving a vertex under this stretch.
const STOP_LN: f32 = 2.0;
/// Passes and random draws of each run: infinite stretch, largest, mean squared, signal before
/// and after the whole-chart map.
const INFINITE_PASSES: usize = 12;
const INFINITE_DRAWS: usize = 12;
const LN_PASSES: usize = 2;
const LN_DRAWS: usize = 9;
const L2_PASSES: usize = 7;
const L2_DRAWS: usize = 9;
const SIGNAL_PASSES_BEFORE: usize = 6;
const SIGNAL_PASSES_AFTER: usize = 4;
/// The turns tried for the chart's least box.
const BOX_TURNS: usize = 4;

/// One optimisation's settings, measures and working space.
#[derive(Default)]
pub(super) struct Plan {
    pub ln: bool,
    pub signal: bool,
    pub use_bounds: bool,
    pub boundary_verts: bool,
    pub inner_verts: bool,
    /// The scale from surface to plane, for the largest stretch; 1 otherwise.
    pub scale: f32,
    pub passes: usize,
    pub draws: usize,
    pub stop_below: f32,
    pub mean_edge: f32,
    pub tolerance: f32,
    pub heap: IndexedHeap<Greatest>,
    /// Each vertex's key, kept while it is out of the heap.
    pub weights: Vec<f32>,
    pub vert_stretch: Vec<f32>,
    pub face_stretch: Vec<f32>,
    /// The chart's boundary edges and boundary vertices, in order: the flags never change in an
    /// optimisation, so a boundary vertex's move reads these rather than every edge and vertex.
    pub boundary_edges: Vec<u32>,
    pub boundary_vertices: Vec<u32>,
    pub low: [f32; 2],
    pub high: [f32; 2],
    pub previous_max: f32,
    pub infinite: f32,
    pub infinite_count: usize,
    pub infinite_area: f32,
}

/// What a run lowers and moves.
struct Run {
    ln: bool,
    signal: bool,
    use_bounds: bool,
    boundary_verts: bool,
    inner_verts: bool,
    stop_below: f32,
    passes: usize,
    draws: usize,
}

impl<'a> Chart<'a> {
    /// `plan` set for `run` and every stretch measured; `false` when the largest stretch is asked
    /// of a chart of no surface area.
    fn init_run(&mut self, run: Run, plan: &mut Plan) -> bool {
        if run.use_bounds {
            (plan.low, plan.high) = self.fit_bounds(BOX_TURNS);
        }
        if plan.face_stretch.is_empty() {
            plan.face_stretch = vec![0.0; self.faces.len()];
            plan.vert_stretch = vec![0.0; self.verts.len()];
            plan.weights = vec![0.0; self.verts.len()];
            plan.heap = IndexedHeap::new(self.verts.len());
            plan.boundary_edges = (0..self.edges.len() as u32)
                .filter(|&e| self.edges[e as usize].boundary)
                .collect();
            plan.boundary_vertices = (0..self.verts.len() as u32)
                .filter(|&v| self.verts[v as usize].boundary)
                .collect();
        }
        if run.ln {
            let Some((scale, _, _)) = self.plane_to_surface_scale() else {
                return false;
            };
            plan.scale = scale;
        } else {
            plan.scale = 1.0;
        }
        if plan.mean_edge == 0.0 {
            plan.mean_edge = self.mean_edge_length();
        }
        plan.tolerance = TOLERANCE;
        plan.ln = run.ln;
        plan.signal = run.signal;
        plan.use_bounds = run.use_bounds;
        plan.boundary_verts = run.boundary_verts;
        plan.inner_verts = run.inner_verts;
        plan.stop_below = run.stop_below;
        plan.passes = run.passes;
        plan.draws = run.draws;
        plan.infinite = INFINITE_STRETCH / 2.0;
        for f in 0..self.faces.len() {
            let uv = self.corners_with(f, u32::MAX, [0.0; 2]);
            let (stretch, _, _) = self.face_stretch(plan.ln, plan.signal, f, uv, plan.scale);
            plan.face_stretch[f] = stretch;
            if run.ln && stretch > plan.previous_max {
                plan.previous_max = stretch;
            }
        }
        for v in 0..self.verts.len() {
            plan.vert_stretch[v] = self.vertex_stretch(plan.ln, v, &plan.face_stretch);
            if run.ln && plan.vert_stretch[v] >= plan.infinite {
                plan.infinite_count += 1;
            }
        }
        true
    }

    /// The chart's mean squared stretch lowered: geometric (its largest stretch first) or signal
    /// (around a whole-chart map), once per chart unless for the signal.
    pub(crate) fn optimize_l2(&mut self, signal: bool) {
        if self.l2_optimized && !signal {
            return;
        }
        if near_zero((self.stretch_l2 - self.base_l2).abs()) && !signal {
            self.area_2d = self.area_3d;
            self.l2_optimized = true;
            return;
        }
        if self.faces.len() == 1 {
            self.parameterize_one_face(signal, 0);
            self.area_2d = self.area_3d;
            self.l2_optimized = true;
            return;
        }
        let mut plan = Plan::default();
        let run = |ln, signal, use_bounds, boundary_verts, stop_below, passes, draws| Run {
            ln,
            signal,
            use_bounds,
            boundary_verts,
            inner_verts: true,
            stop_below,
            passes,
            draws,
        };
        let (first, second) = if signal {
            let before = run(
                false,
                true,
                false,
                false,
                0.0,
                SIGNAL_PASSES_BEFORE,
                L2_DRAWS,
            );
            (
                before,
                run(false, true, true, true, 0.0, SIGNAL_PASSES_AFTER, L2_DRAWS),
            )
        } else {
            let largest = run(true, false, false, true, STOP_LN, LN_PASSES, LN_DRAWS);
            (
                largest,
                run(false, false, false, false, 0.0, L2_PASSES, L2_DRAWS),
            )
        };
        if !self.init_run(first, &mut plan) {
            return;
        }
        self.optimize_stretch(&mut plan);
        if signal {
            self.optimize_whole_chart(self.source.expected_l2.get());
        }
        if !self.init_run(second, &mut plan) {
            return;
        }
        self.optimize_stretch(&mut plan);
        self.stretch_l2 = plan.face_stretch.iter().fold(0.0, |sum, &s| sum + s);
        self.area_2d = self.area_2d_sum();
        self.l2_optimized = true;
    }

    /// The faces of infinite largest stretch moved out of it; whether the ones left cover no more
    /// than the tolerated share of the surface.
    pub(crate) fn optimize_infinite_stretch(&mut self) -> bool {
        let mut plan = Plan::default();
        let run = Run {
            ln: true,
            signal: false,
            use_bounds: false,
            boundary_verts: true,
            inner_verts: true,
            stop_below: 0.0,
            passes: INFINITE_PASSES,
            draws: INFINITE_DRAWS,
        };
        if !self.init_run(run, &mut plan) {
            return false;
        }
        if plan.infinite_count == 0 {
            return true;
        }
        plan.weights.copy_from_slice(&plan.vert_stretch);
        for _ in 0..plan.passes {
            plan.infinite_count = self.collect_infinite(&mut plan);
            if plan.infinite_count == 0 {
                break;
            }
            self.optimize_heap(&mut plan);
        }
        plan.infinite_area = 0.0;
        plan.infinite_count = 0;
        for (f, face) in self.faces.iter().enumerate() {
            if plan.face_stretch[f] >= plan.infinite {
                plan.infinite_count += 1;
                plan.infinite_area += self.source.areas[face.root as usize];
            }
        }
        plan.infinite_area / self.area_3d <= self.source.overturn_tolerance
    }
}
