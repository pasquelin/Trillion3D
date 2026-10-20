//! THE sampled Hausdorff distance between a fixed set of triangles — a primitive's level 0 — and a
//! cut: the fixed side's grid is built once and kept for every cut measured against it, the cut's
//! grid is built while its own side runs on the compiler's pool, and the first side found raises
//! the floor of the second, so a sample under it is never measured exactly. Each side and their
//! maximum are the serial measure's, bit for bit.
use super::bounded::raised;
use super::{one_sided, Grid};

pub(crate) struct Level0<'a>(Grid<'a>);

impl<'a> Level0<'a> {
    pub(crate) fn new(pos: &'a [f32], triangles: &'a [u32]) -> Self {
        Self(Grid::new(pos, triangles))
    }

    /// `floor.max(distance(level 0, cut))`, a zero as `+0`; the floor raised to `0` when either
    /// side is empty. A search passes `0.0`.
    pub(crate) fn distance(&self, cut: &[u32], floor: f64) -> f64 {
        let Self(level0) = self;
        if level0.triangles.is_empty() || cut.is_empty() {
            return raised(floor, 0.0);
        }
        let (to_level0, grid_cut) = rayon::join(
            || one_sided(level0.pos, cut, level0, floor),
            || Grid::new(level0.pos, cut),
        );
        let floor = floor.max(to_level0);
        raised(
            floor,
            one_sided(level0.pos, level0.triangles, &grid_cut, floor),
        )
    }
}
