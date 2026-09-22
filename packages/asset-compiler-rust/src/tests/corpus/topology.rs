//! Connectivity: what a mesh's edges and borders do to the groups the DAG makes of it.
use super::shapes::{grid_indices, Exploded, Sheet};
use super::solids::{sphere, torus};
use super::*;

fn sheet(seed: u64, nx: usize, ny: usize, amplitude: f32) -> Sheet {
    let mut rng = Rng::new(seed);
    let amplitude = amplitude * (0.5 + rng.unit());
    Sheet::new(&mut rng, nx, ny, amplitude)
}

/// A torus: closed, every edge shared by two triangles, no border to keep.
fn closed_manifold(seed: u64) -> Case {
    let mut rng = Rng::new(seed);
    let (major, minor) = (rng.between(64, 96), rng.between(32, 48));
    let (positions, indices) = torus(10.0, 3.0, major, minor);
    Case::new("topology-closed-manifold", positions, indices)
}

/// A sheet with a hole: an outer and an inner open border.
fn open_borders(seed: u64) -> Case {
    let sheet = sheet(seed, 64, 64, 3.0);
    let hole = 24..40;
    let mut indices = Vec::new();
    for (quad, corners) in sheet.indices.chunks(6).enumerate() {
        let (x, y) = (quad % 64, quad / 64);
        if !(hole.contains(&x) && hole.contains(&y)) {
            indices.extend_from_slice(corners);
        }
    }
    Case::new("topology-open-borders", sheet.positions, indices)
}

/// A fin standing on the middle row: its edges belong to three triangles.
fn non_manifold_edges(seed: u64) -> Case {
    let sheet = sheet(seed, 64, 64, 3.0);
    let (mut positions, mut indices) = (sheet.positions.clone(), sheet.indices.clone());
    let first = (positions.len() / 3) as u32;
    for x in 0..=64 {
        let base = sheet.vertex(x, 32) as usize * 3;
        positions.extend([
            positions[base],
            positions[base + 1],
            positions[base + 2] + 2.0,
        ]);
    }
    let fin = |x: usize, y: usize| {
        if y == 0 {
            sheet.vertex(x, 32)
        } else {
            first + x as u32
        }
    };
    indices.extend(grid_indices(64, 1, fin));
    Case::new("topology-non-manifold-edges", positions, indices)
}

/// A coarse left half against a fine right half: the join column has a vertex on every other
/// coarse edge, and the coarse half leaves its odd vertices unused.
fn t_junctions(seed: u64) -> Case {
    let sheet = sheet(seed, 64, 64, 3.0);
    let mut indices = grid_indices(16, 32, |x, y| sheet.vertex(x * 2, y * 2));
    indices.extend(grid_indices(32, 64, |x, y| sheet.vertex(32 + x, y)));
    Case::new("topology-t-junctions", sheet.positions, indices)
}

/// Every quad its own four vertices, nothing else to tell them apart.
fn unwelded_duplicates(seed: u64) -> Case {
    let mut rng = Rng::new(seed);
    let amplitude = shapes::amplitude(&mut rng);
    let quads = Exploded::new(&mut rng, shapes::NX, shapes::NY, amplitude);
    Case::new(
        "topology-unwelded-duplicates",
        quads.positions,
        quads.indices,
    )
}

/// Zero-area triangles among the others: a repeated corner, and a corner on the opposite edge.
fn degenerate_triangles(seed: u64) -> Case {
    let sheet = sheet(seed, 64, 64, 3.0);
    let (mut positions, mut indices) = (sheet.positions.clone(), Vec::new());
    for (quad, corners) in sheet.indices.chunks(6).enumerate() {
        indices.extend_from_slice(corners);
        if quad % 16 == 0 {
            let (a, b) = (corners[0] as usize, corners[1] as usize);
            indices.extend([corners[0], corners[0], corners[1]]);
            let midpoint = (positions.len() / 3) as u32;
            let middle: Vec<f32> = (0..3)
                .map(|c| (positions[a * 3 + c] + positions[b * 3 + c]) / 2.0)
                .collect();
            positions.extend(middle);
            indices.extend([corners[0], midpoint, corners[1]]);
        }
    }
    Case::new("topology-degenerate-triangles", positions, indices)
}

