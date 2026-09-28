//! The distance of each cut a search tries to one fixed level 0: level 0's grid is built once for
//! the whole search, not once per cut, and a cut's two sides are measured side by side on the
//! compiler's pool. Each side and their maximum are those of `distance`, bit for bit (#956).
use super::{one_sided, Grid};

pub(crate) struct Level0<'a> {
    pos: &'a [f32],
    triangles: &'a [u32],
    grid: Grid<'a>,
}

impl<'a> Level0<'a> {
    pub(crate) fn new(pos: &'a [f32], triangles: &'a [u32]) -> Self {
        let grid = Grid::new(pos, triangles);
        Self {
            pos,
            triangles,
            grid,
        }
    }

    /// `distance(pos, level 0, cut)`; zero if either is empty.
    pub(crate) fn distance(&self, cut: &[u32]) -> f64 {
        if self.triangles.is_empty() || cut.is_empty() {
            return 0.0;
        }
        let (to_cut, to_level0) = rayon::join(
            || one_sided(self.pos, self.triangles, &Grid::new(self.pos, cut)),
            || one_sided(self.pos, cut, &self.grid),
        );
        to_cut.max(to_level0)
    }
}
