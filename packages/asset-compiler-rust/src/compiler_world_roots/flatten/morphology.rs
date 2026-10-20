//! The gaps of the solid closed by a morphological closing at the gap distance: the source's
//! signed distance on a sparse narrow band, its surface the distance outside meshed by marching
//! cubes (Lorensen & Cline 1987) over the field's trilinear interpolant — the dilation —, then
//! the same on that mesh the distance inside — the erosion. A gap narrower than twice the
//! distance is filled by the dilation and stays filled; the rest of the surface comes back where
//! it was. In centimetres, the unit the epsilons below (`find_iso`) are sized for.
//!
//! The field lives in blocks of eight nodes a side where it was computed, and a node elsewhere
//! reads the bound every unallocated block holds, signed by its row's crossings. Marching cubes
//! visits the cells near a computed node: a cell farther off has its eight corners on the same
//! bound, on one side of the iso-value, and would emit nothing.
use super::first_seen::first_seen;
use super::grid_key::{edge_key, key, leaf_offset, unkey, Mask, LEAF_SIDE as BLOCK, LEAF_SIZE};
use super::marching::{corner_offset, triangles, EDGES, EDGE_TABLE};
use super::tree::Tree;
use rayon::prelude::*;
use trillion3d_math::aabb::{aabb_of, longest_side};
use trillion3d_math::triangle::triangle_cross;
use trillion3d_math::vecn::{length, lerp, sub};
use trillion3d_page_codec::hash::{WordMap, WordSet};

/// Metres to centimetres.
const CENTIMETRES: f64 = 100.0;
/// The most cells across a pass's grid: a larger box gets larger cells, so time and memory stay
/// bounded.
const MAX_TARGET_VOXEL_COUNT: usize = 1200;
/// The most cells across the distance field, its band included: the same bound on the field.
const MAX_CELLS_PER_DIMENSION: i32 = 4096;
/// The most cubes across the marching grid: the same bound on the meshing.
const SAFETY_MAX_DIMENSION: i32 = 4096;
/// The interpolant's value off its grid: far outside, so no surface is made there.
const OUTSIDE: f64 = f32::MAX as f64;

type Bounds = ([f64; 3], [f64; 3]);

fn expanded((low, high): Bounds, by: f64) -> Bounds {
    (low.map(|x| x - by), high.map(|x| x + by))
}

fn max_dim((low, high): Bounds) -> f64 {
    longest_side(low, high)
}

/// The cell, enlarged so the cells across `width` plus `extra` stay within
/// `MAX_TARGET_VOXEL_COUNT`.
fn safe_cell_size(width: f64, cell: f64, extra: usize) -> f64 {
    if width + extra as f64 * cell > cell * MAX_TARGET_VOXEL_COUNT as f64 {
        width / (MAX_TARGET_VOXEL_COUNT - extra) as f64
    } else {
        cell
    }
}

/// The block, the leaf of `grid_key`, holding node `n`.
fn block_of(n: [i32; 3]) -> [i32; 3] {
    n.map(|x| x.div_euclid(BLOCK))
}

/// A triangle mesh in centimetres.
struct Mesh {
    vertices: Vec<[f64; 3]>,
    triangles: Vec<[u32; 3]>,
}

impl Mesh {
    fn corners(&self, t: usize) -> [[f64; 3]; 3] {
        self.triangles[t].map(|v| self.vertices[v as usize])
    }

    /// The box of its triangles — not of its vertices, an unused one left out.
    fn triangle_bounds(&self) -> Bounds {
        aabb_of(
            self.triangles
                .iter()
                .flatten()
                .map(|&v| self.vertices[v as usize]),
        )
    }

    /// Its average edge length, over its distinct edges.
    fn average_edge_length(&self) -> f64 {
        // Summed in edge order, whatever order they were found in.
        let mut edges: Vec<(u32, u32)> = self
            .triangles
            .iter()
            .flat_map(|t| [(t[0], t[1]), (t[1], t[2]), (t[2], t[0])])
            .map(|(a, b)| (a.min(b), a.max(b)))
            .collect();
        edges.sort_unstable();
        edges.dedup();
        if edges.is_empty() {
            return 0.0;
        }
        let sum: f64 = edges
            .iter()
            .map(|&(a, b)| length(sub(self.vertices[a as usize], self.vertices[b as usize])))
            .sum();
        sum / edges.len() as f64
    }
}

