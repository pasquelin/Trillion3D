//! A chart's whole connectivity, in the steps the module describes, and the two checks it runs:
//! the winding of the faces across each inner edge, and the false edges, which no cut may follow.
use crate::hlod::flatten::uv::spectral::fail::failed;
use crate::hlod::flatten::uv::spectral::mesh::{Chart, NONE};

impl<'a> Chart<'a> {
    /// Edges, rings and split marks built from the faces; `false` when the chart is not a
    /// manifold.
    pub(crate) fn connect(&mut self) -> crate::Result<bool> {
        self.clear_rings();
        if !self.find_edges() {
            return Ok(false);
        }
        if self.needs_clean {
            self.needs_clean = false;
            if self.break_bowties() {
                self.clear_rings();
                if !self.find_edges() {
                    return Ok(false);
                }
            }
        }
        if !self.consistently_wound() || !self.sort_rings() {
            return Ok(false);
        }
        self.mark_unsplittable()?;
        Ok(true)
    }

    /// Whether the two faces of every inner edge lie on its two sides: each face's corners after
    /// its corner off the edge run the other way round in the other face.
    fn consistently_wound(&self) -> bool {
        let off_edge = |face: u32, verts: [u32; 2]| {
            let corners = self.faces[face as usize].verts;
            let k = (0..3).find(|&k| !verts.contains(&corners[k])).unwrap_or(3);
            (corners, k)
        };
        for edge in self.edges.iter().filter(|e| !e.boundary) {
            let (c1, j) = off_edge(edge.faces[0], edge.verts);
            let (c2, k) = off_edge(edge.faces[1], edge.verts);
            if c1[(j + 1) % 3] != c2[(k + 2) % 3] || c1[(j + 2) % 3] != c2[(k + 1) % 3] {
                return false;
            }
        }
        true
    }

    /// The false edges made unsplittable; an error when one is a boundary.
    fn mark_unsplittable(&mut self) -> crate::Result<()> {
        let Some(table) = self.source.false_edges.as_deref() else {
            return Ok(());
        };
        for face in &self.faces {
            for k in 0..3 {
                if table[face.root as usize * 3 + k] == NONE {
                    continue;
                }
                let edge = &mut self.edges[face.edges[k] as usize];
                if edge.boundary {
                    return Err(failed("a false edge became a boundary"));
                }
                edge.splittable = false;
            }
        }
        Ok(())
    }
}
