//! Every vertex's neighbours sorted around it, all vertices turning the same way.
//!
//! An inner vertex (as many edges as faces) starts from its first edge's other end; the next
//! neighbour is read from the first face of that edge, as the corner that follows the vertex in
//! the face's winding, then from each edge in turn as the corner opposite it on the side the walk
//! did not come from. A boundary vertex starts from a boundary edge whose first face winds from
//! the vertex to the edge's other end (its first boundary edge, else its second) and walks across
//! the inner edges to the other boundary edge. A vertex whose walk repeats a neighbour, finds no
//! edge to the next one, has a single boundary edge or more than two, is not a manifold.
//!
//! Each vertex's edges are then reordered by selection so the k-th joins its k-th neighbour.
use crate::hlod::flatten::uv::spectral::mesh::Chart;

impl<'a> Chart<'a> {
    /// The rank of vertex `v` in face `face`, 3 when absent.
    fn rank_in(&self, face: u32, v: u32) -> usize {
        let corners = self.faces[face as usize].verts;
        (0..3).find(|&k| corners[k] == v).unwrap_or(3)
    }

    /// The next neighbour after crossing edge `current`, having come across edge `previous`.
    fn across(&self, current: u32, previous: u32) -> u32 {
        let (c, p) = (
            &self.edges[current as usize],
            &self.edges[previous as usize],
        );
        if c.opposite[0] == p.verts[0] || c.opposite[0] == p.verts[1] {
            c.opposite[1]
        } else {
            c.opposite[0]
        }
    }

    /// The edge of vertex `v` that reaches `next`, its first in ring order.
    fn edge_to(&self, v: u32, next: u32) -> Option<u32> {
        let ring = &self.verts[v as usize].edges;
        ring.iter()
            .copied()
            .find(|&e| self.edges[e as usize].verts.contains(&next))
    }

    /// Every ring sorted; `false` when a vertex is not a manifold.
    pub(crate) fn sort_rings(&mut self) -> bool {
        for v in 0..self.verts.len() as u32 {
            let vert = &self.verts[v as usize];
            let (edge_count, face_count) = (vert.edges.len(), vert.faces.len());
            if edge_count == 0 {
                continue;
            }
            let sorted = if edge_count == face_count {
                self.sort_inner_ring(v)
            } else {
                self.sort_boundary_ring(v)
            };
            if !sorted {
                return false;
            }
            let vert = &self.verts[v as usize];
            let (neighbours, mut ring) = (vert.verts.clone(), vert.edges.clone());
            for (j, &next) in neighbours.iter().enumerate() {
                if let Some(k) =
                    (j..ring.len()).find(|&k| self.edges[ring[k] as usize].verts.contains(&next))
                {
                    ring.swap(j, k);
                }
            }
            self.verts[v as usize].edges = ring;
        }
        true
    }

    /// The ring of boundary vertex `v`.
    fn sort_boundary_ring(&mut self, v: u32) -> bool {
        self.verts[v as usize].boundary = true;
        let ring = self.verts[v as usize].edges.clone();
        let edge_count = ring.len();
        let Some(first) = ring.iter().position(|&e| self.edges[e as usize].boundary) else {
            return false;
        };
        let mut current = Some(ring[first]);
        let mut next = self.edges[ring[first] as usize].other_end(v);
        let face = self.edges[ring[first] as usize].faces[0];
        let k = self.rank_in(face, v);
        if self.faces[face as usize].verts[(k + 1) % 3] != next {
            let Some(second) =
                (first + 1..edge_count).find(|&j| self.edges[ring[j] as usize].boundary)
            else {
                return false;
            };
            current = Some(ring[second]);
            next = self.edges[ring[second] as usize].other_end(v);
            let face = self.edges[ring[second] as usize].faces[0];
            let m = self.rank_in(face, v);
            if m >= 3 || self.faces[face as usize].verts[(m + 1) % 3] != next {
                return false;
            }
        }
        let mut previous: Option<u32> = None;
        for j in 0..edge_count {
            if current == previous {
                return false;
            }
            self.verts[v as usize].verts.push(next);
            let edge = current.expect("an edge to the next neighbour");
            if let Some(p) = previous {
                if self.edges[edge as usize].boundary {
                    previous = current;
                    continue;
                }
                next = self.across(edge, p);
            } else {
                next = self.edges[edge as usize].opposite[0];
            }
            previous = current;
            current = self.edge_to(v, next);
            if current.is_none() && j + 1 < edge_count {
                return false;
            }
        }
        true
    }

    /// The ring of inner vertex `v`.
    fn sort_inner_ring(&mut self, v: u32) -> bool {
        self.verts[v as usize].boundary = false;
        let edge_count = self.verts[v as usize].edges.len();
        let mut current = self.verts[v as usize].edges[0];
        let mut next = self.edges[current as usize].other_end(v);
        let mut previous: Option<u32> = None;
        self.verts[v as usize].verts.push(next);
        for j in 1..edge_count {
            next = match previous {
                Some(p) => self.across(current, p),
                None => {
                    let face = self.edges[current as usize].faces[0];
                    let k = self.rank_in(face, v);
                    let e = &self.edges[current as usize];
                    if self.faces[face as usize].verts[(k + 1) % 3] == next {
                        e.opposite[0]
                    } else {
                        e.opposite[1]
                    }
                }
            };
            if self.verts[v as usize].verts[..j].contains(&next) {
                return false;
            }
            previous = Some(current);
            let Some(edge) = self.edge_to(v, next) else {
                return false;
            };
            current = edge;
            self.verts[v as usize].verts.push(next);
        }
        true
    }
}
