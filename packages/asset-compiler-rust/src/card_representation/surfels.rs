//! A mesh's surfels along one direction: the cells of the voxel volume that rays, cast through its
//! columns against the direction the card faces, find a surface in facing the card, each with the
//! share of its rays that did (its coverage), the first cell along the ray it is visible from
//! (`min_ray_z`) and the share of the hemisphere around it that sees out of the mesh. A surfel
//! inside the mesh's geometry is dropped (`visibility.rs`).
use super::visibility::visibility;
use super::volume::{Basis, Volume};
use crate::distance_field::Scene;
use rayon::prelude::*;
use std::sync::atomic::{AtomicUsize, Ordering};
use trillion3d_math::vector::vecn::{add, dot, scale};

type Vec3 = [f64; 3];

/// The rays cast through each column of cells.
const RAYS_PER_COLUMN: u32 = 32;

/// What the rays are cast on and how.
pub(super) struct Cast<'a> {
    pub scene: &'a Scene,
    pub volume: &'a Volume,
    /// The directions of the rays a surfel casts over the hemisphere around its normal.
    pub rays: &'a [Vec3],
    /// The cosine at which a surface faces a card squarely enough to be covered by it.
    pub normal_threshold: f32,
}

/// The surfels found so far by all the directions of one try of the volume, against the count past
/// which the try is dropped: a surfel only ever joins (`visibility` has already removed the ones
/// inside geometry before one is counted), so a count past the limit means the try's total is past
/// it, and the try may stop at once.
pub(super) struct Overflow {
    found: AtomicUsize,
    limit: usize,
}

impl Overflow {
    pub(super) fn new(limit: usize) -> Self {
        Self {
            found: AtomicUsize::new(0),
            limit,
        }
    }

    /// Whether more than the limit have been found.
    pub(super) fn passed(&self) -> bool {
        self.found.load(Ordering::Relaxed) > self.limit
    }
}

/// A cell of the volume holding a surface the card covers.
pub(super) struct Surfel {
    pub coord: [i32; 3],
    /// The first cell along the ray from which the surfel is visible: 0 for one the card sees from
    /// outside, past it for one hidden behind an earlier surface.
    pub min_ray_z: i32,
    /// The share of the column's rays that found the surface in the cell.
    pub coverage: f32,
    /// The coverage, weighted by how much of the mesh's outside sees the surfel: it decides how
    /// much covering it matters.
    pub weighted: f32,
}

/// One ray's hit: where, which way the surface faces and the cell it lies in.
pub(super) struct Sample {
    pub position: Vec3,
    pub normal: Vec3,
    pub min_ray_z: i32,
    pub cell_z: i32,
}

/// The surfels of direction `direction`, column by column — the second axis' cells outermost —,
/// each column's from the nearest cell to the farthest. The rows of columns are independent: they
/// are cast on all the workers, then joined in row order, so the surfels come out in the order a
/// serial walk gives them. Once `overflow` has passed its limit the columns left are not cast: the
/// surfels returned are then partial, and the try is dropped by the caller.
pub(super) fn along(cast: &Cast<'_>, direction: usize, overflow: &Overflow) -> Vec<Surfel> {
    let basis = &cast.volume.bases[direction];
    let rows: Vec<Vec<Surfel>> = (0..basis.size[1])
        .into_par_iter()
        .map(|y| {
            let mut found = Vec::new();
            for x in 0..basis.size[0] {
                if overflow.passed() {
                    break;
                }
                let before = found.len();
                let mut samples = column(cast, basis, (x, y));
                samples.sort_by(order);
                for cell in samples.chunk_by(|a, b| a.cell_z == b.cell_z) {
                    cell_surfels(cast, cell, [x, y, cell[0].cell_z], &mut found);
                }
                overflow
                    .found
                    .fetch_add(found.len() - before, Ordering::Relaxed);
            }
            found
        })
        .collect();
    rows.into_iter().flatten().collect()
}

/// The order a column's samples are taken in: by cell, then the farthest-hidden first, then by
/// position.
fn order(a: &Sample, b: &Sample) -> std::cmp::Ordering {
    (a.cell_z.cmp(&b.cell_z))
        .then(b.min_ray_z.cmp(&a.min_ray_z))
        .then(a.position[0].total_cmp(&b.position[0]))
        .then(a.position[1].total_cmp(&b.position[1]))
        .then(a.position[2].total_cmp(&b.position[2]))
}

/// The samples a run starts with that share the first one's `min_ray_z`. The reference measures this
/// run on the column's first samples, whichever cell the run is of (it indexes its sample array
/// without the cell's offset), so a cell after the first is measured on another cell's samples: here
/// it is measured on its own.
fn span(samples: &[Sample]) -> usize {
    (samples.iter())
        .take_while(|sample| sample.min_ray_z == samples[0].min_ray_z)
        .count()
}

