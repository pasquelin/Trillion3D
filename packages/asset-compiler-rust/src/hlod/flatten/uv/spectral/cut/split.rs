//! A chart cut open along an edge path, as a child with every vertex of the cut doubled.
//!
//! The cut starts at the last boundary vertex the path leaves and stops at the first boundary
//! vertex it meets again. One side of the cut is gathered vertex by vertex: at the first vertex
//! the ring's neighbours before the next cut vertex, at each middle vertex those after the previous
//! cut vertex until the next (or, when there are none, the one face the two cut edges share), at
//! the last vertex those after the previous cut vertex; each such neighbour's faces around the
//! cut vertex move to that cut vertex's double. The child takes the faces, the father's vertices
//! (each its own parent) and one new vertex per cut vertex, and is rebuilt.
use crate::hlod::flatten::uv::spectral::fail::{failed, invalid_data};
use crate::hlod::flatten::uv::spectral::mesh::{Chart, Vert, NONE};

impl<'a> Chart<'a> {
    /// The chart cut along `path` into a child.
    pub(super) fn cut_along(&mut self, path: &[u32]) -> crate::Result<()> {
        let cut = self.split_path(path);
        if cut.len() < 2 {
            return Err(failed("a cut path holds no inner edge"));
        }
        let (mut faces, owners) = self.faces_beside(&cut);
        let mut child = self.split_vertices(&cut, &mut faces, &owners);
        if !child.connect()? {
            return Err(invalid_data("a cut chart is not a manifold"));
        }
        self.children.push(child);
        Ok(())
    }

    /// The part of `path` to cut: from the vertex before the first inner vertex to the next
    /// boundary vertex.
    fn split_path(&self, path: &[u32]) -> Vec<u32> {
        let mut start = 0;
        while start + 1 < path.len() && self.verts[path[start] as usize].boundary {
            start += 1;
        }
        let Some(start) = start.checked_sub(1) else {
            return Vec::new();
        };
        let mut cut = Vec::new();
        for (i, &v) in path.iter().enumerate().skip(start) {
            cut.push(v);
            if i != start && self.verts[v as usize].boundary {
                break;
            }
        }
        cut
    }

    /// The faces on one side of `cut`, each with the cut vertex it touches.
    fn faces_beside(&self, cut: &[u32]) -> (Vec<u32>, Vec<u32>) {
        let mut faces = Vec::new();
        let mut owners = Vec::new();
        let ring = |v: u32| &self.verts[v as usize].verts;
        let first = cut[0];
        let side: Vec<u32> = ring(first)
            .iter()
            .copied()
            .take_while(|&n| n != cut[1])
            .collect();
        self.add_side_faces(first, &side, &mut faces, &mut owners);
        for i in 1..cut.len() - 1 {
            let (here, previous, next) = (cut[i], cut[i - 1], cut[i + 1]);
            let neighbours = ring(here);
            let size = neighbours.len() as u32;
            let back = neighbours
                .iter()
                .position(|&n| n == previous)
                .map_or(NONE, |p| p as u32);
            let mut side = Vec::new();
            for k in 1..size {
                let n = neighbours[(back.wrapping_add(k) % size) as usize];
                if n == next {
                    break;
                }
                side.push(n);
            }
            if side.is_empty() {
                let shared = self.verts[here as usize].faces.iter().copied().find(|&f| {
                    let corners = self.faces[f as usize].verts;
                    corners.contains(&previous) && corners.contains(&next)
                });
                if let Some(f) = shared {
                    faces.push(f);
                    owners.push(here);
                }
            }
            self.add_side_faces(here, &side, &mut faces, &mut owners);
        }
        let last = cut[cut.len() - 1];
        let previous = cut[cut.len() - 2];
        let neighbours = ring(last);
        let after = neighbours
            .iter()
            .position(|&n| n == previous)
            .map_or(0, |p| p + 1);
        let side = neighbours[after..].to_vec();
        self.add_side_faces(last, &side, &mut faces, &mut owners);
        (faces, owners)
    }

    /// Every face of each vertex of `side` that also has vertex `here`, listed with `here`.
    fn add_side_faces(&self, here: u32, side: &[u32], faces: &mut Vec<u32>, owners: &mut Vec<u32>) {
        for &n in side {
            for &f in &self.verts[n as usize].faces {
                if self.faces[f as usize].verts.contains(&here) {
                    faces.push(f);
                    owners.push(here);
                }
            }
        }
    }

    /// The child with the faces moved: the father gives up its faces.
    fn split_vertices(&mut self, cut: &[u32], faces: &mut [u32], owners: &[u32]) -> Chart<'a> {
        let mut child = Chart::new(self.source);
        child.sub_chart = self.sub_chart;
        child.diagonal = self.diagonal;
        child.faces = std::mem::take(&mut self.faces);
        let mut next = self.verts.len() as u32;
        for &v in cut {
            for j in 0..faces.len() {
                if faces[j] == NONE {
                    continue;
                }
                let corners = &mut child.faces[faces[j] as usize].verts;
                for k in 0..3 {
                    if corners[k] == v && owners[j] == v {
                        corners[k] = next;
                        faces[j] = NONE;
                    }
                }
            }
            next += 1;
        }
        let copy = |id: u32, from: &Vert| Vert {
            id,
            root: from.root,
            parent: from.id,
            importance: from.importance,
            ..Vert::default()
        };
        child.verts = self.verts.iter().map(|v| copy(v.id, v)).collect();
        let first_new = self.verts.len() as u32;
        for (j, &v) in cut.iter().enumerate() {
            child
                .verts
                .push(copy(first_new + j as u32, &self.verts[v as usize]));
        }
        child.area_3d = child.area_3d_sum();
        child.base_l2 = child.base_l2_stretch();
        child
    }
}
