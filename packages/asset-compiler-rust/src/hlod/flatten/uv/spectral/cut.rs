//! A chart made simple before it is flattened: one connected object with one boundary, its
//! vertices ranked.
//!
//! - Objects: the vertices reached from each unreached vertex with a neighbour, breadth first;
//!   when one search reaches every vertex the chart is one object, else each search's vertices
//!   and their faces become a child chart, rebuilt.
//! - Boundaries (`boundaries`): the boundary vertices grouped by walking along the boundary; with
//!   two or more, the shortest edge path from any boundary to another (`dijkstra`) is cut open
//!   (`split`), the child having one boundary less.
//! - Ranking: the vertices' importance from the simplification, or every vertex kept when the
//!   chart has fewer than 25 vertices.
use super::fail::invalid_data;
use super::mesh::{Chart, KEEP, MIN_LANDMARKS};
use super::simplify::Simplifier;

mod boundaries;
mod dijkstra;
mod split;

impl<'a> Chart<'a> {
    /// The chart split into its connected objects as children; whether it had several.
    pub(crate) fn split_objects(&mut self) -> crate::Result<bool> {
        let count = self.verts.len();
        let mut reached = vec![false; count];
        let mut several = false;
        for start in 0..count {
            if reached[start] {
                continue;
            }
            reached[start] = true;
            if self.verts[start].verts.is_empty() {
                continue;
            }
            let mut object = vec![start as u32];
            let mut head = 0;
            while head < object.len() {
                let v = object[head] as usize;
                for &n in &self.verts[v].verts {
                    if !reached[n as usize] {
                        reached[n as usize] = true;
                        object.push(n);
                    }
                }
                head += 1;
            }
            if object.len() == count {
                return Ok(false);
            }
            several = true;
            let child = self.extract_object(&object)?;
            self.children.push(child);
        }
        Ok(several)
    }

    /// The child chart of the vertices `verts` and every face around them, rebuilt.
    fn extract_object(&self, verts: &[u32]) -> crate::Result<Chart<'a>> {
        let mut taken = vec![false; self.faces.len()];
        let mut faces = Vec::new();
        for &v in verts {
            for &f in &self.verts[v as usize].faces {
                if !taken[f as usize] {
                    taken[f as usize] = true;
                    faces.push(f);
                }
            }
        }
        let mut child = self.sub_chart(verts, &faces, self.sub_chart);
        if !child.connect()? {
            return Err(invalid_data("a connected piece is not a manifold"));
        }
        child.area_3d = child.area_3d_sum();
        child.base_l2 = child.base_l2_stretch();
        Ok(child)
    }

    /// Every vertex's importance, from the simplification.
    pub(crate) fn rank_vertices(&mut self) {
        if self.faces.is_empty() {
            return;
        }
        if self.verts.len() < MIN_LANDMARKS {
            for v in &mut self.verts {
                v.importance = KEEP;
            }
            return;
        }
        let mut simplifier = Simplifier::new(self.source, self);
        simplifier.simplify();
        for (i, v) in self.verts.iter_mut().enumerate() {
            v.importance = simplifier.importance(i);
        }
    }
}
