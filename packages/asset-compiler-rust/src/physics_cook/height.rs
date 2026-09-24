//! A regular terrain grid becomes a Jolt `HeightFieldShape`: exact at every sample, a fraction of a
//! triangle mesh's bytes, and no tree to walk. Detected, never guessed: the used vertices must sit
//! on an evenly spaced x-z lattice, one per lattice point, and every triangle must join
//! neighbouring points of one cell. The height field splits each cell by its own diagonal; the
//! largest height gap between the two diagonals of any cell is published as the error.
use super::{cut::store_shape, height_field_shape};
use crate::{Options, Result};
use serde_json::{json, Value};
use std::collections::BTreeMap;

/// A detected grid: `size`² samples (holes are `f32::MAX`), placed by `offset` and `scale`.
pub(crate) struct Grid {
    pub samples: Vec<f32>,
    pub size: usize,
    pub offset: [f32; 3],
    pub scale: [f32; 3],
    /// Cells along x and z: the triangles the height field holds are twice their product.
    pub cells: [usize; 2],
    pub error: f64,
}

/// The sorted distinct values of one axis, when evenly spaced; with their spacing.
fn lattice(values: impl Iterator<Item = f32>) -> Option<(Vec<f32>, f32)> {
    let distinct: Vec<f32> = values
        .map(f32::to_bits)
        .collect::<std::collections::BTreeSet<_>>()
        .into_iter()
        .map(f32::from_bits)
        .collect::<Vec<_>>();
    let mut sorted = distinct;
    sorted.sort_by(f32::total_cmp);
    if sorted.len() < 2 {
        return None;
    }
    let step = (sorted[sorted.len() - 1] - sorted[0]) / (sorted.len() - 1) as f32;
    let even = sorted
        .iter()
        .enumerate()
        .all(|(i, v)| (sorted[0] + step * i as f32 - v).abs() <= step * 1e-3);
    (even && step > 0.0).then_some((sorted, step))
}

/// The grid `source` draws over `pos`, if it is one.
pub(crate) fn detect(pos: &[f32], source: &[u32]) -> Option<Grid> {
    let used: std::collections::BTreeSet<u32> = source.iter().copied().collect();
    let (xs, dx) = lattice(used.iter().map(|&i| pos[i as usize * 3]))?;
    let (zs, dz) = lattice(used.iter().map(|&i| pos[i as usize * 3 + 2]))?;
    let (nx, nz) = (xs.len(), zs.len());
    if nx * nz != used.len() || source.len() / 3 != 2 * (nx - 1) * (nz - 1) {
        return None;
    }
    let cell = |v: f32, origin: f32, step: f32| ((v - origin) / step).round() as usize;
    let mut point: BTreeMap<u32, (usize, usize)> = BTreeMap::new();
    let size = (nx.max(nz).max(4) + 1) & !1;
    let mut samples = vec![f32::MAX; size * size];
    for &i in &used {
        let p = &pos[i as usize * 3..i as usize * 3 + 3];
        let (x, z) = (cell(p[0], xs[0], dx), cell(p[2], zs[0], dz));
        if samples[z * size + x] != f32::MAX {
            return None;
        }
        samples[z * size + x] = p[1];
        point.insert(i, (x, z));
    }
    for tri in source.as_chunks::<3>().0.iter() {
        let cells: Vec<(usize, usize)> = tri.iter().map(|i| point[i]).collect();
        let span = |f: fn(&(usize, usize)) -> usize| {
            cells.iter().map(f).max().unwrap_or(0) - cells.iter().map(f).min().unwrap_or(0)
        };
        if span(|c| c.0) > 1 || span(|c| c.1) > 1 {
            return None;
        }
    }
    let h = |x: usize, z: usize| samples[z * size + x] as f64;
    let mut error = 0.0f64;
    for z in 0..nz - 1 {
        for x in 0..nx - 1 {
            let gap = (h(x, z) + h(x + 1, z + 1) - h(x + 1, z) - h(x, z + 1)).abs() * 0.5;
            error = error.max(gap);
        }
    }
    Some(Grid {
        samples,
        size,
        offset: [xs[0], 0.0, zs[0]],
        scale: [dx, 1.0, dz],
        cells: [nx - 1, nz - 1],
        error,
    })
}

/// The grid cooked and stored: one tile, the whole primitive.
pub(crate) fn cook(o: &Options, grid: &Grid) -> Result<Value> {
    let bytes = height_field_shape(&grid.samples, grid.size, grid.offset, grid.scale)?;
    let mut tile = store_shape(o, &bytes)?;
    let (lo, hi) = grid
        .samples
        .iter()
        .filter(|h| **h != f32::MAX)
        .fold((f32::MAX, f32::MIN), |(lo, hi), h| (lo.min(*h), hi.max(*h)));
    let [cx, cz] = grid.cells;
    let far = |k: usize, cells: usize| grid.offset[k] + grid.scale[k] * cells as f32;
    tile["triangles"] = json!(2 * cx * cz);
    tile["bounds"] = json!([
        grid.offset[0],
        lo,
        grid.offset[2],
        far(0, cx),
        hi,
        far(2, cz)
    ]);
    Ok(
        json!({"kind":"heightField","tolerance":0.0,"hausdorff":grid.error,"triangles":tile["triangles"],"tiles":[tile]}),
    )
}
