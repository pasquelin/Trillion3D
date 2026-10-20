//! The distance field, its computation and its flood fill.
use super::super::grid_key::{key, leaf_offset, Mask, LEAF_SIZE};
use super::distance::OFFSETS26;
use super::{block_of, max_dim, Bounds, Mesh, Spatial, MAX_CELLS_PER_DIMENSION};
use rayon::prelude::*;
use trillion3d_page_codec::hash::WordMap;

/// A signed distance field on a sparse grid, computed only in a narrow band about the surface.
pub(super) struct Field {
    pub(super) origin: [f32; 3],
    pub(super) cell: f32,
    pub(super) dims: [i32; 3],
    /// The unsigned value of every node no distance was computed for: the grid's three sides
    /// summed, farther than any node can be from the surface.
    pub(super) upper: f32,
    /// The unsigned distances, by block: `upper` where none was computed.
    pub(super) blocks: WordMap<u64, Box<[f32; LEAF_SIZE]>>,
    /// Per row along `x`, keyed by its `(0, j, k)`: the nodes its crossings were counted at, in
    /// order, each with the running count up to it.
    pub(super) rows: WordMap<u64, Vec<(i32, i32)>>,
}

impl Field {
    /// The field of `mesh` within `bounds`: the flood fill from its vertices out to `band` with a
    /// spatial query, else each triangle's box rastered `exact` cells wide, then signed by the
    /// crossings counted along each row.
    pub(super) fn compute(
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
    pub(super) fn grid_point(&self, p: [f64; 3]) -> [f64; 3] {
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
}
