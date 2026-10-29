//! A parameterised chart split in two by distance, along a single cut.
//!
//! The faces join the nearer of two representatives, the labels are smoothed, made valid and
//! built into two children, their border moved by a graph cut on the dihedral angle (when the
//! moved labels do not hold, the labels are read back from the children). The border is then
//! made one cut path: its edges split into the marginal ones (touching the boundary) and the
//! inner ones; from each marginal edge in turn, a path follows inner edges, each the first in
//! order that continues it, until a marginal edge closes it on the boundary. The longest path
//! (the first among equals, measured without its closing edge) is kept, and the labels grow
//! breadth first from the faces beside it. The children are built from these labels and keep
//! their parent's plane positions.
use crate::hlod::flatten::uv::spectral::mesh::{Chart, NONE};
use std::collections::VecDeque;

/// The parts the chart is split into.
const PARTS: usize = 2;

impl<'a> Chart<'a> {
    /// The chart split in two around the representatives `representatives` (rows of
    /// `distances`).
    pub(crate) fn split_by_distance(
        &mut self,
        distances: &[f32],
        representatives: &[u32],
    ) -> crate::Result<()> {
        let mut face_charts = self.cluster_faces(distances, representatives);
        if !self.smooth_partition(PARTS, &mut face_charts)? {
            return Ok(());
        }
        if !self.build_sub_charts(&face_charts, PARTS)? || self.children.len() < 2 {
            return Ok(());
        }
        if !self
            .optimize_boundary_by_angle(&mut face_charts, PARTS)?
            .unwrap_or(true)
        {
            for (i, child) in self.children.iter().enumerate() {
                for face in &child.faces {
                    face_charts[face.parent as usize] = i as u32;
                }
            }
        }
        self.single_cut(&mut face_charts);
        self.build_sub_charts(&face_charts, PARTS)?;
        let parent = &self.verts;
        for child in &mut self.children {
            for v in &mut child.verts {
                v.uv = parent[v.parent as usize].uv;
            }
            child.parameterized = true;
        }
        Ok(())
    }

    /// The labels `face_charts` grown from the longest cut path of their border.
    fn single_cut(&self, face_charts: &mut [u32]) {
        let (mut inner, mut marginal) = (Vec::new(), Vec::new());
        for edge in &self.edges {
            if edge.boundary
                || face_charts[edge.faces[0] as usize] == face_charts[edge.faces[1] as usize]
            {
                continue;
            }
            if self.verts[edge.verts[0] as usize].boundary
                || self.verts[edge.verts[1] as usize].boundary
            {
                marginal.push(edge.id);
            } else {
                inner.push(edge.id);
            }
        }
        if marginal.is_empty() {
            return;
        }
        let path = self.longest_cut_path(inner, marginal);
        self.grow_from_path(&path, face_charts);
    }

    /// The longest of the paths from each marginal edge in turn through inner edges to another
    /// marginal edge, the edges used by one path left out of the next.
    fn longest_cut_path(&self, mut inner: Vec<u32>, mut marginal: Vec<u32>) -> Vec<u32> {
        let mut longest = -f32::MAX;
        let mut kept = Vec::new();
        while !marginal.is_empty() {
            let start = &self.edges[marginal.remove(0) as usize];
            let mut path = vec![start.id];
            let [a, b] = start.verts;
            let mut next = if self.verts[a as usize].boundary {
                b
            } else {
                a
            };
            let mut length = start.length;
            let mut end = NONE;
            if self.verts[a as usize].boundary && self.verts[b as usize].boundary {
                end = next;
            }
            while end == NONE && !(marginal.is_empty() && inner.is_empty()) {
                if let Some((at, _)) = self.edge_from(&marginal, next) {
                    path.push(marginal.remove(at));
                    break;
                }
                let Some((at, far)) = self.edge_from(&inner, next) else {
                    break;
                };
                next = far;
                let e = inner.remove(at);
                length += self.edges[e as usize].length;
                path.push(e);
            }
            if length > longest {
                longest = length;
                kept = path;
            }
        }
        kept
    }

    /// The first of `edges` with an end at vertex `v`: its place and its other end.
    fn edge_from(&self, edges: &[u32], v: u32) -> Option<(usize, u32)> {
        edges.iter().enumerate().find_map(|(at, &e)| {
            let [a, b] = self.edges[e as usize].verts;
            if a == v {
                Some((at, b))
            } else if b == v {
                Some((at, a))
            } else {
                None
            }
        })
    }

    /// Every face labelled breadth first from the faces beside the edges of `path`, each taking
    /// the label of the face it is reached from.
    fn grow_from_path(&self, path: &[u32], face_charts: &mut [u32]) {
        let mut reached = vec![false; self.faces.len()];
        let mut queue = VecDeque::new();
        for &e in path {
            let [f0, f1] = self.edges[e as usize].faces;
            reached[f0 as usize] = true;
            reached[f1 as usize] = true;
            queue.push_back(f0);
            queue.push_back(f1);
        }
        while let Some(f) = queue.pop_front() {
            for e in self.faces[f as usize].edges {
                let edge = &self.edges[e as usize];
                if edge.boundary {
                    continue;
                }
                let next = edge.other_face(f);
                if !reached[next as usize] {
                    face_charts[next as usize] = face_charts[f as usize];
                    reached[next as usize] = true;
                    queue.push_back(next);
                }
            }
        }
    }
}
