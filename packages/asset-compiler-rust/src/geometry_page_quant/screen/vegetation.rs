//! A tree: the typical foliage asset.
use super::meshes::{gaussian, normalize, uniform, Mesh, V};
use crate::tests::random::Xorshift;
use std::f64::consts::TAU;
use trillion3d_page_codec::vec3::{add, cross, length, scale as scaled, sub};

/// A tree: a tapered trunk, 40 branches (smooth cylinders) and 15,000 leaf cards, each a quad
/// of two triangles on its own, at random orientations.
pub(super) fn vegetation() -> Mesh {
    let mut rng = Xorshift::new(1234);
    let mut mesh = Mesh::default();
    cylinder(&mut mesh, [0.0; 3], [0.0, 8.0, 0.0], (0.45, 0.2), (24, 32));
    let mut tips = Vec::new();
    for _ in 0..40 {
        let y = 3.0 + 5.0 * f64::from(rng.unit());
        let (a, el) = (uniform(&mut rng, 0.0, TAU), uniform(&mut rng, 0.2, 0.9));
        let d = [a.cos() * el.cos(), el.sin(), a.sin() * el.cos()];
        let l = uniform(&mut rng, 1.5, 3.5);
        let p0 = [0.0, y, 0.0];
        cylinder(&mut mesh, p0, add(p0, scaled(d, l)), (0.08, 0.02), (10, 8));
        tips.push((p0, d, l));
    }
    for _ in 0..15_000 {
        let (p0, d, l) = tips[rng.below(tips.len())];
        let jitter = [0; 3].map(|_| gaussian(&mut rng) * 0.35);
        let c = add(add(p0, scaled(d, l * uniform(&mut rng, 0.3, 1.0))), jitter);
        let u = normalize([0; 3].map(|_| gaussian(&mut rng)));
        let v = normalize(cross(u, [0; 3].map(|_| gaussian(&mut rng))));
        let s = uniform(&mut rng, 0.12, 0.22);
        let (u, v) = (scaled(u, s), scaled(v, s));
        let o = add(c, scaled(add(u, v), -0.5));
        let v = scaled(v, 1.4);
        mesh.quad(o, u, v, normalize(cross(u, v)), 1.0 / s);
    }
    mesh
}

/// A cylinder from `p0` to `p1`, radii `r0` to `r1`, `segments` around and `rings` along.
fn cylinder(mesh: &mut Mesh, p0: V, p1: V, (r0, r1): (f64, f64), (segments, rings): (u32, u32)) {
    let axis = sub(p1, p0);
    let l = length(axis);
    let axis = scaled(axis, 1.0 / l);
    let t = normalize(cross(axis, [0.3, 1.0, 0.2]));
    let bt = cross(axis, t);
    let base = (mesh.positions.len() / 3) as u32;
    for i in 0..=rings {
        let s = f64::from(i) / f64::from(rings);
        let (centre, r) = (add(p0, scaled(axis, l * s)), r0 + (r1 - r0) * s);
        for j in 0..=segments {
            let a = TAU * f64::from(j) / f64::from(segments);
            let n = add(scaled(t, a.cos()), scaled(bt, a.sin()));
            mesh.vertex(
                add(centre, scaled(n, r)),
                n,
                [f64::from(j) / f64::from(segments), s * l],
            );
        }
    }
    let at = |ring: usize, segment: usize| base + (ring * (segments as usize + 1) + segment) as u32;
    mesh.indices.extend(crate::tests::fixtures::grid_indices(
        rings as usize,
        segments as usize,
        at,
    ));
}
