//! One collapse carried out: the edge's faces dropped, the edges of the removed end that close a
//! dropped face merged into the kept end's (an edge left with no face dropped too), every link of
//! the removed end moved to the kept end, the kept end's quadric and faces' normals renewed, and
//! the costs of its edges remeasured.
use super::quadric::{cross_wide, difference};
use super::Simplifier;
use crate::hlod::flatten::uv::spectral::mesh::NONE;
use crate::hlod::flatten::uv::spectral::ranked::Ranked;
use crate::hlod::flatten::uv::spectral::util::{push_unique, remove_all, unit, ZERO};

impl<'s> Simplifier<'s> {
    /// Edge `e` collapsed onto `keep`, `remove` dropped.
    pub(super) fn collapse(
        &mut self,
        heap: &mut Ranked<f64>,
        weights: &mut [f64],
        e: u32,
        keep: u32,
        remove: u32,
    ) {
        self.verts[remove as usize].deleted = true;
        self.edges[e as usize].deleted = true;
        self.drop_faces(e, keep);
        self.merge_closing_edges(heap, e, keep, remove);
        self.move_links(keep, remove);
        self.renew_kept(keep, remove);
        for i in 0..self.verts[keep as usize].edges.len() {
            let edge = self.verts[keep as usize].edges[i];
            self.edge_cost(edge as usize);
            let mut weight = -(self.edges[edge as usize].cost.abs() as f32);
            if weight > -ZERO {
                weight = -ZERO;
            }
            weights[edge as usize] = weight as f64;
            heap.update(edge, weight as f64);
        }
    }

    /// The faces of edge `e` dropped from the lists of `keep` and of the vertices opposite.
    fn drop_faces(&mut self, e: u32, keep: u32) {
        let edge = &self.edges[e as usize];
        let (faces, opposite, sides) =
            (edge.faces, edge.opposite, if edge.boundary { 1 } else { 2 });
        for k in 0..sides {
            let face = faces[k];
            self.faces[face as usize].deleted = true;
            remove_all(&mut self.verts[keep as usize].faces, face);
            remove_all(&mut self.verts[opposite[k] as usize].faces, face);
        }
    }

    /// The edges of `remove` opposite `keep` dropped, each merged into the edge of `keep` that
    /// closed the same face.
    fn merge_closing_edges(
        &mut self,
        heap: &mut Ranked<f64>,
        current: u32,
        keep: u32,
        remove: u32,
    ) {
        let mut j = 0;
        while j < self.verts[remove as usize].edges.len() {
            let gone = self.verts[remove as usize].edges[j];
            j += 1;
            if gone == current || !self.opposite_to(gone, keep) {
                continue;
            }
            self.edges[gone as usize].deleted = true;
            heap.remove(gone);
            let side = if self.edges[gone as usize].opposite[0] == keep {
                0
            } else {
                1
            };
            let face = &self.faces[self.edges[gone as usize].faces[side] as usize];
            let kept = *face
                .edges
                .iter()
                .find(|&&k| k != current && k != gone)
                .expect("the face's third edge");
            if self.edges[gone as usize].boundary {
                self.merge_boundary_edge(heap, gone, kept, keep, remove);
            } else {
                self.merge_inner_edge(gone, kept, keep, remove);
            }
        }
    }

    /// The end of edge `e` that is not `v`.
    fn other_end(&self, e: u32, v: u32) -> u32 {
        let ends = self.edges[e as usize].verts;
        if ends[0] == v {
            ends[1]
        } else {
            ends[0]
        }
    }

    fn merge_boundary_edge(
        &mut self,
        heap: &mut Ranked<f64>,
        gone: u32,
        kept: u32,
        keep: u32,
        remove: u32,
    ) {
        if self.edges[kept as usize].boundary {
            self.edges[kept as usize].deleted = true;
            heap.remove(kept);
            let ends = self.edges[kept as usize].verts;
            let third = if ends[0] != keep { ends[0] } else { ends[1] };
            remove_all(&mut self.verts[keep as usize].verts, third);
            remove_all(&mut self.verts[keep as usize].edges, kept);
            remove_all(&mut self.verts[third as usize].verts, keep);
            remove_all(&mut self.verts[third as usize].edges, gone);
            remove_all(&mut self.verts[third as usize].edges, kept);
            return;
        }
        let edge = &mut self.edges[kept as usize];
        edge.boundary = true;
        if edge.opposite[0] == remove {
            edge.opposite[0] = edge.opposite[1];
            edge.faces[0] = edge.faces[1];
        }
        let third = self.other_end(kept, keep);
        remove_all(&mut self.verts[third as usize].edges, gone);
        let edge = &mut self.edges[kept as usize];
        edge.opposite[1] = NONE;
        edge.faces[1] = NONE;
    }