/// One quad wide and thousands long: every vertex is on the open border.
fn thin_strip(seed: u64) -> Case {
    let strip = sheet(seed, 4096, 1, 1.0);
    Case::new("topology-thin-strip", strip.positions, strip.indices)
}

/// Parallel slats a quad wide, disjoint, each short enough that a cluster spans several: the
/// group borders cut the slats and lock their vertices.
fn slats(seed: u64) -> Case {
    let mut rng = Rng::new(seed);
    let (count, length) = (rng.between(48, 96), rng.between(24, 48));
    let (mut positions, mut indices) = (Vec::new(), Vec::new());
    for slat in 0..count {
        let first = (positions.len() / 3) as u32;
        let strip = Sheet::new(&mut rng, length, 1, 0.5);
        for (v, chunk) in strip.positions.chunks(3).enumerate() {
            positions.extend([
                chunk[0],
                chunk[1] + slat as f32 * 3.0,
                chunk[2] + (v % 2) as f32 * 0.1,
            ]);
        }
        indices.extend(strip.indices.iter().map(|&i| i + first));
    }
    Case::new("topology-slats", positions, indices)
}

/// Fewer triangles than one cluster holds.
fn smaller_than_cluster(seed: u64) -> Case {
    let small = sheet(seed, 5, 5, 1.0);
    Case::new(
        "topology-smaller-than-cluster",
        small.positions,
        small.indices,
    )
}

/// Exactly the triangles of one cluster.
fn exactly_one_cluster(seed: u64) -> Case {
    let one = sheet(seed, 8, 8, 1.0);
    Case::new("topology-exactly-one-cluster", one.positions, one.indices)
}

/// A flat plane of eighty thousand triangles: the simplifier's error is zero everywhere.
fn huge_flat_plane(seed: u64) -> Case {
    let plane = sheet(seed, 200, 200, 0.0);
    Case::new("topology-huge-flat-plane", plane.positions, plane.indices)
}

/// A sphere: curvature everywhere, a wrap column written twice, and at each pole a fan whose apex
/// is written once per segment. Under meshoptimizer 0.22 the last group stalled on the seam
/// positions left at the poles and the wrap column; 0.25 slides past them and the sphere climbs to
/// one root.
fn high_curvature(seed: u64) -> Case {
    let mut rng = Rng::new(seed);
    let (segments, rings) = (rng.between(64, 128), rng.between(32, 64));
    let (positions, indices, uvs) = sphere(5.0, segments, rings);
    let mut case = Case::new("topology-high-curvature", positions, indices);
    case.uv0 = Some(uvs);
    case
}

/// Rows a thousandth of a column apart: triangles a thousand times longer than wide.
fn slivers(seed: u64) -> Case {
    let mut sheet = sheet(seed, 64, 64, 0.0);
    for vertex in 0..sheet.positions.len() / 3 {
        sheet.positions[vertex * 3 + 1] *= 1.0e-3;
    }
    Case::new("topology-slivers", sheet.positions, sheet.indices)
}

pub(super) fn cases() -> Vec<(Generator, Expect)> {
    vec![
        (closed_manifold, Expect::ONE_ROOT),
        (open_borders, Expect::ONE_ROOT),
        (non_manifold_edges, Expect::ONE_ROOT),
        (t_junctions, Expect::ONE_ROOT),
        (unwelded_duplicates, Expect::ONE_ROOT),
        (degenerate_triangles, Expect::ONE_ROOT),
        (thin_strip, Expect::ONE_ROOT),
        (slats, Expect::ONE_ROOT),
        (smaller_than_cluster, Expect::ONE_ROOT),
        (exactly_one_cluster, Expect::ONE_ROOT),
        (huge_flat_plane, Expect::ONE_ROOT),
        (high_curvature, Expect::ONE_ROOT),
        (slivers, Expect::ONE_ROOT),
    ]
}
