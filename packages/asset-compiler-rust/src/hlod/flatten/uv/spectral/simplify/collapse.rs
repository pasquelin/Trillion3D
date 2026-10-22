//! The collapse loop and the tests an edge passes before it collapses.
//!
//! An edge cannot collapse when it or one of its ends is gone, when both ends lie on the boundary
//! but the edge does not, or when the collapse would make a face a segment: a vertex opposite the
//! edge with an edge opposite both ends, or an edge of the kept end and one of the removed end,
//! neither on the edge's faces, that meet. A collapse that would leave a face of the removed end
//! facing less than `ZERO` along its old normal is refused for now.
use super::quadric::{cross_wide, difference, dot_wide};
use super::Simplifier;
use crate::hlod::flatten::uv::spectral::mesh::NONE;
use crate::hlod::flatten::uv::spectral::ranked::Ranked;
use crate::hlod::flatten::uv::spectral::util::{unit, ZERO};

/// The fewest vertices a simplification leaves.
const MIN_VERTICES: u32 = 85;
/// The largest cost, relative to the diagonal, a collapse may have before the geometric pass
/// stops.
const MAX_ERROR: f32 = 0.90;

impl<'s> Simplifier<'s> {
    /// The vertices ranked by collapsing edges, cheapest first.
    pub(crate) fn simplify(&mut self) {
        let edge_count = self.edges.len();
        let mut heap = Ranked::<f64>::new(edge_count);
        let mut weights = vec![0f64; edge_count];
        for (e, slot) in weights.iter_mut().enumerate() {
            let mut weight = -self.edges[e].cost;
            if weight > -(ZERO as f64) {
                weight = -(ZERO as f64);
            }
            *slot = weight;
            heap.insert(e as u32, weight);
        }
        let mut examined = 0;
        let mut importance = 1;
        let mut remaining = self.verts.len() as u32;
        let mut repeats = 0;
        while examined < edge_count && remaining > MIN_VERTICES {
            let Some(e) = heap.pop() else {
                break;
            };
            if (weights[e as usize].abs() as f32) > MAX_ERROR * self.diagonal {
                break;
            }
            let Some((keep, remove, flips)) = self.prepare_collapse(e) else {
                repeats = 0;
                examined += 1;
                continue;
            };
            if flips {
                weights[e as usize] *= 100.0;
                heap.insert(e, weights[e as usize]);
                repeats += 1;
                if repeats >= edge_count {
                    break;
                }
                continue;
            }
            self.verts[remove as usize].importance = importance;
            importance += 1;
            remaining -= 1;
            self.collapse(&mut heap, &mut weights, e, keep, remove);
        }
        while remaining > MIN_VERTICES {
            let Some(e) = heap.pop() else {
                break;
            };
            let Some((keep, remove, _)) = self.prepare_collapse(e) else {
                continue;
            };
            self.verts[remove as usize].importance = importance;
            importance += 1;
            remaining -= 1;
            self.collapse(&mut heap, &mut weights, e, keep, remove);
        }
    }

    /// The kept and removed ends of edge `e`, and whether its collapse would flip a face; `None`
    /// when it cannot collapse.
    fn prepare_collapse(&self, e: u32) -> Option<(u32, u32, bool)> {
        let edge = &self.edges[e as usize];
        if edge.deleted || edge.verts[0] == edge.verts[1] {
            return None;
        }
        let keep = edge.verts[1 - edge.removes as usize];
        let remove = edge.verts[edge.removes as usize];
        let (k, r) = (&self.verts[keep as usize], &self.verts[remove as usize]);
        if k.deleted || r.deleted || (k.boundary && r.boundary && !edge.boundary) {
            return None;
        }
        if !self.keeps_topology(e, keep, remove) {
            return None;
        }
        Some((keep, remove, !self.keeps_orientation(keep, remove)))
    }

    /// Whether edge `e` lies opposite vertex `v` in one of its faces.
    pub(super) fn opposite_to(&self, e: u32, v: u32) -> bool {
        self.edges[e as usize].opposite.contains(&v)
    }

    /// Whether collapsing edge `e` leaves every face a triangle.
    fn keeps_topology(&self, e: u32, keep: u32, remove: u32) -> bool {
        let edge = &self.edges[e as usize];
        for &third in &edge.opposite {
            if third == NONE {
                break;
            }
            let ring = &self.verts[third as usize].edges;
            if ring
                .iter()
                .any(|&e1| self.opposite_to(e1, keep) && self.opposite_to(e1, remove))
            {
                return false;
            }
        }
        let face1 = self.faces[edge.faces[0] as usize].edges;
        let face2 = (!edge.boundary).then(|| self.faces[edge.faces[1] as usize].edges);
        let on_faces = |e: u32| face1.contains(&e) || face2.is_some_and(|f| f.contains(&e));
        for &e1 in &self.verts[keep as usize].edges {
            if on_faces(e1) {
                continue;
            }
            let ends1 = self.edges[e1 as usize].verts;
            for &e2 in &self.verts[remove as usize].edges {
                if on_faces(e2) {
                    continue;
                }
                let ends2 = self.edges[e2 as usize].verts;
                if ends2.iter().any(|v| ends1.contains(v)) {
                    return false;
                }
            }
        }
        true
    }

    /// Whether moving vertex `remove` onto `keep` leaves every face of `remove` alone facing at
    /// least `ZERO` along its normal.
    fn keeps_orientation(&self, keep: u32, remove: u32) -> bool {
        let kept = &self.verts[keep as usize];
        for &f in &self.verts[remove as usize].faces {
            if kept.faces.contains(&f) {
                continue;
            }
            let face = &self.faces[f as usize];
            let p = face
                .verts
                .map(|v| self.point(if v == remove { keep } else { v }));
            let v1 = unit(difference(p[1], p[0]));
            let v2 = unit(difference(p[2], p[0]));
            if dot_wide(cross_wide(v1, v2), face.normal) < ZERO {
                return false;
            }
        }
        true
    }
}
