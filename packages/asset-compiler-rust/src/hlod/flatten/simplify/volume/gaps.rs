//! The gaps between the sources closed (`close_gaps`): the field's surface moved outward by the
//! gap's radius in steps of at most a voxel and a half — each step the surface drawn at the step's
//! distance and drawn again into a new field —, so surfaces closer than twice that radius meet,
//! then moved back inward by the same steps and half a voxel more, and the result united with the
//! untouched field: the gaps come back plugged, every other surface as it was. A radius that needs
//! more steps than the layer allows is stepped on a coarser grid instead, its voxel the step over
//! a voxel and a half, the first step outward and the last inward then the remainder between the
//! two grids' voxels.
use super::field::{field, prune_level_set, union, Polygons};
use super::surface::{surface, Polygonal};
use super::tree::Tree;
use crate::plugins::scene::cancel::check;
use std::sync::atomic::AtomicBool;

/// The most a single step moves the surface, in voxels of the grid it steps on.
const MOST_STEP: f64 = 1.5;

/// The adaptivity a stepped surface is drawn with: next to none, so its shape survives the step.
const STEP_ADAPTIVITY: f64 = 0.001;

/// The values the inactive parts of a field are set to once it is made, outside then inside —
/// two world units whatever the voxel, as the method prunes.
const PRUNED: (f32, f32) = (2.0, -2.0);

/// A field and the voxel, world units, it is sampled on.
struct Grid {
    tree: Tree<f32>,
    voxel: f64,
}

/// A drawn surface's quads then triangles, as a field reads them, in the index space of a grid of
/// voxel `1 / inverse`.
struct Drawn<'a> {
    polygonal: &'a Polygonal,
    inverse: f64,
}

impl Polygons for Drawn<'_> {
    fn count(&self) -> usize {
        self.polygonal.quads.len() + self.polygonal.triangles.len()
    }
    fn corners(&self, polygon: usize) -> usize {
        match polygon < self.polygonal.quads.len() {
            true => 4,
            false => 3,
        }
    }
    fn point(&self, polygon: usize, corner: usize) -> [f64; 3] {
        let quads = &self.polygonal.quads;
        let v = match polygon < quads.len() {
            true => quads[polygon][corner],
            false => self.polygonal.triangles[polygon - quads.len()][corner],
        };
        self.polygonal.points[v as usize].map(|x| f64::from(x) * self.inverse)
    }
}

/// The field of `polygons` on a grid of `voxel` world units, pruned as the method prunes a field
/// it makes (`PRUNED`).
pub(in crate::hlod::flatten::simplify) fn pruned_field(
    polygons: &impl Polygons,
    voxel: f64,
    cancelled: &AtomicBool,
) -> crate::Result<super::field::Field> {
    let mut made = field(polygons, voxel, cancelled)?;
    prune_level_set(&mut made.distance, PRUNED.0, PRUNED.1);
    Ok(made)
}

/// The surface of `tree`, a field on a grid of `on` world units, moved by `by` world units —
/// outward when positive — on a new grid of `voxel`: the surface at `by` drawn and drawn again into
/// a field.
fn offset(
    (tree, on): (&Tree<f32>, f64),
    by: f64,
    voxel: f64,
    cancelled: &AtomicBool,
) -> crate::Result<Grid> {
    let drawn = surface(tree, on, by, STEP_ADAPTIVITY);
    let polygons = Drawn {
        polygonal: &drawn,
        inverse: 1.0 / voxel,
    };
    let tree = pruned_field(&polygons, voxel, cancelled)?.distance;
    check(cancelled)?;
    Ok(Grid { tree, voxel })
}

/// The field a step starts from: the last one made, else the untouched one, `source`.
fn latest<'a>(made: &'a Option<Grid>, source: (&'a Tree<f32>, f64)) -> (&'a Tree<f32>, f64) {
    made.as_ref()
        .map_or(source, |grid| (&grid.tree, grid.voxel))
}

/// `volume`, a field on a grid of `voxel` world units, with the gaps up to twice `radius` closed
/// in at most `steps` steps each way (module doc); left as it is when `radius` is under a voxel.
pub(in crate::hlod::flatten::simplify) fn close_gaps(
    volume: &mut Tree<f32>,
    voxel: f64,
    (radius, steps): (f64, i32),
    cancelled: &AtomicBool,
) -> crate::Result<()> {
    if radius < voxel {
        return Ok(());
    }
    let default_step = MOST_STEP * voxel;
    let default_count = ((radius / (MOST_STEP * voxel)) as f32).floor() as i32;
    let default_remainder = radius - f64::from(default_count) * default_step;
    let coarse = steps < default_count;
    let (step, remainder, working, count) = match coarse {
        false => (default_step, default_remainder, voxel, default_count),
        true => {
            let step = (radius - voxel) / f64::from(steps);
            (step, voxel, step / MOST_STEP, steps)
        }
    };
    let with_remainder = coarse || remainder > 0.1 * voxel;
    let mut made: Option<Grid> = None;
    if with_remainder {
        made = Some(offset(
            latest(&made, (&*volume, voxel)),
            remainder,
            working,
            cancelled,
        )?);
    }
    for _ in 0..count {
        made = Some(offset(
            latest(&made, (&*volume, voxel)),
            step,
            working,
            cancelled,
        )?);
    }
    for _ in 0..count {
        made = Some(offset(
            latest(&made, (&*volume, voxel)),
            -step,
            working,
            cancelled,
        )?);
    }
    if with_remainder {
        made = Some(offset(
            latest(&made, (&*volume, voxel)),
            -remainder,
            voxel,
            cancelled,
        )?);
    }
    let plugs = offset(
        latest(&made, (&*volume, voxel)),
        -0.5 * voxel,
        voxel,
        cancelled,
    )?;
    // The steps' fields let go before the union.
    drop(made);
    union(volume, plugs.tree);
    prune_level_set(volume, PRUNED.0, PRUNED.1);
    Ok(())
}
