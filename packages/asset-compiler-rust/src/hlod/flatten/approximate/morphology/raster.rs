//! The rasterisation and the count of crossings.
use super::super::grid_key::{key, leaf_offset, unkey, LEAF_SIDE as BLOCK, LEAF_SIZE};
use super::distance::{point_in_triangle_2d, point_triangle_distance};
use super::field::Field;
use super::Mesh;
use rayon::prelude::*;
use trillion3d_math::geometry::triangle::triangle_cross;
use trillion3d_page_codec::hash::WordMap;

impl Field {
    /// The band by raster, each triangle scattered to the blocks its box touches and each block
    /// filled on its own: each node of a triangle's box widened by `exact` takes its least
    /// distance.
    pub(super) fn raster(&mut self, mesh: &Mesh, exact: i32) {
        let origin = self.origin.map(f64::from);
        let inverse = 1.0 / f64::from(self.cell);
        let dims = self.dims;
        let grid =
            |p: [f64; 3]| -> [f64; 3] { std::array::from_fn(|k| (p[k] - origin[k]) * inverse) };
        let boxes: Vec<([i32; 3], [i32; 3])> = (0..mesh.triangles.len())
            .into_par_iter()
            .map(|t| {
                let [p, q, r] = mesh.corners(t).map(grid);
                let low = std::array::from_fn(|k| {
                    ((p[k].min(q[k]).min(r[k]) as i32) - exact).clamp(0, dims[k] - 1)
                });
                let high = std::array::from_fn(|k| {
                    ((p[k].max(q[k]).max(r[k]) as i32) + exact + 1).clamp(0, dims[k] - 1)
                });
                (low, high)
            })
            .collect();
        let mut scattered: WordMap<u64, Vec<u32>> = WordMap::default();
        for (t, (low, high)) in boxes.iter().enumerate() {
            let (bl, bh) = (low.map(|x| x / BLOCK), high.map(|x| x / BLOCK));
            for bk in bl[2]..=bh[2] {
                for bj in bl[1]..=bh[1] {
                    for bi in bl[0]..=bh[0] {
                        scattered
                            .entry(key([bi, bj, bk]))
                            .or_default()
                            .push(t as u32);
                    }
                }
            }
        }
        let mut occupied: Vec<(u64, Vec<u32>)> = scattered.into_iter().collect();
        occupied.sort_unstable_by_key(|e| e.0);
        let (upper, cell) = (self.upper, f64::from(self.cell));
        let filled: Vec<(u64, Box<[f32; LEAF_SIZE]>)> = occupied
            .into_par_iter()
            .map(|(block, tris)| {
                let block_min = unkey::<i32>(block).map(|b| b * BLOCK);
                let block_max: [i32; 3] =
                    std::array::from_fn(|k| (block_min[k] + BLOCK).min(dims[k]) - 1);
                let mut values = Box::new([upper; LEAF_SIZE]);
                for t in tris {
                    let [fp, fq, fr] = mesh.corners(t as usize).map(grid);
                    let (low, high) = boxes[t as usize];
                    let low: [i32; 3] =
                        std::array::from_fn(|k| low[k].clamp(block_min[k], block_max[k]));
                    let high: [i32; 3] =
                        std::array::from_fn(|k| high[k].clamp(block_min[k], block_max[k]));
                    for k in low[2]..=high[2] {
                        for j in low[1]..=high[1] {
                            for i in low[0]..=high[0] {
                                let at = [f64::from(i), f64::from(j), f64::from(k)];
                                let d = (cell * point_triangle_distance(at, fp, fq, fr)) as f32;
                                let slot = &mut values[leaf_offset([i, j, k])];
                                if d < *slot {
                                    *slot = d;
                                }
                            }
                        }
                    }
                }
                (block, values)
            })
            .collect();
        self.blocks.extend(filled);
    }

    /// Per triangle, each row along `x` through it counts one at the first node past it, less one
    /// where the triangle faces `+x` — its outward normal the right-handed cross of its corners in
    /// order. The running count signs every node: inside where it is positive, having entered
    /// more surfaces than it left.
    pub(super) fn count_crossings(&mut self, mesh: &Mesh) {
        let origin = self.origin.map(f64::from);
        let inverse = 1.0 / f64::from(self.cell);
        let dims = self.dims;
        let mut crossings: Vec<(u64, i32, i32)> = (0..mesh.triangles.len())
            .into_par_iter()
            .flat_map_iter(|t| {
                let [xp, xq, xr] = mesh.corners(t);
                let step = if triangle_cross(xp, xq, xr)[0] > 0.0 {
                    -1
                } else {
                    1
                };
                let [p, q, r] = [xp, xq, xr]
                    .map(|x| -> [f64; 3] { std::array::from_fn(|k| (x[k] - origin[k]) * inverse) });
                let span = |k: usize| {
                    let low = (p[k].min(q[k]).min(r[k]).ceil() as i32).clamp(0, dims[k] - 1);
                    let high = (p[k].max(q[k]).max(r[k]).floor() as i32).clamp(0, dims[k] - 1);
                    low..=high
                };
                let (rows_j, rows_k) = (span(1), span(2));
                let mut out = Vec::new();
                for kk in rows_k {
                    for jj in rows_j.clone() {
                        let corners = [[p[1], p[2]], [q[1], q[2]], [r[1], r[2]]];
                        if let Some([a, b, c]) =
                            point_in_triangle_2d(f64::from(jj), f64::from(kk), corners)
                        {
                            let fi = a * p[0] + b * q[0] + c * r[0];
                            let interval = fi.ceil() as i32;
                            if interval < dims[0] {
                                out.push((key([0, jj, kk]), interval.max(0), step));
                            }
                        }
                    }
                }
                out
            })
            .collect();
        crossings.par_sort_unstable();
        let mut at = 0;
        while at < crossings.len() {
            let row = crossings[at].0;
            let mut entries: Vec<(i32, i32)> = Vec::new();
            let mut total = 0;
            while at < crossings.len() && crossings[at].0 == row {
                let (_, i, step) = crossings[at];
                total += step;
                match entries.last_mut() {
                    Some(last) if last.0 == i => last.1 = total,
                    _ => entries.push((i, total)),
                }
                at += 1;
            }
            self.rows.insert(row, entries);
        }
    }
}
