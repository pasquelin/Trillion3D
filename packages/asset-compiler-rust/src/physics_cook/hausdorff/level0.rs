//! The distance of each cut a search tries to one fixed level 0: level 0's grid is built once for
//! the whole search, not once per cut, and a cut's two sides are measured side by side on the
//! compiler's pool. Each side and their maximum are the serial measure's, bit for bit (#956).
use super::{one_sided, Grid};

pub(crate) struct Level0<'a>(Grid<'a>);

impl<'a> Level0<'a> {
    pub(crate) fn new(pos: &'a [f32], triangles: &'a [u32]) -> Self {
        Self(Grid::new(pos, triangles))
    }

    /// The sampled Hausdorff distance between level 0 and `cut`; zero if either is empty.
    pub(crate) fn distance(&self, cut: &[u32]) -> f64 {
        let Self(level0) = self;
        if level0.triangles.is_empty() || cut.is_empty() {
            return 0.0;
        }
        let (to_cut, to_level0) = rayon::join(
            || {
                one_sided(
                    level0.pos,
                    level0.triangles,
                    &Grid::new(level0.pos, cut),
                    0.0,
                )
            },
            || one_sided(level0.pos, cut, level0, 0.0),
        );
        to_cut.max(to_level0)
    }
}
