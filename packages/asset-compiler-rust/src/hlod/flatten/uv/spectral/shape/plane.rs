//! A chart flattened as a plane.
//!
//! The reference face is the first face of area above `ZERO`. Its frame: the corner whose two
//! edges are closest to perpendicular is the origin, its first edge the x axis, the y axis turned
//! from it in the face's plane.
//!
//! A plane: every face of area has the reference face's normal (a face whose normal is zero is
//! skipped); every vertex is projected onto the reference frame. A chart without a face of area is
//! a point at the origin, of stretch 0. A plane-like chart (two primary
//! dimensions at most; for a sub-chart, two computed at most): the reference face is laid in its
//! frame, then every face reached breadth first across edges lays its one vertex not yet placed at
//! its true distance and angle from the edge it shares with placed ones, turned to the reference
//! face's side. Either is kept when its stretch can be made finite; the plane-like one only when
//! no two edges that share no vertex cross, among faces of area.
use crate::hlod::flatten::uv::spectral::fail::failed;
use crate::hlod::flatten::uv::spectral::mesh::{Chart, NONE};
use crate::hlod::flatten::uv::spectral::util::{
    cross_z, near_zero, near_zero2, root, segments_cross, unit, ZERO,
};
use rayon::prelude::*;
use std::collections::VecDeque;
use trillion3d_math::vector::vec3::cross;
use trillion3d_math::vector::vecn::{dot, length, sub};

impl<'a> Chart<'a> {
    /// The first face of area above `ZERO`.
    fn reference_face(&self) -> Option<usize> {
        self.faces
            .iter()
            .position(|f| self.source.areas[f.root as usize] > ZERO)
    }

    /// The reference frame of face `face`: its origin corner and the x and y axes, of unit length,
    /// the edges measured as given (`normalized`: as unit vectors) when the origin is chosen.
    fn face_frame(
        &self,
        face: usize,
        normalized: bool,
    ) -> (usize, [[f32; 3]; 3], [f32; 3], [f32; 3]) {
        let p = self.faces[face].verts.map(|v| self.point(v));
        let mut least = f32::MAX;
        let mut origin = 0;
        for i in 0..3 {
            let (mut x, mut y) = (sub(p[(i + 1) % 3], p[i]), sub(p[(i + 2) % 3], p[i]));
            if normalized {
                (x, y) = (unit(x), unit(y));
            }
            let d = dot(x, y).abs();
            if least > d {
                least = d;
                origin = i;
            }
        }
        let x = sub(p[(origin + 1) % 3], p[origin]);
        let z = cross(x, sub(p[(origin + 2) % 3], p[origin]));
        let y = cross(z, x);
        (origin, p, unit(x), unit(y))
    }

    /// The chart projected when it is a plane; whether it is.
    pub(crate) fn process_plane(&mut self) -> crate::Result<bool> {
        let normals = &self.source.normals;
        let mut reference = NONE;
        for face in &self.faces {
            let normal = normals[face.root as usize];
            if self.source.areas[face.root as usize] > ZERO && reference == NONE {
                reference = face.id;
            }
            if reference == NONE {
                continue;
            }
            let delta = sub(
                normal,
                normals[self.faces[reference as usize].root as usize],
            );
            if !near_zero(dot(delta, delta)) {
                if near_zero(length(normal)) {
                    continue;
                }
                return Ok(false);
            }
        }
        if reference == NONE {
            for v in &mut self.verts {
                v.uv = [0.0, 0.0];
            }
            self.stretch_l2 = 0.0;
            self.parameterized = true;
            return Ok(true);
        }
        let (origin, p, x, y) = self.face_frame(reference as usize, false);
        for v in 0..self.verts.len() {
            let delta = sub(self.point(v as u32), p[origin]);
            self.verts[v].uv = [dot(delta, x), dot(delta, y)];
        }
        let plane = self.optimize_infinite_stretch();
        self.parameterized = plane;
        self.stretch_l2 = self.base_l2;
        Ok(plane)
    }

