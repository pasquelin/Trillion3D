//! The patches, their interpolation and the iso-value.
use super::super::grid_key::{key, leaf_offset, unkey, LEAF_SIDE as BLOCK, LEAF_SIZE};
use super::super::marching::settled_crossing;
use super::field::Field;
use super::{block_of, OUTSIDE};
use trillion3d_math::vector::vecn::lerp;
use trillion3d_page_codec::hash::WordSet;

impl Field {
    /// The signed values of the grid's nodes in `low..=high`, each axis clamped to the grid, `x`
    /// fastest: a node's distance, or the bound, negative where its row's running count is
    /// positive.
    pub(super) fn patch(&self, low: [i32; 3], high: [i32; 3]) -> Patch {
        let low: [i32; 3] = std::array::from_fn(|k| low[k].max(0));
        let high: [i32; 3] = std::array::from_fn(|k| high[k].min(self.dims[k] - 1));
        let size: [usize; 3] = std::array::from_fn(|k| (high[k] - low[k] + 1).max(0) as usize);
        let mut values = Vec::with_capacity(size[0] * size[1] * size[2]);
        for k in low[2]..=high[2] {
            for j in low[1]..=high[1] {
                let row = self.rows.get(&key([0, j, k])).map_or(&[][..], |r| &r[..]);
                let mut next = row.partition_point(|e| e.0 < low[0]);
                let mut total = if next > 0 { row[next - 1].1 } else { 0 };
                let mut block: Option<(i32, Option<&[f32; LEAF_SIZE]>)> = None;
                for i in low[0]..=high[0] {
                    while next < row.len() && row[next].0 <= i {
                        total = row[next].1;
                        next += 1;
                    }
                    let b = i.div_euclid(BLOCK);
                    let data = match block {
                        Some((at, data)) if at == b => data,
                        _ => {
                            let data = self.blocks.get(&key(block_of([i, j, k]))).map(|d| &**d);
                            block = Some((b, data));
                            data
                        }
                    };
                    let magnitude = data.map_or(self.upper, |d| d[leaf_offset([i, j, k])]);
                    values.push(if total > 0 {
                        -magnitude.abs()
                    } else {
                        magnitude
                    });
                }
            }
        }
        Patch { low, size, values }
    }

    /// The blocks holding a computed distance or a counted crossing.
    pub(super) fn touched_blocks(&self) -> WordSet<u64> {
        let mut out: WordSet<u64> = self
            .blocks
            .iter()
            .filter(|(_, b)| b.iter().any(|&v| v < self.upper))
            .map(|(&k, _)| k)
            .collect();
        for (&row, entries) in &self.rows {
            let [_, j, k] = unkey::<i32>(row);
            out.extend(entries.iter().map(|&(i, _)| key(block_of([i, j, k]))));
        }
        out
    }
}

/// A box of the field's signed node values.
pub(super) struct Patch {
    pub(super) low: [i32; 3],
    pub(super) size: [usize; 3],
    pub(super) values: Vec<f32>,
}

impl Patch {
    pub(super) fn at(&self, n: [i32; 3]) -> f64 {
        let [i, j, k]: [usize; 3] = std::array::from_fn(|a| (n[a] - self.low[a]) as usize);
        f64::from(self.values[i + self.size[0] * (j + self.size[1] * k)])
    }
}

/// The trilinear interpolant of `field` at `p`, its nodes read from `patch`: `OUTSIDE` off the
/// grid.
pub(super) fn interpolate(field: &Field, patch: &Patch, p: [f64; 3]) -> f64 {
    let g = field.grid_point(p);
    let [x0, y0, z0] = g.map(|x| x as i32);
    let (y1, z1) = (y0 + 1, z0 + 1);
    if x0 < 0
        || x0 + 1 >= field.dims[0]
        || y0 < 0
        || y1 >= field.dims[1]
        || z0 < 0
        || z1 >= field.dims[2]
    {
        return OUTSIDE;
    }
    let fax = g[0] - f64::from(x0);
    let fay = g[1] - f64::from(y0);
    let faz = g[2] - f64::from(z0);
    let one_minus_fax = 1.0 - fax;
    let pair = |y: i32, z: i32| (patch.at([x0, y, z]), patch.at([x0 + 1, y, z]));
    let (xa, xb) = pair(y0, z0);
    let mut yz = (1.0 - fay) * (1.0 - faz);
    let mut sum = (one_minus_fax * xa + fax * xb) * yz;
    let (xa, xb) = pair(y0, z1);
    yz = (1.0 - fay) * faz;
    sum += (one_minus_fax * xa + fax * xb) * yz;
    let (xa, xb) = pair(y1, z0);
    yz = fay * (1.0 - faz);
    sum += (one_minus_fax * xa + fax * xb) * yz;
    let (xa, xb) = pair(y1, z1);
    yz = fay * faz;
    sum += (one_minus_fax * xa + fax * xb) * yz;
    sum
}

/// The crossing of `iso` between `p1` (value `v1`) and `p2` (value `v2`), one lerp from the lower
/// value: a distance field varies linearly enough that one step places it.
pub(super) fn find_iso(p1: [f64; 3], p2: [f64; 3], v1: f64, v2: f64, iso: f64) -> [f64; 3] {
    if let Some(settled) = settled_crossing((p1, v1), (p2, v2), iso) {
        return settled;
    }
    let (a, b, fa, fb) = if v2 < v1 {
        (p2, p1, v2, v1)
    } else {
        (p1, p2, v1, v2)
    };
    let mu = ((iso - fa) / (fb - fa)).clamp(0.0, 1.0);
    lerp(a, b, mu)
}