/// The nearest-triangle query on the compiler's tree over the mesh, each triangle measured on
/// its own corners.
struct Spatial<'a> {
    tree: Tree,
    mesh: &'a Mesh,
}

impl<'a> Spatial<'a> {
    fn new(mesh: &'a Mesh) -> Self {
        let soup: Vec<f32> = (0..mesh.triangles.len())
            .flat_map(|t| mesh.corners(t).into_iter().flatten().map(|x| x as f32))
            .collect();
        Self {
            tree: Tree::from_soup(soup),
            mesh,
        }
    }

    /// The squared distance from `p` to its nearest triangle, if nearer than `max_distance`.
    fn nearest(&self, p: [f64; 3], max_distance: f64) -> Option<f64> {
        let corners = |t: usize| self.mesh.corners(t);
        (self.tree.nearest_within(p, max_distance, Some(&corners))).map(|(d2, _)| d2)
    }
}

/// The distance from `x0` to the segment `x1, x2`.
fn point_segment_distance(x0: [f64; 3], x1: [f64; 3], x2: [f64; 3]) -> f64 {
    let dx = sub(x2, x1);
    let m2 = trillion3d_math::vecn::dot(dx, dx);
    let s12 = (trillion3d_math::vecn::dot(dx, sub(x2, x0)) / m2).clamp(0.0, 1.0);
    let closest: [f64; 3] = std::array::from_fn(|k| s12 * x1[k] + (1.0 - s12) * x2[k]);
    length(sub(x0, closest))
}

/// The distance from `x0` to the triangle `x1, x2, x3`: to its plane's foot inside it, else to
/// the nearer of the two edges the barycentric weights point at.
fn point_triangle_distance(x0: [f64; 3], x1: [f64; 3], x2: [f64; 3], x3: [f64; 3]) -> f64 {
    use trillion3d_math::vecn::dot;
    let (x13, x23, x03) = (sub(x1, x3), sub(x2, x3), sub(x0, x3));
    let (m13, m23, d) = (dot(x13, x13), dot(x23, x23), dot(x13, x23));
    let invdet = 1.0 / (m13 * m23 - d * d).max(1e-30);
    let (a, b) = (dot(x13, x03), dot(x23, x03));
    let w23 = invdet * (m23 * a - d * b);
    let w31 = invdet * (m13 * b - d * a);
    let w12 = 1.0 - w23 - w31;
    if w23 >= 0.0 && w31 >= 0.0 && w12 >= 0.0 {
        let p: [f64; 3] = std::array::from_fn(|k| w23 * x1[k] + w31 * x2[k] + w12 * x3[k]);
        length(sub(x0, p))
    } else if w23 > 0.0 {
        point_segment_distance(x0, x1, x2).min(point_segment_distance(x0, x1, x3))
    } else if w31 > 0.0 {
        point_segment_distance(x0, x1, x2).min(point_segment_distance(x0, x2, x3))
    } else {
        point_segment_distance(x0, x1, x3).min(point_segment_distance(x0, x2, x3))
    }
}

/// The sign of twice the signed area of
/// `(0,0), (x1,y1), (x2,y2)`, ties broken by simulation of simplicity, and the area.
fn orientation(x1: f64, y1: f64, x2: f64, y2: f64) -> (i32, f64) {
    let area = y1 * x2 - x1 * y2;
    let sign = if area > 0.0 {
        1
    } else if area < 0.0 {
        -1
    } else if y2 > y1 {
        1
    } else if y2 < y1 {
        -1
    } else if x1 > x2 {
        1
    } else if x1 < x2 {
        -1
    } else {
        0
    };
    (sign, area)
}

