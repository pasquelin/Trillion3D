//! Every edge of a chart, found face by face.
//!
//! Each face's three edges, from corner k to corner k + 1, are looked up under their lesser
//! vertex: a new edge takes the face as its first, the corner opposite as its first opposite
//! vertex, and is a splittable boundary; an edge met again takes the face as its second and stops
//! being a boundary; an edge met a third time makes the chart a non-manifold, the search stopping
//! there. Each corner's vertex lists the face as it goes; once all faces are read, each edge is
//! listed by its two vertices, in edge order.
use crate::hlod::flatten::uv::spectral::mesh::{Chart, Edge, NONE};

impl<'a> Chart<'a> {
    /// Every vertex's rings emptied.
    pub(crate) fn clear_rings(&mut self) {
        for v in &mut self.verts {
            v.verts.clear();
            v.edges.clear();
            v.faces.clear();
        }
    }

    /// Every edge found; `false` when an edge has more than two faces.
    pub(crate) fn find_edges(&mut self) -> bool {
        self.edges.clear();
        let mut table: Vec<Vec<(u32, u32)>> = vec![Vec::new(); self.verts.len()];
        for i in 0..self.faces.len() {
            let corners = self.faces[i].verts;
            for j in 0..3 {
                let (mut a, mut b) = (corners[j], corners[(j + 1) % 3]);
                self.verts[a as usize].faces.push(i as u32);
                if a > b {
                    std::mem::swap(&mut a, &mut b);
                }
                let found = table[a as usize]
                    .iter()
                    .find(|&&(peer, _)| peer == b)
                    .map(|&(_, e)| e);
                let id = match found {
                    None => {
                        let id = self.edges.len() as u32;
                        self.edges.push(Edge {
                            id,
                            verts: [corners[j], corners[(j + 1) % 3]],
                            faces: [i as u32, NONE],
                            opposite: [corners[(j + 2) % 3], NONE],
                            boundary: true,
                            splittable: true,
                            ..Edge::default()
                        });
                        table[a as usize].push((b, id));
                        id
                    }
                    Some(id) => {
                        let edge = &mut self.edges[id as usize];
                        if edge.faces[1] != NONE {
                            return false;
                        }
                        edge.faces[1] = i as u32;
                        edge.opposite[1] = corners[(j + 2) % 3];
                        edge.boundary = false;
                        id
                    }
                };
                self.faces[i].edges[j] = id;
            }
        }
        for i in 0..self.edges.len() {
            let [a, b] = self.edges[i].verts;
            self.verts[a as usize].edges.push(i as u32);
            self.verts[b as usize].edges.push(i as u32);
        }
        true
    }
}
