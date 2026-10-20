//! An edge collapse and the removals it makes.
use super::{Collapsed, Mesh, Refused, NONE};

impl Mesh {
    /// `remove` collapsed into `keep`, refused unless the result stays a manifold: the link
    /// condition, no tetrahedron, no last triangle, no interior edge between two boundary
    /// vertices.
    pub(super) fn collapse(&mut self, keep: u32, remove: u32) -> Result<Collapsed, Refused> {
        let (b, a) = (keep, remove);
        let eab = self.find_edge(a, b).ok_or(Refused::Other)?;
        let (_, [t0, t1]) = self.edges[eab as usize];
        let c = self.other_vertex(t0, a, b);
        let boundary = t1 == NONE;
        let d = if boundary {
            NONE
        } else {
            self.other_vertex(t1, a, b)
        };
        if c == d {
            return Err(Refused::Other);
        }
        let (mut eac, mut ead) = (NONE, NONE);
        for &e in &self.vertex_edges[a as usize] {
            let x = self.other(e, a);
            if x == c {
                eac = e;
            } else if x == d {
                ead = e;
            } else if x != b && self.find_edge(b, x).is_some() {
                return Err(Refused::Other);
            }
        }
        let edges_a = self.vertex_edges[a as usize].len();
        if edges_a == 3 && !boundary {
            if let Some(edc) = self.find_edge(d, c) {
                let (_, [s, u]) = self.edges[edc as usize];
                if u != NONE {
                    let has = |t: u32, v: u32| self.triangles[t as usize].contains(&v);
                    if (has(s, a) && has(u, b)) || (has(s, b) && has(u, a)) {
                        return Err(Refused::Other);
                    }
                }
            }
        } else if boundary && self.boundary_edge(eac) {
            let ebc = self.find_edge(b, c).ok_or(Refused::Other)?;
            if self.boundary_edge(ebc) {
                return Err(Refused::Triangle);
            }
        }
        let boundary_vertex =
            |v: u32| (self.vertex_edges[v as usize].iter()).any(|&e| self.boundary_edge(e));
        if !boundary && boundary_vertex(a) && boundary_vertex(b) {
            return Err(Refused::Other);
        }
        // Edges of `a` handed to `b`, triangles of `a` renamed.
        let mut tac = NONE;
        let mut tad = NONE;
        let edges_of_a = std::mem::take(&mut self.vertex_edges[a as usize]);
        for &e in &edges_of_a {
            let o = self.other(e, a);
            if o == b {
                self.remove_from(b, e);
            } else if o == c {
                self.remove_from(c, e);
                let [s, u] = self.edges[e as usize].1;
                tac = if s == t0 { u } else { s };
            } else if o == d {
                self.remove_from(d, e);
                let [s, u] = self.edges[e as usize].1;
                tad = if s == t1 { u } else { s };
            } else {
                self.edges[e as usize].0 = [o.min(b), o.max(b)];
                self.vertex_edges[b as usize].push(e);
            }
            for tj in self.edges[e as usize].1 {
                if tj != NONE && tj != t0 && tj != t1 {
                    for v in self.triangles[tj as usize].iter_mut() {
                        if *v == a {
                            *v = b;
                        }
                    }
                }
            }
        }
        let ebc = self.find_edge(b, c).ok_or(Refused::Other)?;
        self.replace_edge_triangle(ebc, t0, tac);
        self.edge_alive[eab as usize] = false;
        self.edge_alive[eac as usize] = false;
        self.triangle_alive[t0 as usize] = false;
        self.triangle_count -= 1;
        if !boundary {
            let ebd = self.find_edge(b, d).ok_or(Refused::Other)?;
            self.replace_edge_triangle(ebd, t1, tad);
            self.edge_alive[ead as usize] = false;
            self.triangle_alive[t1 as usize] = false;
            self.triangle_count -= 1;
        }
        self.vertex_alive[a as usize] = false;
        Ok(Collapsed {
            removed_tris: [t0, t1],
            opposing: [c, d],
        })
    }

    /// Triangle `t` removed, its orphaned edges and vertices with it.
    pub(super) fn remove_triangle(&mut self, t: u32) {
        let tv = self.triangles[t as usize];
        self.triangle_alive[t as usize] = false;
        self.triangle_count -= 1;
        for k in 0..3 {
            let (a, b) = (tv[k], tv[(k + 1) % 3]);
            if let Some(e) = self.find_edge(a, b) {
                self.replace_edge_triangle(e, t, NONE);
                if self.edges[e as usize].1[0] == NONE {
                    self.edge_alive[e as usize] = false;
                    self.remove_from(a, e);
                    self.remove_from(b, e);
                }
            }
        }
        for v in tv {
            if self.vertex_edges[v as usize].is_empty() {
                self.vertex_alive[v as usize] = false;
            }
        }
    }
}