/// Whether `(x0, y0)` lies in the triangle, and its barycentric weights: the three orientations
/// agree, so a point on a shared edge counts in exactly one of its triangles.
fn point_in_triangle_2d(x0: f64, y0: f64, t: [[f64; 2]; 3]) -> Option<[f64; 3]> {
    let [[x1, y1], [x2, y2], [x3, y3]] = t.map(|[x, y]| [x - x0, y - y0]);
    let (sa, a) = orientation(x2, y2, x3, y3);
    if sa == 0 {
        return None;
    }
    let (sb, b) = orientation(x3, y3, x1, y1);
    if sb != sa {
        return None;
    }
    let (sc, c) = orientation(x1, y1, x2, y2);
    if sc != sa {
        return None;
    }
    let sum = a + b + c;
    Some([a / sum, b / sum, c / sum])
}

/// The 26 neighbours of a node, `x` fastest, then `y`, then `z`, the node itself left out.
const OFFSETS26: [[i32; 3]; 26] = {
    let mut out = [[0; 3]; 26];
    let (mut n, mut at) = (0, 0);
    while n < 27 {
        if n != 13 {
            out[at] = [n % 3 - 1, n / 3 % 3 - 1, n / 9 - 1];
            at += 1;
        }
        n += 1;
    }
    out
};

/// A signed distance field on a sparse grid, computed only in a narrow band about the surface.
struct Field {
    origin: [f32; 3],
    cell: f32,
    dims: [i32; 3],
    /// The unsigned value of every node no distance was computed for: the grid's three sides
    /// summed, farther than any node can be from the surface.
    upper: f32,
    /// The unsigned distances, by block: `upper` where none was computed.
    blocks: WordMap<u64, Box<[f32; LEAF_SIZE]>>,
    /// Per row along `x`, keyed by its `(0, j, k)`: the nodes its crossings were counted at, in
    /// order, each with the running count up to it.
    rows: WordMap<u64, Vec<(i32, i32)>>,
}

impl Field {
    /// The field of `mesh` within `bounds`: the flood fill from its vertices out to `band` with a
    /// spatial query, else each triangle's box rastered `exact` cells wide, then signed by the
    /// crossings counted along each row.
    fn compute(
        mesh: &Mesh,
        spatial: Option<&Spatial>,
        cell: f32,
        exact: i32,
        band: f64,
        bounds: Bounds,
    ) -> Field {
        let exact = if exact * 2 < MAX_CELLS_PER_DIMENSION {
            exact
        } else {
            (MAX_CELLS_PER_DIMENSION / 2 - 1).max(1)
        };
        let width = max_dim(bounds);
        let cells_left = MAX_CELLS_PER_DIMENSION - 2 * exact;
        let cell = if width / f64::from(cell) <= f64::from(cells_left) {
            cell
        } else {
            (width / f64::from(cells_left)) as f32
        };
        let mut buffer = exact as f32 * cell;
        if spatial.is_some() {
            buffer = buffer.max(band as f32);
        }
        let origin: [f32; 3] = std::array::from_fn(|k| bounds.0[k] as f32 - buffer);
        let max: [f32; 3] = std::array::from_fn(|k| bounds.1[k] as f32 + buffer);
        let dims: [i32; 3] = std::array::from_fn(|k| ((max[k] - origin[k]) / cell) as i32 + 1);
        let mut field = Field {
            origin,
            cell,
            dims,
            upper: (dims[0] + dims[1] + dims[2]) as f32 * cell,
            blocks: WordMap::default(),
            rows: WordMap::default(),
        };
        match spatial {
            Some(spatial) => field.flood_fill(mesh, spatial, band),
            None => field.raster(mesh, exact),
        }
        field.count_crossings(mesh);
        field
    }

    fn in_grid(&self, n: [i32; 3]) -> bool {
        (0..3).all(|k| n[k] >= 0 && n[k] < self.dims[k])
    }

    /// The position of node `n`.
    fn center(&self, n: [i32; 3]) -> [f64; 3] {
        std::array::from_fn(|k| f64::from(n[k] as f32 * self.cell + self.origin[k]))
    }

