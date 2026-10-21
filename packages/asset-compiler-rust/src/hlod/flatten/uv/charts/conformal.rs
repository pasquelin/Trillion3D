//! The least-squares conformal map of a chart (Lévy et al. 2002), from its current texture
//! coordinates:
//!
//! - two boundary vertices pinned where they are: of the boundary vertices from the second on, the
//!   least and greatest along each axis (the first found kept on a tie), the pair farthest apart
//!   (the last axis among equals); a chart with no boundary is left as it is;
//! - per face two rows asking its texture triangle to be similar to its space triangle: from its
//!   angles (the angle-based relations, the corner of the largest sine taken last), or, when an
//!   angle is zero, from its corners in a frame of its own plane;
//! - the system solved (`LeastSquares`, at most five iterations per vertex), the coordinates
//!   rounded to single precision.
use super::mesh::TriMesh;
use super::solver::LeastSquares;
use super::vector::{clamp_to, unit, Vec2, Vec3};
use std::f32::consts::PI;
use trillion3d_math::vector::vec3::cross;
use trillion3d_math::vector::vecn::{dot, length, sub};

pub(super) fn conformal_map(mesh: &mut TriMesh) {
    let Some(pinned) = pinned_vertices(mesh) else {
        return;
    };
    let vertex_count = mesh.positions.len();
    let mut system = LeastSquares::new(2 * vertex_count, 5 * vertex_count);
    for (vertex, uv) in mesh.texcoords.iter().enumerate() {
        system.set(2 * vertex, f64::from(uv[0]));
        system.set(2 * vertex + 1, f64::from(uv[1]));
        if vertex == pinned.0 || vertex == pinned.1 {
            system.lock(2 * vertex);
            system.lock(2 * vertex + 1);
        }
    }
    system.number_unknowns();
    for face in 0..mesh.face_count() {
        let ids = [0, 1, 2].map(|k| mesh.indices[face * 3 + k]);
        let [p0, p1, p2] = mesh.face_corners(face);
        if !angle_rows(&mut system, ids, p0, p1, p2) {
            plane_rows(&mut system, ids, p0, p1, p2);
        }
    }
    system.solve();
    for (vertex, uv) in mesh.texcoords.iter_mut().enumerate() {
        *uv = [
            system.get(2 * vertex) as f32,
            system.get(2 * vertex + 1) as f32,
        ];
    }
}

/// The two boundary vertices the map pins, `None` when the mesh has no boundary.
fn pinned_vertices(mesh: &TriMesh) -> Option<(usize, usize)> {
    let count = mesh.positions.len();
    let first = (1..count).find(|&v| mesh.on_boundary(v))?;
    let (mut low, mut high) = ([first; 3], [first; 3]);
    for v in 1..count {
        if !mesh.on_boundary(v) {
            continue;
        }
        let p = mesh.positions[v];
        for axis in 0..3 {
            if p[axis] < mesh.positions[low[axis]][axis] {
                low[axis] = v;
            } else if p[axis] > mesh.positions[high[axis]][axis] {
                high[axis] = v;
            }
        }
    }
    let spans =
        [0, 1, 2].map(|axis| length(sub(mesh.positions[low[axis]], mesh.positions[high[axis]])));
    let axis = if spans[0] > spans[1] && spans[0] > spans[2] {
        0
    } else if spans[1] > spans[2] {
        1
    } else {
        2
    };
    Some((low[axis], high[axis]))
}

/// The angle at `at` between the directions to `a` and to `b`, its cosine held in `[−1, 1]`.
fn angle(a: Vec3, at: Vec3, b: Vec3) -> f32 {
    let (d1, d2) = (sub(a, at), sub(b, at));
    clamp_to(dot(d1, d2) / (length(d1) * length(d2)), -1.0, 1.0).acos()
}

/// The two rows of a face from its angles; `false` when an angle is zero.
fn angle_rows(system: &mut LeastSquares, ids: [usize; 3], p0: Vec3, p1: Vec3, p2: Vec3) -> bool {
    let mut a0 = angle(p2, p0, p1);
    let mut a1 = angle(p0, p1, p2);
    let mut a2 = PI - a1 - a0;
    if a0 == 0.0 || a1 == 0.0 || a2 == 0.0 {
        return false;
    }
    let [mut id0, mut id1, mut id2] = ids;
    let (mut s0, mut s1, mut s2) = (a0.sin(), a1.sin(), a2.sin());
    if s1 > s0 && s1 > s2 {
        std::mem::swap(&mut s1, &mut s2);
        std::mem::swap(&mut s0, &mut s1);
        std::mem::swap(&mut a1, &mut a2);
        std::mem::swap(&mut a0, &mut a1);
        std::mem::swap(&mut id1, &mut id2);
        std::mem::swap(&mut id0, &mut id1);
    } else if s0 > s1 && s0 > s2 {
        std::mem::swap(&mut s0, &mut s2);
        std::mem::swap(&mut s0, &mut s1);
        std::mem::swap(&mut a0, &mut a2);
        std::mem::swap(&mut a0, &mut a1);
        std::mem::swap(&mut id0, &mut id2);
        std::mem::swap(&mut id0, &mut id1);
    }
    let c0 = a0.cos();
    let ratio = if s2 == 0.0 { 1.0 } else { s1 / s2 };
    let cosine = c0 * ratio;
    let sine = s0 * ratio;
    face_rows(
        system,
        [id0, id1, id2],
        [cosine - 1.0, -sine, -cosine, sine, 1.0].map(f64::from),
        [sine, cosine - 1.0, -sine, -cosine, 1.0].map(f64::from),
    );
    true
}

/// The face's corners in a frame of its plane: the first at the origin, the second on the first
/// axis.
fn plane_corners(p0: Vec3, p1: Vec3, p2: Vec3) -> [Vec2; 3] {
    let x = unit(sub(p1, p0));
    let z = unit(cross(x, sub(p2, p0)));
    let y = cross(z, x);
    [
        [0.0, 0.0],
        [length(sub(p1, p0)), 0.0],
        [dot(sub(p2, p0), x), dot(sub(p2, p0), y)],
    ]
}

/// The two rows of a face from its corners in its own plane.
fn plane_rows(system: &mut LeastSquares, ids: [usize; 3], p0: Vec3, p1: Vec3, p2: Vec3) {
    let [z0, z1, z2] = plane_corners(p0, p1, p2);
    let a = f64::from(z1[0] - z0[0]);
    let b = f64::from(z1[1] - z0[1]);
    let c = f64::from(z2[0] - z0[0]);
    let d = f64::from(z2[1] - z0[1]);
    face_rows(
        system,
        ids,
        [-a + c, b - d, -c, d, a],
        [-b + d, -a + c, -d, -c, a],
    );
}

/// A face's two rows, its vertices' variables `u = 2·id`, `v = 2·id + 1`: the real part on
/// `u0, v0, u1, v1, u2`, the imaginary part on `u0, v0, u1, v1, v2`, coefficients in that order.
fn face_rows(system: &mut LeastSquares, ids: [usize; 3], real: [f64; 5], imaginary: [f64; 5]) {
    let [id0, id1, id2] = ids;
    let shared = [2 * id0, 2 * id0 + 1, 2 * id1, 2 * id1 + 1];
    for (last, row) in [(2 * id2, real), (2 * id2 + 1, imaginary)] {
        system.open_row();
        for (variable, value) in shared.into_iter().chain([last]).zip(row) {
            system.term(variable, value);
        }
        system.close_row();
    }
}
