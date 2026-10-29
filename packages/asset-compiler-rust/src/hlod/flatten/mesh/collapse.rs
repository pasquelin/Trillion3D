//! An edge collapsed, its removed vertex welded onto the kept one (`collapse_edge`), refused when
//! the weld would break the mesh:
//!
//! - its two triangles share their far corner (the same triangle twice);
//! - a vertex other than the far corners neighbours both ends — welding them would set more than
//!   two triangles on one side, or close a hole of one triangle, neither allowed;
//! - the removed vertex has three edges and the edge between the far corners is held by two
//!   triangles, one of each end: the edge is a side of a tetrahedron;
//! - on the boundary, the removed vertex's edge to the far corner and the kept one's both lie on
//!   the boundary: the triangle stands alone (`Refused::Triangle`, the others `Refused::Other`);
//! - a held edge whose two ends both lie on the boundary.
//!
//! The weld: each of the removed vertex's edges in visiting order — the edge itself unlisted by
//! the kept vertex, the edges to the far corners unlisted by those corners, every other edge moved
//! onto the kept vertex and listed by it —, each triangle on it but the collapsed ones made to name
//! the kept vertex; then the removed vertex, the collapsed triangles and the removed vertex's edges
//! to the far corners freed, the kept vertex's edges to the far corners taking the triangles
//! across. Points stay with the caller: the kept vertex's point is the caller's to keep.
use super::links::wound;
use super::{Mesh, NONE};

/// What a collapse takes away, as its checks find it: the far corners, the collapsed triangles,
/// the collapsed edge, and the removed vertex's edges to the far corners — `NONE` for the second
/// on the boundary.
pub(crate) struct Collapse {
    pub(crate) across: [usize; 2],
    pub(crate) faces: [usize; 2],
    pub(crate) edge: usize,
    pub(crate) removed: [usize; 2],
}

/// Why a collapse was refused: the edge's last triangle would stand alone, or any other reason.
pub(crate) enum Refused {
    Triangle,
    Other,
}

impl Mesh {
    /// The edge between standing vertices `keep` and `remove` collapsed onto `keep` (module doc),
    /// what it took away; why not when it is refused.
    pub(crate) fn collapse_edge(
        &mut self,
        keep: usize,
        remove: usize,
    ) -> Result<Collapse, Refused> {
        let plan = self.plan(keep, remove)?;
        let Collapse {
            across: [c, d],
            faces: [t0, t1],
            edge,
            removed: [eac, ead],
        } = plan;
        let (a, b) = (remove, keep);
        let (mut tac, mut tad) = (NONE, NONE);
        // The removed vertex lists no edge from here on.
        for e in std::mem::take(&mut self.around[a]) {
            let e = e as usize;
            let o = self.other(e, a);
            if o == b {
                self.unlink(b, e);
            } else if o == c {
                self.unlink(c, e);
                tac = self.other_face(e, t0);
            } else if o == d {
                self.unlink(d, e);
                tad = self.other_face(e, t1);
            } else {
                self.replace_end(e, a, b);
                self.link(b, e);
            }
            for t in self.faces(e) {
                if t != NONE && t != t0 && t != t1 && self.corners(t).contains(&a) {
                    self.replace_corner(t, a, b);
                    self.vertex_ids.count_up(b, 1);
                    self.vertex_ids.count_down(a, 1);
                }
            }
        }
        if t1 != NONE {
            self.vertex_ids.count_down(a, 3);
            self.triangle_ids.count_down(t0, 1);
            self.triangle_ids.count_down(t1, 1);
            self.vertex_ids.count_down(c, 1);
            self.vertex_ids.count_down(d, 1);
            self.vertex_ids.count_down(b, 2);
            self.edge_ids.count_down(ead, 1);
            self.edge_ids.count_down(edge, 1);
            self.edge_ids.count_down(eac, 1);
            let ebd = self.side_on(t1, b, d);
            let ebc = self.side_on(t0, b, c);
            self.replace_face(ebd, t1, tad);
            self.replace_face(ebc, t0, tac);
            if tad != NONE {
                self.replace_side(tad, ead, ebd);
            }
            if tac != NONE {
                self.replace_side(tac, eac, ebc);
            }
        } else {
            self.vertex_ids.count_down(a, 2);
            self.triangle_ids.count_down(t0, 1);
            self.vertex_ids.count_down(c, 1);
            self.vertex_ids.count_down(b, 1);
            self.edge_ids.count_down(edge, 1);
            self.edge_ids.count_down(eac, 1);
            let ebc = self.side_on(t0, b, c);
            self.replace_face(ebc, t0, tac);
            if tac != NONE {
                self.replace_side(tac, eac, ebc);
            }
        }
        Ok(plan)
    }

    /// The collapse of the edge between `b`, kept, and `a`, removed, once every check passes
    /// (module doc); why not when one refuses it or no edge joins them.
    fn plan(&self, b: usize, a: usize) -> Result<Collapse, Refused> {
        let edge = self.find_edge(a, b).ok_or(Refused::Other)?;
        let [t0, t1] = self.faces(edge);
        let c = wound(a, b, self.corners(t0))[2];
        let open = t1 == NONE;
        let d = if open {
            NONE
        } else {
            wound(a, b, self.corners(t1))[2]
        };
        if !open && c == d {
            return Err(Refused::Other);
        }
        let (mut eac, mut ead) = (NONE, NONE);
        for e in self.edges_at(a) {
            let x = self.other(e, a);
            if x == c {
                eac = e;
            } else if x == d {
                ead = e;
            } else if x != b && self.neighbours(b).any(|y| y == x) {
                return Err(Refused::Other);
            }
        }
        if self.around[a].len() == 3 && !open {
            let held = self.find_edge(d, c).map(|edc| self.faces(edc));
            if let Some([s0, s1]) = held.filter(|&[_, s1]| s1 != NONE) {
                let names = |t: usize, v: usize| self.corners(t).contains(&v);
                if (names(s0, a) && names(s1, b)) || (names(s0, b) && names(s1, a)) {
                    return Err(Refused::Other);
                }
            }
        } else if open && self.is_boundary(eac) && self.is_boundary(self.side_on(t0, b, c)) {
            return Err(Refused::Triangle);
        }
        if !open && self.is_boundary_vertex(a) && self.is_boundary_vertex(b) {
            return Err(Refused::Other);
        }
        Ok(Collapse {
            across: [c, d],
            faces: [t0, t1],
            edge,
            removed: [eac, ead],
        })
    }

    /// Whether one of vertex `v`'s edges lies on the boundary.
    fn is_boundary_vertex(&self, v: usize) -> bool {
        self.edges_at(v).any(|e| self.is_boundary(e))
    }
}