    /// The node's coordinates of `p`, unrounded.
    fn grid_point(&self, p: [f64; 3]) -> [f64; 3] {
        std::array::from_fn(|k| (p[k] - f64::from(self.origin[k])) / f64::from(self.cell))
    }

    fn set(&mut self, n: [i32; 3], value: f32) {
        let upper = self.upper;
        self.blocks
            .entry(key(block_of(n)))
            .or_insert_with(|| Box::new([upper; LEAF_SIZE]))[leaf_offset(n)] = value;
    }

    /// The band by flood fill: from the node of each vertex, across the 26 neighbours of every
    /// node a triangle lies within the
    /// query distance of, each node visited once — a neighbour in the same block whether or not
    /// it lies in the grid, one in another block only in the grid.
    fn flood_fill(&mut self, mesh: &Mesh, spatial: &Spatial, band: f64) {
        let max_query = band + 2.0 * f64::from(self.cell) * std::f64::consts::SQRT_2;
        let inverse = 1.0 / f64::from(self.cell);
        let mut visited: WordMap<u64, Mask> = WordMap::default();
        let is_visited = |visited: &WordMap<u64, Mask>, n: [i32; 3]| {
            (visited.get(&key(block_of(n)))).is_some_and(|bits| bits.is_on(leaf_offset(n)))
        };
        let mark = |visited: &mut WordMap<u64, Mask>, n: [i32; 3]| {
            visited
                .entry(key(block_of(n)))
                .or_default()
                .set_on(leaf_offset(n));
        };
        let mut candidates: Vec<[i32; 3]> = mesh
            .vertices
            .iter()
            .map(|v| {
                std::array::from_fn(|k| {
                    (((v[k] - f64::from(self.origin[k])) * inverse) as i32)
                        .clamp(0, self.dims[k] - 1)
                })
            })
            .collect();
        candidates.par_sort_unstable();
        candidates.dedup();
        for &n in &candidates {
            mark(&mut visited, n);
        }
        while !candidates.is_empty() {
            let found: Vec<Option<f32>> = candidates
                .par_iter()
                .map(|&n| {
                    spatial
                        .nearest(self.center(n), max_query)
                        .map(|d2| d2.sqrt() as f32)
                })
                .collect();
            let mut accepted = Vec::new();
            for (&n, d) in candidates.iter().zip(found) {
                if let Some(d) = d {
                    self.set(n, d);
                    accepted.push(n);
                }
            }
            // A chunk of the front at a time, so the neighbours gathered before their
            // deduplication stay few.
            let mut next: Vec<[i32; 3]> = Vec::new();
            for chunk in accepted.chunks(1 << 16) {
                let (this, seen) = (&*self, &visited);
                // Each slice of the chunk gathers into one vector sized for its 26 neighbours
                // a node: no list of vectors, no growth. The order is the sort's below.
                let parts: Vec<Vec<[i32; 3]>> = chunk
                    .par_chunks(1 << 10)
                    .map(|slice| {
                        let mut out = Vec::with_capacity(slice.len() * OFFSETS26.len());
                        for &s in slice {
                            out.extend(
                                (OFFSETS26.iter())
                                    .map(|o| [s[0] + o[0], s[1] + o[1], s[2] + o[2]])
                                    .filter(|&n| {
                                        (block_of(n) == block_of(s) || this.in_grid(n))
                                            && !is_visited(seen, n)
                                    }),
                            );
                        }
                        out
                    })
                    .collect();
                let mut fresh: Vec<[i32; 3]> = Vec::with_capacity(parts.iter().map(Vec::len).sum());
                for part in parts {
                    fresh.extend(part);
                }
                fresh.par_sort_unstable();
                fresh.dedup();
                for &n in &fresh {
                    mark(&mut visited, n);
                }
                next.extend(fresh);
            }
            candidates = next;
        }
    }

