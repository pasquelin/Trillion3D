//! Bowties broken: a vertex whose faces form several fans, touching only at the vertex, gets a new
//! vertex for each fan after the first.
//!
//! For each vertex of more than two edges, its edges are taken in ring order; an edge not yet
//! reached starts a fan, walked face by face from the edge's first face and then its second, each
//! step crossing the face's other edge at the vertex. A walk that comes back to its first face
//! means the vertex's faces close into one ring: the vertex is left whole. Otherwise every fan
//! after the first moves its faces to a new vertex, numbered after all others. The new vertices
//! copy their vertex's root, boundary flag and importance, and take it as their parent, as every
//! vertex of the rebuilt list takes its own old index.
use crate::hlod::flatten::uv::spectral::mesh::{Chart, Vert, NONE};

/// A walk around a vertex from face to face across the edges at the vertex.
struct FanWalk {
    center: u32,
    begin: u32,
    edge: u32,
    face: u32,
}

impl FanWalk {
    /// One step: the face's other edge at the centre, then the face across it; whether the walk
    /// is on a face that is not its first.
    fn next(&mut self, chart: &Chart) -> bool {
        if self.face == NONE {
            return false;
        }
        let face = &chart.faces[self.face as usize];
        for &e in &face.edges {
            if e == self.edge {
                continue;
            }
            let edge = &chart.edges[e as usize];
            if edge.verts.contains(&self.center) {
                self.edge = e;
                self.face = edge.other_face(self.face);
                break;
            }
        }
        self.face != NONE && self.face != self.begin
    }
}

impl<'a> Chart<'a> {
    /// Every bowtie vertex split; whether any was.
    pub(crate) fn break_bowties(&mut self) -> bool {
        let old_count = self.verts.len() as u32;
        let mut next_id = old_count;
        let mut copied: Vec<u32> = Vec::new();
        let mut reached = vec![false; self.edges.len()];
        for v in 0..old_count {
            let ring = self.verts[v as usize].edges.clone();
            if ring.len() <= 2 {
                continue;
            }
            // The walks mark only edges at `v`, all in its ring: clear those alone.
            for &e in &ring {
                reached[e as usize] = false;
            }
            let mut clusters = 0;
            for &main in &ring {
                if reached[main as usize] {
                    continue;
                }
                let mut fan: Vec<u32> = Vec::new();
                let mut closed = false;
                for side in 0..2 {
                    let start = self.edges[main as usize].faces[side];
                    if start == NONE {
                        continue;
                    }
                    let mut walk = FanWalk {
                        center: v,
                        begin: start,
                        edge: main,
                        face: start,
                    };
                    loop {
                        reached[walk.edge as usize] = true;
                        if clusters > 0 {
                            fan.push(walk.face);
                        }
                        if !walk.next(self) {
                            break;
                        }
                    }
                    reached[walk.edge as usize] = true;
                    if walk.face == walk.begin {
                        closed = true;
                        break;
                    }
                }
                if closed {
                    break;
                }
                for &f in &fan {
                    let corners = &mut self.faces[f as usize].verts;
                    let k = if corners[0] == v {
                        0
                    } else if corners[1] == v {
                        1
                    } else {
                        2
                    };
                    corners[k] = next_id;
                }
                if clusters > 0 {
                    copied.push(v);
                    next_id += 1;
                }
                clusters += 1;
            }
        }
        if next_id == old_count {
            return false;
        }
        let rebuilt = (0..old_count).chain(copied.iter().copied());
        self.verts = (rebuilt.enumerate())
            .map(|(i, old)| {
                let old = &self.verts[old as usize];
                Vert::cut_from(i, old)
            })
            .collect();
        true
    }
}
