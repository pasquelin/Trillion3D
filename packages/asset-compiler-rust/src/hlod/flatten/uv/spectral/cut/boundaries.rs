//! A chart's boundaries, and the cut that joins two of them.
//!
//! The boundary vertices are grouped in vertex order: each boundary vertex not yet grouped opens
//! a group, which grows breadth first through the first and last neighbours of its vertices (a
//! boundary vertex's ring starts and ends on its boundary neighbours). With two boundaries or
//! more, a search from every vertex of each boundary in turn finds the nearest vertex of another
//! boundary along edges; the shortest of those paths, the first among equals, is cut open.
use super::dijkstra::Stop;
use crate::hlod::flatten::uv::spectral::fail::failed;
use crate::hlod::flatten::uv::spectral::mesh::{Chart, NONE};

/// The boundary vertices grouped: the vertices of each group in turn, where each group starts,
/// and each vertex's group (from 1, 0 off the boundary).
struct Boundaries {
    vertices: Vec<u32>,
    starts: Vec<u32>,
    group_of: Vec<u32>,
}

impl<'a> Chart<'a> {
    /// The chart's boundaries counted, edges measured, and a cut made as a child when there are
    /// two or more; how many boundaries it had.
    pub(crate) fn cut_extra_boundaries(&mut self) -> crate::Result<usize> {
        self.measure_edges();
        let boundaries = self.find_boundaries();
        let count = boundaries.starts.len() - 1;
        if count >= 2 {
            let path = self.shortest_path_between(&boundaries)?;
            self.cut_along(&path)?;
        }
        Ok(count)
    }

    fn find_boundaries(&self) -> Boundaries {
        let count = self.verts.len();
        let mut group_of = vec![0u32; count];
        let mut vertices: Vec<u32> = Vec::new();
        let mut starts = vec![0u32];
        let mut group = 0;
        let mut v = 0;
        while v < count {
            while v < count && !(self.verts[v].boundary && group_of[v] == 0) {
                v += 1;
            }
            if v >= count {
                break;
            }
            group += 1;
            group_of[v] = group;
            vertices.push(v as u32);
            let mut head = vertices.len() - 1;
            while head < vertices.len() {
                let ring = &self.verts[vertices[head] as usize].verts;
                if let (Some(&first), Some(&last)) = (ring.first(), ring.last()) {
                    for n in [first, last] {
                        if self.verts[n as usize].boundary && group_of[n as usize] == 0 {
                            group_of[n as usize] = group;
                            vertices.push(n);
                        }
                    }
                }
                head += 1;
            }
            starts.push(vertices.len() as u32);
        }
        Boundaries {
            vertices,
            starts,
            group_of,
        }
    }

    /// The shortest edge path from one boundary to another.
    fn shortest_path_between(&mut self, boundaries: &Boundaries) -> crate::Result<Vec<u32>> {
        let avoid = self.source.false_edges.is_some();
        let mut shortest = f32::MAX;
        let mut path = Vec::new();
        for g in 0..boundaries.starts.len() - 1 {
            let (from, to) = (
                boundaries.starts[g] as usize,
                boundaries.starts[g + 1] as usize,
            );
            let sources = &boundaries.vertices[from..to];
            let stop = Stop {
                boundary_of: &boundaries.group_of,
                own: boundaries.group_of[sources[0] as usize],
            };
            let (peer, distance) = match self.edge_search(sources, avoid, Some(&stop)) {
                Some(peer) => (peer, self.verts[peer as usize].geodesic),
                None => (NONE, 0.0),
            };
            if distance < shortest {
                if peer == NONE {
                    return Err(failed("a boundary reaches no other boundary"));
                }
                shortest = distance;
                path = self.path_to_source(peer);
            }
        }
        Ok(path)
    }
}
