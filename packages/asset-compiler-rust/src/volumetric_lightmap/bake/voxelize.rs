//! The scene's voxelisation: the cells of the finest level that geometry touches. Every triangle
//! is rasterised, conservatively, along the axis its normal is most turned to, onto a grid four
//! times finer than the cells of a cube holding the volume; each fragment, a point on the
//! triangle's plane, allocates the cells within a quarter cell of it that lie in an importance
//! box. The conservative rasterisation grows the triangle's edges by the pixel's diagonal before
//! it takes the pixels whose centre lies inside, and drops those outside the triangle's box grown
//! by a pixel.
use super::layout::{ALLOCATED, IN_IMPORTANCE};
use super::sampling::{positive, Vec3};
use rayon::prelude::*;
use std::sync::atomic::{AtomicU8, Ordering};
use trillion3d_math::vector::vecn::{dot, sub};

/// Pixels along a cell of the voxel grid.
const SUPER_RESOLUTION: f64 = 4.0;

/// The cube that holds the volume: its lower corner, its side, and the cells along its side.
pub struct Cube {
    low: Vec3,
    side: f64,
    max_dim: f64,
}

impl Cube {
    pub fn new(low: Vec3, size: Vec3, dims: [u32; 3]) -> Self {
        Self {
            low,
            side: size.iter().copied().fold(0.0, f64::max),
            max_dim: f64::from(dims.into_iter().max().unwrap_or(1)),
        }
    }

    /// The lower corner of the cell `v` of the finest level.
    pub fn corner(&self, v: [u32; 3]) -> Vec3 {
        std::array::from_fn(|k| self.low[k] + f64::from(v[k]) / self.max_dim * self.side)
    }

    /// A point of the world in the cube's normalised coordinates, [-1, 1] along each side.
    fn normalised(&self, p: Vec3) -> Vec3 {
        let half = self.side / 2.0;
        [0, 1, 2].map(|k| (p[k] - self.low[k] - half) / half.max(1e-4))
    }
}

/// A triangle seen along its dominant axis: the corners in the screen's axes, the box and the
/// grown corners of the conservative rasterisation, and how the screen's axes map back.
struct Projected {
    corners: [Vec3; 3],
    grown: [Vec3; 3],
    window: [f64; 4],
    axis: usize,
}

/// A screen point back to the cube's axes.
fn unpermute(axis: usize, s: Vec3) -> Vec3 {
    match axis {
        0 => [s[2], s[0], s[1]],
        1 => [s[1], s[2], s[0]],
        _ => s,
    }
}

fn permute(axis: usize, w: Vec3) -> Vec3 {
    match axis {
        0 => [w[1], w[2], w[0]],
        1 => [w[2], w[0], w[1]],
        _ => w,
    }
}

fn project(triangle: [Vec3; 3], max_dim: f64) -> Option<Projected> {
    let a = sub(triangle[1], triangle[0]);
    let b = sub(triangle[2], triangle[0]);
    let normal = [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ];
    let length = dot(normal, normal).sqrt();
    if !positive(length) {
        return None;
    }
    let magnitude = normal.map(|c| (c / length).abs());
    let mut axis = 0;
    for k in 1..3 {
        if magnitude[k] > magnitude[axis] {
            axis = k;
        }
    }
    let corners = triangle.map(|p| permute(axis, p));
    let pixel = 1.0 / max_dim / SUPER_RESOLUTION;
    let mut window = [
        f64::INFINITY,
        f64::INFINITY,
        f64::NEG_INFINITY,
        f64::NEG_INFINITY,
    ];
    for c in &corners {
        window = [
            window[0].min(c[0]),
            window[1].min(c[1]),
            window[2].max(c[0]),
            window[3].max(c[1]),
        ];
    }
    window = [
        window[0] - pixel,
        window[1] - pixel,
        window[2] + pixel,
        window[3] + pixel,
    ];
    let sign = if normal[axis] > 0.0 { 1.0 } else { -1.0 };
    let grown = grow(corners, pixel * std::f64::consts::SQRT_2, sign)?;
    Some(Projected {
        corners,
        grown,
        window,
        axis,
    })
}

/// The corners moved out along the edges so that a pixel whose centre is inside the grown
/// triangle touches the triangle: each edge moves out by the pixel's diagonal projected on its
/// normal.
fn grow(c: [Vec3; 3], diagonal: f64, sign: f64) -> Option<[Vec3; 3]> {
    let edge = [sub(c[1], c[0]), sub(c[2], c[1]), sub(c[0], c[2])];
    let normal = edge.map(|e| [e[1] * sign, -e[0] * sign]);
    let reach = normal.map(|n| diagonal * (n[0].abs() + n[1].abs()));
    let along = |e: usize, n: usize| {
        let scale = reach[n] / (edge[e][0] * normal[n][0] + edge[e][1] * normal[n][1]);
        edge[e].map(|v| v * scale)
    };
    let moves = [
        [along(2, 0), along(0, 2)],
        [along(0, 1), along(1, 0)],
        [along(1, 2), along(2, 1)],
    ];
    let grown = [0, 1, 2].map(|i| {
        let [p, q] = moves[i];
        [0, 1, 2].map(|k| c[i][k] + p[k] + q[k])
    });
    grown
        .iter()
        .flatten()
        .all(|v| v.is_finite())
        .then_some(grown)
}

