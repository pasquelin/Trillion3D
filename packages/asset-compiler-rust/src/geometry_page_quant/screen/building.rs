//! The audit's tower as a hard-surface game asset (`gen_meshes.py::building_welded`): 24 × 16 m,
//! 60 floors of 3.2 m, every facade a grid whose cells match edge for edge, window cells recessed
//! by 0.25 m, flat shading by per-face vertex copies, outward winding.
use super::meshes::{Mesh, V};
use std::f64::consts::FRAC_PI_2;
use trillion3d_page_codec::vec3::{add, cross, dot, sub};

const WIDTH: f64 = 24.0;
const DEPTH: f64 = 16.0;
const FLOOR: f64 = 3.2;
const FLOORS: usize = 60;
const MARGIN: f64 = 0.35;
const RECESS: f64 = 0.25;

/// A face of four corners under one normal, texture coordinates from its position.
fn face(mesh: &mut Mesh, quad: [V; 4], n: V) {
    let b = (mesh.positions.len() / 3) as u32;
    for p in quad {
        mesh.vertex(p, n, [p[0] * 0.5 + p[2] * 0.5, p[1] * 0.5]);
    }
    mesh.indices.extend([b, b + 1, b + 2, b, b + 2, b + 3]);
}

/// The sorted, distinct cuts of a facade axis: every panel edge and every window edge.
fn cuts(count: usize, pitch: f64, offsets: [f64; 2]) -> Vec<f64> {
    let mut all: Vec<f64> = (0..=count).map(|k| k as f64 * pitch).collect();
    for k in 0..count {
        all.extend(offsets.map(|o| k as f64 * pitch + o));
    }
    let mut rounded: Vec<f64> = all.iter().map(|x| (x * 1e6).round() / 1e6).collect();
    rounded.sort_by(f64::total_cmp);
    rounded.dedup();
    rounded
}

pub(super) fn building() -> Mesh {
    let mut mesh = Mesh::default();
    let origins = [
        [0.0, 0.0, 0.0],
        [WIDTH, 0.0, 0.0],
        [WIDTH, 0.0, DEPTH],
        [0.0, 0.0, DEPTH],
    ];
    for (side, origin) in origins.into_iter().enumerate() {
        let length = if side % 2 == 0 { WIDTH } else { DEPTH };
        let (sin, cos) = (side as f64 * FRAC_PI_2).sin_cos();
        let rotate = |[x, y, z]: V| [cos * x - sin * z, y, sin * x + cos * z];
        let at = |x: f64, y: f64, z: f64| add(origin, rotate([x, y, z]));
        let out = rotate([0.0, 0.0, -1.0]);
        let windows = (length / 2.0).floor() as usize;
        let pitch = length / windows as f64;
        let xs = cuts(windows, pitch, [MARGIN, pitch - MARGIN]);
        let ys = cuts(FLOORS, FLOOR, [0.8, FLOOR - 0.4]);
        for y in ys.windows(2) {
            for x in xs.windows(2) {
                let (x0, x1, y0, y1) = (x[0], x[1], y[0], y[1]);
                let window =
                    ((x0 % pitch) - MARGIN).abs() < 1e-6 && ((y0 % FLOOR) - 0.8).abs() < 1e-6;
                let q = [
                    at(x0, y0, 0.0),
                    at(x0, y1, 0.0),
                    at(x1, y1, 0.0),
                    at(x1, y0, 0.0),
                ];
                if !window {
                    face(&mut mesh, q, out);
                    continue;
                }
                let qi = [
                    at(x0, y0, RECESS),
                    at(x0, y1, RECESS),
                    at(x1, y1, RECESS),
                    at(x1, y0, RECESS),
                ];
                face(&mut mesh, qi, out);
                let walls = [
                    [1.0, 0.0, 0.0],
                    [0.0, -1.0, 0.0],
                    [-1.0, 0.0, 0.0],
                    [0.0, 1.0, 0.0],
                ];
                for (a, n) in walls.into_iter().enumerate() {
                    let b = (a + 1) % 4;
                    face(&mut mesh, [q[a], qi[a], qi[b], q[b]], rotate(n));
                }
            }
        }
    }
    let top = FLOORS as f64 * FLOOR;
    let roof = [
        [0.0, top, 0.0],
        [0.0, top, DEPTH],
        [WIDTH, top, DEPTH],
        [WIDTH, top, 0.0],
    ];
    face(&mut mesh, roof, [0.0, 1.0, 0.0]);
    orient(&mut mesh);
    mesh
}

/// Every triangle wound so that its geometric normal follows the normal it stores.
fn orient(mesh: &mut Mesh) {
    let point = |i: u32| trillion3d_page_codec::vec3::point(&mesh.positions, i);
    let stored = |i: u32| {
        let at = i as usize * 3;
        [0, 1, 2].map(|c| f64::from(mesh.normals[at + c]))
    };
    let flips: Vec<bool> = mesh
        .indices
        .as_chunks::<3>()
        .0
        .iter()
        .map(|&[a, b, c]| {
            let n = cross(sub(point(b), point(a)), sub(point(c), point(a)));
            dot(n, stored(a)) < 0.0
        })
        .collect();
    for (tri, flip) in mesh.indices.as_chunks_mut::<3>().0.iter_mut().zip(flips) {
        if flip {
            tri.swap(1, 2);
        }
    }
}