    /// The chart unfolded when it is plane-like; whether it is.
    pub(crate) fn process_plane_like(
        &mut self,
        computed: usize,
        primary: usize,
    ) -> crate::Result<bool> {
        if (self.sub_chart && computed > 2) || primary > 2 {
            return Ok(false);
        }
        let Some(reference) = self.reference_face() else {
            return Ok(false);
        };
        let mut placed = vec![false; self.verts.len()];
        let mut added = vec![false; self.faces.len()];
        let (origin, p, x, y) = self.face_frame(reference, true);
        let corners = self.faces[reference].verts;
        let mut laid = [[0f32; 2]; 3];
        for i in 0..3 {
            let k = (origin + i) % 3;
            let delta = sub(p[k], p[origin]);
            let uv = [dot(delta, x), dot(delta, y)];
            self.verts[corners[k] as usize].uv = uv;
            laid[k] = uv;
            placed[corners[k] as usize] = true;
        }
        let positive = cross_z(sub(laid[1], laid[0]), sub(laid[2], laid[0])) >= 0.0;
        let mut queue = VecDeque::from([reference as u32]);
        added[reference] = true;
        while let Some(f) = queue.pop_front() {
            let face = self.faces[f as usize];
            if let Some(i) = (0..3).find(|&i| !placed[face.verts[i] as usize]) {
                let ids = [
                    face.verts[(i + 1) % 3],
                    face.verts[(i + 2) % 3],
                    face.verts[i],
                ];
                if !self.unfold_vertex(i, ids, positive)? {
                    return Ok(false);
                }
                placed[ids[2] as usize] = true;
            }
            for e in face.edges {
                let edge = &self.edges[e as usize];
                let next = edge.other_face(face.id);
                if next != NONE && !added[next as usize] {
                    queue.push_back(next);
                    added[next as usize] = true;
                }
            }
        }
        if self.self_overlapping() {
            return Ok(false);
        }
        let plane_like = self.optimize_infinite_stretch();
        self.parameterized = plane_like;
        self.stretch_l2 = self.base_l2;
        Ok(plane_like)
    }

    /// Vertex `ids[2]` laid from the placed edge `ids[0] ids[1]` of its face, `slot` its corner
    /// there; `false` when that edge has no length (the unfolding stops).
    fn unfold_vertex(&mut self, slot: usize, ids: [u32; 3], positive: bool) -> crate::Result<bool> {
        let [a, b, c] = ids.map(|v| self.point(v));
        let (along, toward) = (sub(b, a), sub(c, a));
        let (length1, length2) = (length(along), length(toward));
        if near_zero(length1) {
            return Ok(false);
        }
        let start = self.verts[ids[0] as usize].uv;
        if near_zero(length2) {
            self.verts[ids[2] as usize].uv = start;
            return Ok(true);
        }
        let cos = (dot(along, toward) / (length1 * length2)).clamp(-1.0, 1.0);
        let mut sin = root(1.0 - cos * cos);
        let d = unit(sub(self.verts[ids[1] as usize].uv, start));
        let turned = |sin: f32| [d[0] * cos - d[1] * sin, d[1] * cos + d[0] * sin];
        let mut laid = [[0f32; 2]; 3];
        laid[slot] = turned(sin);
        laid[(slot + 1) % 3] = [0.0, 0.0];
        laid[(slot + 2) % 3] = d;
        if positive != (cross_z(sub(laid[1], laid[0]), sub(laid[2], laid[0])) >= 0.0) {
            sin = -sin;
        }
        let [x, y] = turned(sin);
        let uv = [length2 * x + start[0], length2 * y + start[1]];
        if !uv[0].is_finite() || !uv[1].is_finite() {
            return Err(failed("an unfolded vertex is not finite"));
        }
        self.verts[ids[2] as usize].uv = uv;
        Ok(true)
    }

    /// Whether two edges that share no vertex, beside faces of area above `ZERO2`, cross in the
    /// plane away from their ends. Every edge is tried against the ones after it, the edges on
    /// all threads: whether any pair does is the same in any order.
    fn self_overlapping(&self) -> bool {
        let uvs: Vec<[f32; 2]> = self.verts.iter().map(|v| v.uv).collect();
        let (edges, faces, areas) = (&self.edges, &self.faces, &self.source.areas);
        let uv = |v: u32| uvs[v as usize];
        let flat = |f: u32| f != NONE && near_zero2(areas[faces[f as usize].root as usize]);
        let apart = |a: [f32; 2], b: [f32; 2]| !near_zero(length(sub(a, b)));
        edges.par_iter().enumerate().any(|(i, e1)| {
            edges[i + 1..].iter().any(|e2| {
                if e1.verts.iter().any(|v| e2.verts.contains(v)) {
                    return false;
                }
                let [v1, v2, v3, v4] = [e1.verts[0], e1.verts[1], e2.verts[0], e2.verts[1]].map(uv);
                segments_cross(v1, v2, v3, v4).is_some()
                    && !e1.faces.iter().chain(&e2.faces).any(|&f| flat(f))
                    && apart(v1, v3)
                    && apart(v1, v4)
                    && apart(v2, v3)
                    && apart(v2, v4)
            })
        })
    }
}