/// The edge function of the point `(x, y)` against the edge `from` to `to`.
fn side(from: Vec3, to: Vec3, x: f64, y: f64) -> f64 {
    (to[0] - from[0]) * (y - from[1]) - (to[1] - from[1]) * (x - from[0])
}

impl Projected {
    /// The pixel grid's range along one axis that the grown corners reach.
    fn span(&self, axis: usize, pixels: f64) -> (i64, i64) {
        let low = self
            .grown
            .iter()
            .map(|c| c[axis])
            .fold(f64::INFINITY, f64::min);
        let high = self
            .grown
            .iter()
            .map(|c| c[axis])
            .fold(f64::NEG_INFINITY, f64::max);
        let to_pixel = |v: f64| ((v + 1.0) * pixels / 2.0 - 0.5).floor() as i64;
        (
            to_pixel(low).max(0),
            (to_pixel(high) + 1).min(pixels as i64 - 1),
        )
    }

    /// Calls `fragment` with the point of the triangle's plane over each pixel the grown
    /// triangle covers inside the box.
    fn fragments(&self, pixels: f64, mut fragment: impl FnMut(Vec3)) {
        let [a, b, c] = self.grown;
        let area = side(a, b, c[0], c[1]);
        if area == 0.0 {
            return;
        }
        let (x0, x1) = self.span(0, pixels);
        let (y0, y1) = self.span(1, pixels);
        let plane = plane_of(self.corners);
        for j in y0..=y1 {
            let y = -1.0 + (2.0 * j as f64 + 1.0) / pixels;
            for i in x0..=x1 {
                let x = -1.0 + (2.0 * i as f64 + 1.0) / pixels;
                let inside = [side(a, b, x, y), side(b, c, x, y), side(c, a, x, y)]
                    .iter()
                    .all(|&e| e * area >= 0.0);
                let w = &self.window;
                if !inside || x < w[0] || y < w[1] || x > w[2] || y > w[3] {
                    continue;
                }
                let z = plane.0 * x + plane.1 * y + plane.2;
                if (-1.0..=1.0).contains(&z) {
                    fragment([x, y, z]);
                }
            }
        }
    }
}

/// The plane `z = p·x + q·y + r` of the triangle in the screen's axes.
fn plane_of(c: [Vec3; 3]) -> (f64, f64, f64) {
    let (a, b) = (sub(c[1], c[0]), sub(c[2], c[0]));
    let det = a[0] * b[1] - a[1] * b[0];
    let p = (a[2] * b[1] - a[1] * b[2]) / det;
    let q = (a[0] * b[2] - a[2] * b[0]) / det;
    (p, q, c[0][2] - p * c[0][0] - q * c[0][1])
}

/// Allocates, in `state` (the finest level's cells), every importance cell a triangle's
/// fragment lies within a quarter cell of.
pub fn voxelize(triangles: &[f32], cube: &Cube, dims: [u32; 3], state: &[AtomicU8]) {
    let pixels = cube.max_dim * SUPER_RESOLUTION;
    let index = |p: [i64; 3]| {
        let inside = (0..3).all(|k| p[k] >= 0 && p[k] < i64::from(dims[k]));
        inside.then(|| (p[0] + i64::from(dims[0]) * (p[1] + i64::from(dims[1]) * p[2])) as usize)
    };
    triangles.par_chunks(9 * 1024).for_each(|chunk| {
        for t in chunk.as_chunks::<9>().0 {
            let corner =
                |k: usize| cube.normalised([t[k * 3], t[k * 3 + 1], t[k * 3 + 2]].map(f64::from));
            let Some(projected) = project([corner(0), corner(1), corner(2)], cube.max_dim) else {
                continue;
            };
            projected.fragments(pixels, |screen| {
                let world = unpermute(projected.axis, screen);
                let voxel = world.map(|w| (w + 1.0) * 0.5 * cube.max_dim);
                for k in 0..27 {
                    let d =
                        [k % 3, (k / 3) % 3, k / 9].map(|v| (v as f64 - 1.0) / SUPER_RESOLUTION);
                    let at = [0, 1, 2].map(|a| (voxel[a] + d[a]) as i64);
                    if let Some(cell) = index(at) {
                        let _ = state[cell].compare_exchange(
                            IN_IMPORTANCE,
                            ALLOCATED,
                            Ordering::Relaxed,
                            Ordering::Relaxed,
                        );
                    }
                }
            });
        }
    });
}