    fn merge_inner_edge(&mut self, gone: u32, kept: u32, keep: u32, remove: u32) {
        let g = (
            self.edges[gone as usize].opposite,
            self.edges[gone as usize].faces,
        );
        if self.edges[kept as usize].boundary {
            let side = if g.0[0] == keep { 1 } else { 0 };
            let edge = &mut self.edges[kept as usize];
            edge.opposite[0] = g.0[side];
            edge.faces[0] = g.1[side];
            let third = self.other_end(kept, keep);
            remove_all(&mut self.verts[third as usize].edges, gone);
            self.relink_face(self.edges[kept as usize].faces[0], gone, kept);
            return;
        }
        let side = if g.0[0] == keep { 1 } else { 0 };
        let (third, face) = (g.0[side], g.1[side]);
        let edge = &mut self.edges[kept as usize];
        let slot = if edge.opposite[0] == remove { 0 } else { 1 };
        edge.opposite[slot] = third;
        edge.faces[slot] = face;
        self.relink_face(face, gone, kept);
        let far = self.other_end(kept, keep);
        remove_all(&mut self.verts[far as usize].edges, gone);
    }

    /// Face `face`'s first edge `from` replaced by `to`.
    fn relink_face(&mut self, face: u32, from: u32, to: u32) {
        let edges = &mut self.faces[face as usize].edges;
        if let Some(k) = edges.iter().position(|&e| e == from) {
            edges[k] = to;
        }
    }

    /// Every vertex, edge and face of `remove` moved to `keep`.
    fn move_links(&mut self, keep: u32, remove: u32) {
        remove_all(&mut self.verts[keep as usize].verts, remove);
        for j in 0..self.verts[remove as usize].verts.len() {
            let n = self.verts[remove as usize].verts[j];
            if n == keep {
                continue;
            }
            remove_all(&mut self.verts[n as usize].verts, remove);
            push_unique(&mut self.verts[n as usize].verts, keep);
            push_unique(&mut self.verts[keep as usize].verts, n);
        }
        for j in 0..self.verts[remove as usize].edges.len() {
            let e = self.verts[remove as usize].edges[j];
            let edge = &mut self.edges[e as usize];
            if edge.deleted {
                continue;
            }
            if edge.verts[0] == remove {
                edge.verts[0] = keep;
            } else if edge.verts[1] == remove {
                edge.verts[1] = keep;
            }
            push_unique(&mut self.verts[keep as usize].edges, e);
        }
        let edges = &self.edges;
        self.verts[keep as usize]
            .edges
            .retain(|&e| !edges[e as usize].deleted);
        for j in 0..self.verts[remove as usize].faces.len() {
            let f = self.verts[remove as usize].faces[j];
            let face = &mut self.faces[f as usize];
            if face.deleted {
                continue;
            }
            if let Some(k) = face.verts.iter().position(|&v| v == remove) {
                face.verts[k] = keep;
            }
            push_unique(&mut self.verts[keep as usize].faces, f);
        }
        for j in 0..self.verts[remove as usize].faces.len() {
            let f = self.verts[remove as usize].faces[j];
            if self.faces[f as usize].deleted {
                continue;
            }
            for k in 0..3 {
                let edge = &mut self.edges[self.faces[f as usize].edges[k] as usize];
                if edge.verts.contains(&keep) {
                    continue;
                }
                if edge.opposite[0] == remove {
                    edge.opposite[0] = keep;
                } else if edge.opposite[1] == remove {
                    edge.opposite[1] = keep;
                }
            }
        }
    }

    /// `keep` takes `remove`'s boundary flag and planes; its quadric and its faces' normals are
    /// measured again.
    fn renew_kept(&mut self, keep: u32, remove: u32) {
        if self.verts[remove as usize].boundary {
            self.verts[keep as usize].boundary = true;
        }
        let planes = std::mem::take(&mut self.verts[remove as usize].quadrics);
        for q in planes {
            push_unique(&mut self.verts[keep as usize].quadrics, q);
        }
        self.vertex_error(keep as usize);
        for j in 0..self.verts[keep as usize].faces.len() {
            let f = self.verts[keep as usize].faces[j] as usize;
            let p = self.faces[f].verts.map(|v| self.point(v));
            let v1 = unit(difference(p[1], p[0]));
            let v2 = unit(difference(p[2], p[0]));
            self.faces[f].normal = unit(cross_wide(v1, v2));
        }
    }
}
