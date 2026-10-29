//! The measures every step of the partition takes of a chart, and how a child chart is made.
//!
//! - Areas: a face's area in the plane, unsigned; the chart's plane and surface areas, summed in
//!   face order.
//! - Lengths: a vertex pair's distance in space; an edge's signal length, the length the signal
//!   tensor of each face beside the edge gives the edge in that face's canonical frame, averaged
//!   over the two faces of an inner edge.
//! - Overlap: whether two boundary edges that share no vertex cross in the plane.
//! - A child: the chosen vertices and faces copied in order, each linked to its root element and
//!   to its element here, the faces' corners renumbered; the importance, the bounding diagonal and
//!   the cleaning flag carried over.
use super::{Chart, Face, Vert, NONE};
use crate::hlod::flatten::uv::spectral::util::{area_2d, root, segments_cross};
use rayon::prelude::*;
use trillion3d_math::vector::vecn::{dot, length, sub};

impl<'a> Chart<'a> {
    /// The plane area of face `face`, unsigned.
    pub(crate) fn uv_area(&self, face: usize) -> f32 {
        let [a, b, c] = self.faces[face].verts.map(|v| self.verts[v as usize].uv);
        area_2d(a, b, c)
    }

    /// The chart's plane area.
    pub(crate) fn area_2d_sum(&self) -> f32 {
        (0..self.faces.len()).fold(0.0, |sum, f| sum + self.uv_area(f))
    }

    /// The chart's surface area.
    pub(crate) fn area_3d_sum(&self) -> f32 {
        self.faces
            .iter()
            .fold(0.0, |sum, f| sum + self.source.areas[f.root as usize])
    }

    /// Whether two boundary edges that share no vertex cross in the plane. A chart without a
    /// boundary edge does not overlap. Every edge is tried against the ones after it, the edges
    /// on all threads: whether any pair crosses is the same in any order.
    pub(crate) fn overlaps(&self) -> bool {
        let boundary: Vec<_> = self.edges.iter().filter(|e| e.boundary).collect();
        let uvs: Vec<[f32; 2]> = self.verts.iter().map(|v| v.uv).collect();
        let uv = |v: u32| uvs[v as usize];
        boundary.par_iter().enumerate().any(|(i, e1)| {
            boundary[i + 1..].iter().any(|e2| {
                !e1.verts.iter().any(|v| e2.verts.contains(v))
                    && segments_cross(
                        uv(e1.verts[0]),
                        uv(e1.verts[1]),
                        uv(e2.verts[0]),
                        uv(e2.verts[1]),
                    )
                    .is_some()
            })
        })
    }

    /// The distance in space between two chart vertices.
    pub(crate) fn vertex_distance(&self, a: u32, b: u32) -> f32 {
        length(sub(self.point(b), self.point(a)))
    }

    /// `p` in the canonical frame of the root face `root_face`, from the frame's origin `origin`.
    pub(crate) fn to_face_plane(&self, root_face: u32, origin: [f32; 3], p: [f32; 3]) -> [f32; 2] {
        let [x, y] = self.source.canonical_axes[root_face as usize];
        let along = sub(p, origin);
        [dot(along, x), dot(along, y)]
    }

    /// The signal length from `a` to `b` in the frame of chart face `face`; nothing for no face.
    pub(crate) fn signal_length_on(&self, a: [f32; 3], b: [f32; 3], face: u32) -> f32 {
        if face == NONE {
            return 0.0;
        }
        let f = &self.faces[face as usize];
        let origin = self.point(f.verts[0]);
        let p0 = self.to_face_plane(f.root, origin, a);
        let p1 = self.to_face_plane(f.root, origin, b);
        let (dx, dy) = (p1[0] - p0[0], p1[1] - p0[1]);
        let m = self.tensor(f.root).expect("a signal");
        root(m[0] * dx * dx + m[2] * dy * dy + 2.0 * m[1] * dx * dy)
    }

    /// The signal length from `a` to `b` on the faces `face0` and `face1`, averaged when both
    /// exist.
    pub(crate) fn signal_length_across(
        &self,
        a: [f32; 3],
        b: [f32; 3],
        face0: u32,
        face1: u32,
    ) -> f32 {
        let first = self.signal_length_on(a, b, face0);
        if face1 == NONE {
            first
        } else {
            (first + self.signal_length_on(a, b, face1)) * 0.5
        }
    }

    /// Edge `edge`'s signal length.
    pub(crate) fn edge_signal_length(&self, edge: usize) -> f32 {
        let e = &self.edges[edge];
        let (a, b) = (self.point(e.verts[0]), self.point(e.verts[1]));
        self.signal_length_across(a, b, e.faces[0], e.faces[1])
    }

    /// Every edge's length, and its signal length when a signal is given (else zero).
    pub(crate) fn measure_edges(&mut self) {
        for i in 0..self.edges.len() {
            let [a, b] = self.edges[i].verts;
            self.edges[i].length = self.vertex_distance(a, b);
            self.edges[i].signal_length = if self.has_signal() {
                self.edge_signal_length(i)
            } else {
                0.0
            };
        }
    }

    /// A child chart of the vertices `verts` and faces `faces` of this one, in their order.
    pub(crate) fn sub_chart(&self, verts: &[u32], faces: &[u32], sub_chart: bool) -> Chart<'a> {
        let mut child = Chart::new(self.source);
        child.sub_chart = sub_chart;
        child.diagonal = self.diagonal;
        let mut map = vec![NONE; self.verts.len()];
        child.verts = (verts.iter().enumerate())
            .map(|(i, &old)| {
                let old = &self.verts[old as usize];
                map[old.id as usize] = i as u32;
                Vert::cut_from(i, old)
            })
            .collect();
        child.faces = (faces.iter().enumerate())
            .map(|(i, &old)| {
                let old = &self.faces[old as usize];
                Face {
                    id: i as u32,
                    root: old.root,
                    parent: old.id,
                    verts: old.verts.map(|v| map[v as usize]),
                    edges: [0; 3],
                }
            })
            .collect();
        child.needs_clean = self.needs_clean;
        child
    }
}
