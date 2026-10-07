//! Four procedural meshes built with the benches' xorshift: a 1,024 m terrain, a smooth sphere,
//! a hard-surface tower (`building.rs`) and a tree of leaf cards (`vegetation.rs`).
use crate::geometry_page::{Attribute, FLAG_NORMAL, FLAG_UV};
use crate::tests::random::Xorshift;
use std::collections::HashMap;
use std::f64::consts::TAU;
use trillion3d_math::vec3::{add, length};

pub(super) type V = [f64; 3];

/// A unit vector along `v`.
pub(super) fn normalize(v: V) -> V {
    crate::shared_math::normalized_or(v, [0.0, 0.0, 1.0])
}

/// A mesh: positions, normals, optional texture coordinates, triangles.
#[derive(Default)]
pub(super) struct Mesh {
    pub positions: Vec<f32>,
    pub normals: Vec<f32>,
    pub uv: Option<Vec<f32>>,
    pub indices: Vec<u32>,
}

impl Mesh {
    /// Its normals and texture coordinates as the pages carry them.
    pub(super) fn attributes(&self) -> Vec<Attribute> {
        let normals = Attribute {
            flag: FLAG_NORMAL,
            width: 3,
            values: self.normals.clone(),
        };
        let uv = self.uv.iter().map(|values| Attribute {
            flag: FLAG_UV,
            width: 2,
            values: values.clone(),
        });
        std::iter::once(normals).chain(uv).collect()
    }
    pub(super) fn vertex(&mut self, p: V, n: V, uv: [f64; 2]) -> u32 {
        let id = (self.positions.len() / 3) as u32;
        self.positions.extend(p.map(|x| x as f32));
        self.normals.extend(n.map(|x| x as f32));
        self.uv
            .get_or_insert_with(Vec::new)
            .extend(uv.map(|x| x as f32));
        id
    }
    /// A quad `o, o+u, o+u+v, o+v` under one normal, texture coordinates in metres × `uv_scale`.
    pub(super) fn quad(&mut self, o: V, u: V, v: V, n: V, uv_scale: f64) {
        let (lu, lv) = (length(u) * uv_scale, length(v) * uv_scale);
        let b = self.vertex(o, n, [0.0, 0.0]);
        self.vertex(add(o, u), n, [lu, 0.0]);
        self.vertex(add(add(o, u), v), n, [lu, lv]);
        self.vertex(add(o, v), n, [0.0, lv]);
        self.indices.extend([b, b + 1, b + 2, b, b + 2, b + 3]);
    }
}

pub(super) fn gaussian(rng: &mut Xorshift) -> f64 {
    let u = f64::from(rng.unit()).max(1e-12);
    (-2.0 * u.ln()).sqrt() * (TAU * f64::from(rng.unit())).cos()
}
pub(super) fn uniform(rng: &mut Xorshift, low: f64, high: f64) -> f64 {
    low + (high - low) * f64::from(rng.unit())
}

/// An icosphere of `subdivisions` levels and `radius` metres, smooth normals, no texture.
pub(super) fn sphere(subdivisions: usize, radius: f64) -> Mesh {
    let t = (1.0 + 5f64.sqrt()) / 2.0;
    let seeds = [
        [-1., t, 0.],
        [1., t, 0.],
        [-1., -t, 0.],
        [1., -t, 0.],
        [0., -1., t],
        [0., 1., t],
        [0., -1., -t],
        [0., 1., -t],
        [t, 0., -1.],
        [t, 0., 1.],
        [-t, 0., -1.],
        [-t, 0., 1.],
    ];
    let mut points: Vec<V> = seeds.iter().map(|&p| normalize(p)).collect();
    let mut faces: Vec<[u32; 3]> = vec![
        [0, 11, 5],
        [0, 5, 1],
        [0, 1, 7],
        [0, 7, 10],
        [0, 10, 11],
        [1, 5, 9],
        [5, 11, 4],
        [11, 10, 2],
        [10, 7, 6],
        [7, 1, 8],
        [3, 9, 4],
        [3, 4, 2],
        [3, 2, 6],
        [3, 6, 8],
        [3, 8, 9],
        [4, 9, 5],
        [2, 4, 11],
        [6, 2, 10],
        [8, 6, 7],
        [9, 8, 1],
    ];
    for _ in 0..subdivisions {
        let mut middle: HashMap<(u32, u32), u32> = HashMap::new();
        let mut mid = |a: u32, b: u32, points: &mut Vec<V>| {
            *middle.entry((a.min(b), a.max(b))).or_insert_with(|| {
                points.push(normalize(add(points[a as usize], points[b as usize])));
                (points.len() - 1) as u32
            })
        };
        faces = faces
            .iter()
            .flat_map(|&[a, b, c]| {
                let (ab, bc, ca) = (
                    mid(a, b, &mut points),
                    mid(b, c, &mut points),
                    mid(c, a, &mut points),
                );
                [[a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]]
            })
            .collect();
    }
    let mut mesh = Mesh::default();
    for p in &points {
        mesh.positions.extend(p.map(|x| (x * radius) as f32));
        mesh.normals.extend(p.map(|x| x as f32));
    }
    mesh.indices = faces.concat();
    mesh
}

/// A `size`-metre terrain of `n × n` vertices, y up, band-limited relief (shortest wavelength
/// 16 m), gradient normals and a texture repeating every 16 m.
pub(super) fn terrain(n: usize, size: f64) -> Mesh {
    let mut rng = Xorshift::new(1234);
    let phases: Vec<[f64; 3]> = (0..5)
        .map(|_| [0; 3].map(|_| uniform(&mut rng, 0.0, 100.0)))
        .collect();
    let height = |x: f64, y: f64| {
        let (mut h, mut amplitude, mut wavelength) = (0.0, 30.0, 256.0);
        for ph in &phases {
            let f = TAU / wavelength;
            h += amplitude
                * ((x * f + ph[0]).sin() * (y * f * 1.13 + ph[1]).cos()
                    + 0.5 * ((x * 0.7 + y * 0.7) * f + ph[2]).sin());
            amplitude *= 0.45;
            wavelength /= 2.0;
        }
        h
    };
    let step = size / (n - 1) as f64;
    let mut mesh = Mesh::default();
    for j in 0..n {
        for i in 0..n {
            let (x, y) = (i as f64 * step, j as f64 * step);
            let gx = (height(x + step, y) - height(x - step, y)) / (2.0 * step);
            let gy = (height(x, y + step) - height(x, y - step)) / (2.0 * step);
            mesh.vertex(
                [x, height(x, y), y],
                normalize([-gx, 1.0, -gy]),
                [x / 16.0, y / 16.0],
            );
        }
    }
    // Transposed so that the triangles face up (+y).
    mesh.indices = crate::tests::fixtures::grid_indices(n - 1, n - 1, |j, i| (j * n + i) as u32);
    mesh
}
