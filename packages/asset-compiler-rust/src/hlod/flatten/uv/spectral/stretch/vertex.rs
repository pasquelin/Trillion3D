//! One vertex's move prepared: where it starts, the centre it is drawn around, the best of a few
//! fixed candidates, and how far it may go.
//!
//! - A boundary vertex circles its own position, as far as the nearest of: its neighbours, every
//!   boundary edge not its own, and every boundary vertex off its own boundary edges as seen from
//!   those edges.
//! - An inner vertex circles the mean of its neighbours; the candidates are that mean and the
//!   points 80% of the way from it to each neighbour, the radius the distance to the nearest
//!   neighbour.
//!
//! The radius is then shrunk to 80% so the vertex never reaches what bounds it; a vertex that
//! cannot move is left.
use super::optimize::Plan;
use crate::hlod::flatten::uv::spectral::mesh::Chart;
use crate::hlod::flatten::uv::spectral::util::{near_zero, root, segment_distance2};
use trillion3d_math::vector::vecn::distance2;

/// How much of its free radius a vertex may use.
const CONSERVATIVE: f32 = 0.80;

/// A vertex's move: where it starts and the best position found so far, with their stretches
/// and their faces' stretches, the centre it circles and the circle's radius.
pub(super) struct Probe {
    pub v: u32,
    pub center: [f32; 2],
    pub start: [f32; 2],
    pub end: [f32; 2],
    pub start_stretch: f32,
    pub end_stretch: f32,
    pub end_faces: Vec<f32>,
    pub work: Vec<f32>,
    pub radius: f32,
}

impl<'a> Chart<'a> {
    /// Vertex `v` moved to lower its stretch; whether it moved.
    pub(super) fn optimize_vertex(&mut self, v: u32, plan: &mut Plan) -> bool {
        let vert = &self.verts[v as usize];
        let count = vert.faces.len();
        let mut probe = Probe {
            v,
            center: [0.0; 2],
            start: vert.uv,
            end: [0.0; 2],
            start_stretch: plan.vert_stretch[v as usize],
            end_stretch: 0.0,
            end_faces: vec![0.0; count],
            work: vec![0.0; count],
            radius: 0.0,
        };
        if vert.boundary {
            self.prepare_boundary_move(plan, &mut probe);
        } else {
            self.prepare_inner_move(plan, &mut probe);
        }
        if near_zero(probe.radius) {
            return false;
        }
        self.walk_around_center(plan, &mut probe)
    }

    fn prepare_boundary_move(&self, plan: &Plan, probe: &mut Probe) {
        let vert = &self.verts[probe.v as usize];
        let uv = |v: u32| self.verts[v as usize].uv;
        probe.center = vert.uv;
        probe.end = vert.uv;
        probe.end_stretch = plan.vert_stretch[probe.v as usize];
        let mut radius = f32::MAX;
        for &n in &vert.verts {
            let length = distance2(vert.uv, uv(n));
            if radius > length {
                radius = length;
            }
        }
        for &e in &plan.boundary_edges {
            let edge = &self.edges[e as usize];
            if edge.verts.contains(&probe.v) {
                continue;
            }
            let length = segment_distance2(vert.uv, uv(edge.verts[0]), uv(edge.verts[1]));
            if radius > length {
                radius = length;
            }
        }
        for &e in &vert.edges {
            let edge = &self.edges[e as usize];
            if !edge.boundary {
                continue;
            }
            for &j in &plan.boundary_vertices {
                if edge.verts.contains(&j) {
                    continue;
                }
                let other = &self.verts[j as usize];
                let length = segment_distance2(other.uv, uv(edge.verts[0]), uv(edge.verts[1]));
                if radius > length {
                    radius = length;
                }
            }
        }
        probe.radius = root(radius) * CONSERVATIVE;
    }

    fn prepare_inner_move(&self, plan: &Plan, probe: &mut Probe) {
        let ring = &self.verts[probe.v as usize].verts;
        let mut sum = [0.0f32; 2];
        for &n in ring {
            let p = self.verts[n as usize].uv;
            sum = [sum[0] + p[0], sum[1] + p[1]];
        }
        let count = ring.len() as f32;
        probe.center = [sum[0] / count, sum[1] / count];
        probe.end = probe.center;
        probe.end_stretch = self.try_move(probe.v, plan, probe.end, &mut probe.end_faces);
        for &n in ring {
            let p = self.verts[n as usize].uv;
            let middle = [
                p[0] * CONSERVATIVE + probe.center[0] * (1.0 - CONSERVATIVE),
                p[1] * CONSERVATIVE + probe.center[1] * (1.0 - CONSERVATIVE),
            ];
            let stretch = self.try_move(probe.v, plan, middle, &mut probe.work);
            if stretch < probe.end_stretch {
                probe.end_stretch = stretch;
                probe.end_faces.copy_from_slice(&probe.work);
                probe.end = middle;
            }
        }
        let mut radius = f32::MAX;
        for &n in ring {
            let length = distance2(self.verts[n as usize].uv, probe.center);
            if length < radius {
                radius = length;
            }
        }
        probe.radius = root(radius) * CONSERVATIVE;
    }
}
