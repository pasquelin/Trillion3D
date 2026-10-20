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
//! Distances live in `distance`, the field in `field`, its rasterisation in `raster`, the patches in
//! `patch`, the surface in `surface`.
use super::grid_key::LEAF_SIDE as BLOCK;
use super::tree::Tree;
use trillion3d_math::aabb::{aabb_of, longest_side};
use trillion3d_math::vecn::{length, sub};
mod distance;
mod field;
use field::Field;
mod patch;
mod raster;
mod surface;
use surface::generate;

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