/// The surfels of one cell, from its samples `cell`: a surfel for each run of samples seen from
/// the same cell along the ray. A run starts only with another sample after it, so the cell's last
/// sample alone makes none.
fn cell_surfels(cast: &Cast<'_>, cell: &[Sample], coord: [i32; 3], found: &mut Vec<Surfel>) {
    let mut begin = 0;
    while begin + 1 < cell.len() {
        let first = cell[begin].min_ray_z;
        let size = span(&cell[begin..]);
        let (open, valid) = visibility(cast, &cell[begin..begin + size]);
        if valid {
            let coverage = size as f32 / RAYS_PER_COLUMN as f32;
            found.push(Surfel {
                coord,
                min_ray_z: first,
                coverage,
                weighted: coverage * (open + 1.0),
            });
        }
        begin += size;
    }
}

/// The samples of the column at (`x`, `y`) of the volume: `RAYS_PER_COLUMN` rays, spread over the
/// column's face by a low-discrepancy sequence, each cast against the card's direction from before
/// the volume and continued past each surface it meets — to the start of the cell after the one
/// that surface lies in — until it leaves the volume. A surface becomes a sample where it lies
/// beyond the cell after the previous one and faces the card squarely enough.
fn column(cast: &Cast<'_>, basis: &Basis, (x, y): (i32, i32)) -> Vec<Sample> {
    let volume = cast.volume;
    let (voxel, pullback) = (volume.voxel, volume.pullback());
    let depth = basis.size[2];
    let reach = volume.reach;
    let step = scale(basis.ray, reach);
    let mut samples = Vec::new();
    for index in 0..RAYS_PER_COLUMN {
        let jitter_x = (index as f32 + 0.5) / RAYS_PER_COLUMN as f32;
        let jitter_y = (f64::from(index.reverse_bits()) / 4_294_967_296.0) as f32;
        let origin = basis.to_mesh([
            f64::from(x as f32 + jitter_x) * f64::from(voxel),
            f64::from(y as f32 + jitter_y) * f64::from(voxel),
            -f64::from(pullback),
        ]);
        // The cell of the last surface met, the triangle to pass and where the ray goes on from.
        let (mut last, mut skip, mut near) = (-2i32, None, 0.0f32);
        // Each surface met lies in a cell past the last one's: no more casts than cells.
        for _ in 0..=depth {
            if last + 1 >= depth {
                break;
            }
            let from = f64::from(near) / reach;
            let Some(hit) = cast.scene.hit((origin, step), (from, skip)) else {
                break;
            };
            let far = (hit.t * reach) as f32;
            let cell = ((far - pullback) / voxel).clamp(0.0, (depth - 1) as f32) as i32;
            let (mut normal, mut facing) = (hit.normal, -dot(basis.ray, hit.normal));
            // The back of a two-sided surface faces the card as its front would.
            if facing < 0.0 && hit.two_sided {
                (normal, facing) = (normal.map(|c| -c), -facing);
            }
            if facing >= f64::from(cast.normal_threshold) && cell > last + 1 {
                samples.push(Sample {
                    position: add(origin, scale(basis.ray, f64::from(far))),
                    normal,
                    min_ray_z: (last + 1).max(0),
                    cell_z: cell,
                });
            }
            last = cell;
            let next_cell = pullback + (last + 1) as f32 * voxel;
            near = next_cell.max(far.max(near)).next_up();
            skip = Some(hit.slot);
        }
    }
    samples
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(min_ray_z: i32, cell_z: i32) -> Sample {
        Sample {
            position: [0.0; 3],
            normal: [0.0, 0.0, 1.0],
            min_ray_z,
            cell_z,
        }
    }

    // The proof that the reference's measure is wrong where a column holds two layers: a column
    // whose first cell holds two samples seen from cell 5 and whose second holds three seen from
    // cell 7. The reference measures the second cell's run on the column's first three samples
    // (5, 5, 7): two samples, not the three the cell holds — a surfel of two thirds the coverage,
    // and a third sample that starts a run of its own. Measured on the cell's own, the run is whole.
    #[test]
    fn a_runs_size_is_measured_on_its_own_cell() {
        let column = [
            sample(5, 0),
            sample(5, 0),
            sample(7, 1),
            sample(7, 1),
            sample(7, 1),
        ];
        let cell = &column[2..];
        assert_eq!(span(cell), 3, "the cell's own run");
        assert_eq!(
            span(&column[..cell.len()]),
            2,
            "what the column's first samples give: two of cell 0's"
        );
    }
}
