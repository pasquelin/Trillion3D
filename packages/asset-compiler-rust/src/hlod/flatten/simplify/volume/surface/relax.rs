//! The disoriented triangles relaxed: a triangle whose normal turns more than 120° from the
//! field's direction at the voxel nearest its centroid marks its three points, and each marked
//! point moves to the mean of the corners of every polygon it belongs to, in single precision.
//!
//! The polygons are summed leaf by leaf, each leaf's quads then its triangles, each polygon's
//! corners in order, from the points as they stood before any moved. A point's count of summed
//! corners is a byte that wraps past 255 — a quirk of the method kept as it is —, and a point
//! whose count wraps to 0 keeps its place.
use super::super::tree::Tree;
use super::cell::{direction, gradient};
use super::polygons::LeafPolygons;
use rayon::prelude::*;
use trillion3d_math::vector::vec3::cross;
use trillion3d_math::vector::vecn::{add, dot, scale, sub};

/// `points` relaxed where the triangles of `polygons` face against `field`, its voxels `voxel`
/// world units: the marks are a union, found leaf by leaf in parallel; the sums run in order.
pub(super) fn relax(
    field: &Tree<f32>,
    polygons: &[LeafPolygons],
    points: &mut [[f32; 3]],
    voxel: f64,
) {
    let inverse = 1.0 / voxel;
    let shared: &[[f32; 3]] = points;
    let flagged: Vec<Vec<u32>> = polygons
        .par_iter()
        .map(|leaf| disoriented(field, leaf, shared, inverse))
        .collect();
    let mut marked = vec![false; points.len()];
    for point in flagged.into_iter().flatten() {
        marked[point as usize] = true;
    }
    let mut sums = vec![[0.0; 3]; points.len()];
    let mut counts = vec![0u8; points.len()];
    for leaf in polygons {
        for quad in &leaf.quads {
            gather(quad, points, &marked, &mut sums, &mut counts);
        }
        for triangle in &leaf.triangles {
            gather(triangle, points, &marked, &mut sums, &mut counts);
        }
    }
    for ((point, sum), &count) in points.iter_mut().zip(&sums).zip(&counts) {
        if count > 0 {
            *point = scale(*sum, (1.0 / f64::from(count)) as f32);
        }
    }
}

/// The points of the triangles of one leaf that face against the field: the triangle's normal,
/// `(c − a) × (b − a)` normalized, against the field's direction at the voxel nearest the centroid
/// on the index grid, a dot product under `−0.5`.
fn disoriented(
    field: &Tree<f32>,
    leaf: &LeafPolygons,
    points: &[[f32; 3]],
    inverse: f64,
) -> Vec<u32> {
    let mut out = Vec::new();
    for &triangle in &leaf.triangles {
        let [a, b, c] = triangle.map(|i| points[i as usize]);
        let normal = direction(cross(sub(c, a), sub(b, a)));
        let centroid = scale(add(add(a, b), c), 1.0 / 3.0);
        let nearest = centroid.map(|x| (f64::from(x) * inverse + 0.5).floor() as i32);
        if dot(direction(gradient(field, nearest)), normal) < -0.5 {
            out.extend(triangle);
        }
    }
    out
}

/// The polygon `corners` summed, in corner order, into each of its marked points, which counts
/// as many corners more.
fn gather<const N: usize>(
    corners: &[u32; N],
    points: &[[f32; 3]],
    marked: &[bool],
    sums: &mut [[f32; 3]],
    counts: &mut [u8],
) {
    let first = points[corners[0] as usize];
    let total = corners[1..]
        .iter()
        .fold(first, |sum, &i| add(sum, points[i as usize]));
    for &i in corners {
        let i = i as usize;
        if marked[i] {
            sums[i] = add(sums[i], total);
            counts[i] = counts[i].wrapping_add(N as u8);
        }
    }
}