    /// The band by raster, each triangle scattered to the blocks its box touches and each block
    /// filled on its own: each node of a triangle's box widened by `exact` takes its least
    /// distance.
    fn raster(&mut self, mesh: &Mesh, exact: i32) {
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
    fn count_crossings(&mut self, mesh: &Mesh) {
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

    /// The signed values of the grid's nodes in `low..=high`, each axis clamped to the grid, `x`
    /// fastest: a node's distance, or the bound, negative where its row's running count is
    /// positive.
    fn patch(&self, low: [i32; 3], high: [i32; 3]) -> Patch {
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
    fn touched_blocks(&self) -> WordSet<u64> {
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
struct Patch {
    low: [i32; 3],
    size: [usize; 3],
    values: Vec<f32>,
}

impl Patch {
    fn at(&self, n: [i32; 3]) -> f64 {
        let [i, j, k]: [usize; 3] = std::array::from_fn(|a| (n[a] - self.low[a]) as usize);
        f64::from(self.values[i + self.size[0] * (j + self.size[1] * k)])
    }
}

/// The trilinear interpolant of `field` at `p`, its nodes read from `patch`: `OUTSIDE` off the
/// grid.
fn interpolate(field: &Field, patch: &Patch, p: [f64; 3]) -> f64 {
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
fn find_iso(p1: [f64; 3], p2: [f64; 3], v1: f64, v2: f64, iso: f64) -> [f64; 3] {
    const DT: f64 = 0.999999;
    if (v1 - v2).abs() < 0.00001 {
        return std::array::from_fn(|k| (p1[k] + p2[k]) * 0.5);
    }
    if (iso - v1).abs() < 0.00001 {
        return std::array::from_fn(|k| DT * p1[k] + (1.0 - DT) * p2[k]);
    }
    if (iso - v2).abs() < 0.00001 {
        return std::array::from_fn(|k| DT * p2[k] + (1.0 - DT) * p1[k]);
    }
    let (a, b, fa, fb) = if v2 < v1 {
        (p2, p1, v2, v1)
    } else {
        (p1, p2, v1, v2)
    };
    let mu = ((iso - fa) / (fb - fa)).clamp(0.0, 1.0);
    lerp(a, b, mu)
}

/// Marching cubes of `-field` at `iso` over `bounds` in cubes of side `cube`, enlarged past
/// `SAFETY_MAX_DIMENSION` cubes across: the surface, inside where the value is at or above `iso`,
/// and the cube side kept.
fn generate(field: &Field, iso: f64, bounds: Bounds, cube: f64) -> (Mesh, f64) {
    let dims_of = |cube: f64| -> [i32; 3] {
        std::array::from_fn(|k| ((bounds.1[k] - bounds.0[k]) / cube) as i32 + 1)
    };
    let mut cube = cube;
    let mut dims = dims_of(cube);
    if dims.into_iter().max().unwrap_or(0) > SAFETY_MAX_DIMENSION {
        cube = max_dim(bounds) / f64::from(SAFETY_MAX_DIMENSION - 1);
        dims = dims_of(cube);
    }
    let corner_pos =
        |c: [i32; 3]| -> [f64; 3] { std::array::from_fn(|k| bounds.0[k] + cube * f64::from(c[k])) };
    // The cubes whose corners read a node within two of a touched block.
    let mut wanted: Vec<u64> = Vec::new();
    for block in field.touched_blocks() {
        let b = unkey::<i32>(block);
        let range = |k: usize| {
            let node = |n: i32| f64::from(field.origin[k]) + f64::from(n) * f64::from(field.cell);
            let low = node(b[k] * BLOCK - 2);
            let high = node(b[k] * BLOCK + BLOCK + 1);
            let first = (((low - bounds.0[k]) / cube).floor() as i32 - 2).max(0);
            let last = (((high - bounds.0[k]) / cube).ceil() as i32 + 1).min(dims[k] - 1);
            if first > last {
                return 1..=0;
            }
            (first / BLOCK)..=(last / BLOCK)
        };
        let (rx, ry, rz) = (range(0), range(1), range(2));
        for z in rz {
            for y in ry.clone() {
                for x in rx.clone() {
                    wanted.push(key([x, y, z]));
                }
            }
        }
    }
    wanted.par_sort_unstable();
    wanted.dedup();
    let parts: Vec<(Vec<(u64, [f64; 3])>, Vec<[u64; 3]>)> = wanted
        .par_iter()
        .map(|&block| {
            let low = unkey::<i32>(block).map(|b| b * BLOCK);
            let high: [i32; 3] = std::array::from_fn(|k| (low[k] + BLOCK).min(dims[k]));
            // Corners `low..=high`, and the field's nodes they read.
            let size: [usize; 3] = std::array::from_fn(|k| (high[k] - low[k] + 1) as usize);
            let node = |c: [i32; 3]| field.grid_point(corner_pos(c)).map(|x| x as i32);
            let (first, last) = (node(low), node(high));
            let patch = field.patch(first, last.map(|x| x + 1));
            let mut values = Vec::with_capacity(size[0] * size[1] * size[2]);
            for z in low[2]..=high[2] {
                for y in low[1]..=high[1] {
                    for x in low[0]..=high[0] {
                        values.push(-interpolate(field, &patch, corner_pos([x, y, z])));
                    }
                }
            }
            let value = |c: [i32; 3]| {
                let [i, j, k]: [usize; 3] = std::array::from_fn(|a| (c[a] - low[a]) as usize);
                values[i + size[0] * (j + size[1] * k)]
            };
            let (mut vertices, mut tris) = (Vec::new(), Vec::new());
            let mut seen: WordSet<u64> = WordSet::default();
            for z in low[2]..high[2] {
                for y in low[1]..high[1] {
                    for x in low[0]..high[0] {
                        let corner = |k: usize| {
                            let o = corner_offset(k);
                            [x + o[0] as i32, y + o[1] as i32, z + o[2] as i32]
                        };
                        let f: [f64; 8] = std::array::from_fn(|k| value(corner(k)));
                        let below = (0..8).fold(0usize, |m, k| m | usize::from(f[k] < iso) << k);
                        let crossed = EDGE_TABLE[below];
                        if crossed == 0 {
                            continue;
                        }
                        let mut edge_vertex = [0u64; 12];
                        for (e, &(a, b)) in EDGES.iter().enumerate() {
                            if crossed >> e & 1 == 1 {
                                let (ca, cb) = (corner(a), corner(b));
                                let id = edge_key(ca, cb);
                                if seen.insert(id) {
                                    let (pa, pb) = (corner_pos(ca), corner_pos(cb));
                                    vertices.push((id, find_iso(pa, pb, f[a], f[b], iso)));
                                }
                                edge_vertex[e] = id;
                            }
                        }
                        for t in triangles(!below & 0xff) {
                            let [a, b, c] = t.map(|e| edge_vertex[e as usize]);
                            if a != b && a != c && b != c {
                                tris.push([a, b, c]);
                            }
                        }
                    }
                }
            }
            (vertices, tris)
        })
        .collect();
    // Each vertex numbered at its first naming, block after block, and the triangles' corners by
    // the same ranks, sorted side by side; every part let go once read.
    let (vertex_parts, triangle_parts): (Vec<_>, Vec<_>) = parts.into_iter().unzip();
    let named_vertices: usize = vertex_parts.iter().map(Vec::len).sum();
    let named: Vec<u64> = (vertex_parts.iter().flatten().map(|&(id, _)| id))
        .chain(triangle_parts.into_iter().flatten().flatten())
        .collect();
    let (_, ranks) = first_seen(named);
    let mut mesh = Mesh {
        vertices: Vec::new(),
        triangles: ranks[named_vertices..].as_chunks::<3>().0.to_vec(),
    };
    for ((_, p), &rank) in vertex_parts.into_iter().flatten().zip(&ranks) {
        if rank as usize == mesh.vertices.len() {
            mesh.vertices.push(p);
        }
    }
    (mesh, cube)
}

/// Whether the band is filled by flood fill rather than raster: when it is wider than one cell
/// and spans at least a quarter of an edge, so the flood from the vertices reaches every node
/// of it.
fn should_use_spatial(exact: i32, cell: f64, average_edge: f64) -> bool {
    let edges_per_band = f64::from(exact) * (cell / average_edge);
    exact > 1 && edges_per_band >= 0.25
}

/// The closing of a closed mesh (metres in, metres out): its cells sized on the mesh's bounds,
/// widened by the distance on each side, for `resolution` cells across (the field and the
/// marching alike), then dilated by `distance` and the result eroded by it; returned as it came
/// when twice the distance is under that cell, a closing that could shut no gap of the grid.
pub(super) fn close(
    (positions, indices): (Vec<f32>, Vec<u32>),
    distance: f64,
    resolution: usize,
) -> (Vec<f32>, Vec<u32>) {
    // A gap under a cell is already shut or open on the grid the solid was sampled on: a
    // closing by less than half a cell either side changes no corner's side, only resamples the
    // surface. The solid is then kept as it stands.
    let (low, high) =
        trillion3d_math::aabb::aabb_of_f32(positions.as_chunks::<3>().0.iter().copied());
    let side = max_dim((low.map(f64::from), high.map(f64::from)));
    let cell = (side + distance * 2.0) / resolution.min(MAX_TARGET_VOXEL_COUNT) as f64;
    if 2.0 * distance < cell {
        return (positions, indices);
    }
    let source = Mesh {
        vertices: positions
            .as_chunks::<3>()
            .0
            .iter()
            .map(|p| p.map(|x| f64::from(x) * CENTIMETRES))
            .collect(),
        triangles: indices.as_chunks::<3>().0.to_vec(),
    };
    // The solid is held once, in centimetres, from here on.
    drop((positions, indices));
    let distance = distance * CENTIMETRES;
    let mesh_bounds = aabb_of(source.vertices.iter().copied());
    // The bounds' longest side is never negative nor NaN, so with a positive distance the cell
    // is positive, or infinite with no cell to count.
    let target_cell =
        (max_dim(mesh_bounds) + distance * 2.0) / resolution.min(MAX_TARGET_VOXEL_COUNT) as f64;
    // Nothing to close without a positive distance and a finite cell.
    if source.triangles.is_empty() || !(distance > 0.0 && target_cell.is_finite()) {
        return (Vec::new(), Vec::new());
    }

    // The dilation: inside where the source's distance is at most `distance`.
    let dilated = {
        let spatial = Spatial::new(&source);
        let bounds = source.triangle_bounds();
        let cell = safe_cell_size(2.0 * distance + max_dim(bounds), target_cell, 2) as f32;
        let band = distance + f64::from(cell);
        let exact = (band / f64::from(cell)).ceil() as i32;
        let flood = should_use_spatial(exact, f64::from(cell), source.average_edge_length());
        let field = Field::compute(
            &source,
            flood.then_some(&spatial),
            cell,
            exact,
            band,
            bounds,
        );
        let iso = -distance;
        let marching = expanded(expanded(bounds, target_cell), band);
        let cube = safe_cell_size(max_dim(marching), target_cell, 1);
        let (mesh, cube) = generate(&field, iso, marching, cube);
        (mesh, marching, cube)
    };
    let (dilated, marching, cube) = dilated;
    drop(source);
    if dilated.triangles.is_empty() {
        return (Vec::new(), Vec::new());
    }

    // The erosion: inside where the dilation's distance is at most `-distance`.
    let mut bounds = expanded(marching, target_cell);
    let erosion_cell = safe_cell_size(2.0 * distance + max_dim(bounds), target_cell, 2);
    let cell = erosion_cell as f32;
    let band = distance + f64::from(cell);
    let exact = (band / f64::from(cell)).ceil() as i32;
    let spatial = (exact > 1).then(|| Spatial::new(&dilated));
    if spatial.is_some() {
        bounds = dilated.triangle_bounds();
    }
    let field = Field::compute(&dilated, spatial.as_ref(), cell, exact, band, bounds);
    let marching = expanded(bounds, erosion_cell);
    let cube = safe_cell_size(max_dim(marching), cube, 1);
    let (closed, _) = generate(&field, distance, marching, cube);
    let positions = closed
        .vertices
        .iter()
        .flat_map(|p| p.map(|x| (x / CENTIMETRES) as f32))
        .collect();
    (positions, closed.triangles.into_iter().flatten().collect())
}
