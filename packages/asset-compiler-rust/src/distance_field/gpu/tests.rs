//! The GPU's field against the CPU's, on meshes of every kind: the same bytes, every one — the
//! voxels the GPU measured in doubt measured again in double precision. Each test skips, saying
//! why, where no device opens.
use super::measure;
use crate::distance_field::build::{assemble, grids, on_cpu, Field};
use crate::distance_field::samples::directions;
use crate::distance_field::scene::Scene;
use crate::distance_field::DistanceFieldSettings;
use crate::hlod::flatten::gpu::device;
use std::f32::consts::TAU;

type Point = [f32; 3];

/// The soup of the triangles `[a, b, c]` of `corners`: nine floats a triangle, in metres.
fn soup(corners: &[[Point; 3]]) -> Vec<f32> {
    corners.iter().flatten().flatten().copied().collect()
}

/// The lattice of `rows × columns` quads over the points `at(row, column)` gives, two triangles a
/// quad, wound so that `(column step) × (row step)` is the front.
fn lattice(rows: usize, columns: usize, at: impl Fn(usize, usize) -> Point) -> Vec<[Point; 3]> {
    let mut triangles = Vec::new();
    for i in 0..rows {
        for j in 0..columns {
            let (a, b) = (at(i, j), at(i, j + 1));
            let (c, d) = (at(i + 1, j), at(i + 1, j + 1));
            triangles.push([a, b, c]);
            triangles.push([b, d, c]);
        }
    }
    triangles
}

/// The box `low, high` closed, its twelve triangles wound outward.
fn cuboid(low: Point, high: Point) -> Vec<[Point; 3]> {
    let corner = |c: usize| [0, 1, 2].map(|k| if (c >> k) & 1 == 1 { high[k] } else { low[k] });
    (crate::distance_field::BOX_FACES.iter())
        .flat_map(|&[a, b, c, d]| [[a, b, c], [a, c, d]])
        .map(|t| t.map(corner))
        .collect()
}

/// A sphere of radius `radius` metres about the origin.
fn sphere(radius: f32) -> Vec<[Point; 3]> {
    let (rings, around) = (24, 32);
    lattice(rings, around, |i, j| {
        let (theta, phi) = (
            std::f32::consts::PI * i as f32 / rings as f32,
            TAU * (j % around) as f32 / around as f32,
        );
        [
            radius * theta.sin() * phi.cos(),
            radius * theta.cos(),
            radius * theta.sin() * phi.sin(),
        ]
    })
}

/// A torus of major radius `major` and minor `minor` metres about the origin.
fn torus(major: f32, minor: f32) -> Vec<[Point; 3]> {
    let (around, tube) = (32, 16);
    lattice(around, tube, |i, j| {
        let (u, v) = (
            TAU * (i % around) as f32 / around as f32,
            TAU * (j % tube) as f32 / tube as f32,
        );
        let ring = major + minor * v.cos();
        [ring * u.cos(), minor * v.sin(), ring * u.sin()]
    })
}

/// A flat square of `side` metres in the plane `y = 0`, open, in `quads × quads` quads.
fn plane(side: f32, quads: usize) -> Vec<[Point; 3]> {
    let step = side / quads as f32;
    lattice(quads, quads, |i, j| {
        [
            i as f32 * step - 0.5 * side,
            0.0,
            j as f32 * step - 0.5 * side,
        ]
    })
}

/// A slab and a rod each thinner than a voxel: a square 2 m across and a centimetre thick, and a
/// rod two centimetres square and a metre and a half tall standing on it.
fn thin_parts() -> Vec<[Point; 3]> {
    let mut triangles = cuboid([-1.0, -0.005, -1.0], [1.0, 0.005, 1.0]);
    triangles.extend(cuboid([0.2, 0.005, 0.2], [0.22, 1.505, 0.22]));
    triangles
}

/// `count` triangles of random corners, edges up to half a metre, in the box of 2 metres, from a
/// fixed stream.
fn random_soup(count: usize) -> Vec<[Point; 3]> {
    let mut seed = 0x2545_f491u32;
    let mut next = move || {
        seed = seed.wrapping_mul(196_314_165).wrapping_add(907_633_515);
        (seed >> 8) as f32 / (1u32 << 24) as f32
    };
    (0..count)
        .map(|_| {
            let a: Point = [0, 1, 2].map(|_| 2.0 * next() - 1.0);
            let mut near = |from: Point| from.map(|x| x + next() - 0.5);
            let b = near(a);
            [a, b, near(a)]
        })
        .collect()
}

/// The field of `triangles` built both ways, and the voxels the GPU left to the CPU; none when no
/// device opens.
fn both_ways(triangles: &[[Point; 3]], two_sided: bool) -> Option<(Field, Field, usize)> {
    if let Err(error) = device() {
        eprintln!("skipped: no GPU device opens ({error})");
        return None;
    }
    let soup = soup(triangles);
    let kept: Vec<usize> = (0..triangles.len()).collect();
    let flags = vec![two_sided; triangles.len()];
    let scene = Scene::of_triangles(&soup, flags, &kept, two_sided).expect("triangles to query");
    let (grid, mips) = grids(&scene, &DistanceFieldSettings::default());
    let rays = directions();
    let placed = (&grid, mips.as_slice());
    let cpu = assemble(placed, on_cpu(&scene, &mips, &rays), scene.mostly_two_sided);
    let (measured, remeasured) = measure(&scene, &mips, &rays).expect("the GPU to measure");
    let gpu = assemble(placed, measured, scene.mostly_two_sided);
    Some((cpu, gpu, remeasured))
}

/// Builds `triangles` both ways and asserts the two fields hold the same bricks and the same
/// bytes, printing how many voxels the CPU measured again.
fn assert_same(name: &str, triangles: &[[Point; 3]], two_sided: bool) {
    let Some((cpu, gpu, remeasured)) = both_ways(triangles, two_sided) else {
        return;
    };
    let voxels: usize = cpu.mips.iter().map(|mip| mip.voxels.len()).sum();
    println!("{name}: {voxels} voxels stored, {remeasured} measured again on the CPU");
    for (mip, (c, g)) in cpu.mips.iter().zip(&gpu.mips).enumerate() {
        assert!(
            c.indirection == g.indirection,
            "{name}: mip {mip} stores other bricks"
        );
        let differing = c
            .voxels
            .iter()
            .zip(&g.voxels)
            .filter(|(a, b)| a != b)
            .count();
        assert_eq!(differing, 0, "{name}: mip {mip}, {differing} voxels differ");
    }
}

#[test]
fn a_closed_box_is_the_same_on_the_gpu() {
    assert_same("box", &cuboid([-0.8, -0.5, -0.6], [0.8, 0.5, 0.6]), false);
}

#[test]
fn a_sphere_is_the_same_on_the_gpu() {
    assert_same("sphere", &sphere(1.0), false);
}

#[test]
fn an_open_plane_two_sided_is_the_same_on_the_gpu() {
    assert_same("plane", &plane(2.0, 8), true);
}

#[test]
fn a_torus_is_the_same_on_the_gpu() {
    assert_same("torus", &torus(0.7, 0.3), false);
}

#[test]
fn parts_thinner_than_a_voxel_are_the_same_on_the_gpu() {
    assert_same("thin parts", &thin_parts(), false);
}

#[test]
fn a_random_triangle_soup_is_the_same_on_the_gpu() {
    assert_same("soup", &random_soup(150), false);
}
