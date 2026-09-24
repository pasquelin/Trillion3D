//! A thin part keeps its silhouette within the error of every cut, or leaves under it (#484).
use super::part8::Shaded;
use super::*;

const RADIUS: f32 = 0.1;

/// A displaced sheet and, above it and apart from it, a thin cylinder `RADIUS` wide and 40 long,
/// smooth shaded. Returns the mesh and the first vertex of the cylinder.
fn sheet_and_cylinder() -> (Shaded, u32) {
    let (positions, indices) = grid(48);
    let normals = [0.0, 0.0, 1.0].repeat(positions.len() / 3);
    let mut mesh = Shaded {
        positions,
        normals,
        indices,
    };
    let first = (mesh.positions.len() / 3) as u32;
    let (segments, rings) = (16usize, 128usize);
    for j in 0..=rings {
        for i in 0..segments {
            let angle = i as f32 / segments as f32 * std::f32::consts::TAU;
            let (sin, cos) = angle.sin_cos();
            let x = 4.0 + 40.0 * j as f32 / rings as f32;
            mesh.positions
                .extend([x, 24.0 + RADIUS * cos, 10.0 + RADIUS * sin]);
            mesh.normals.extend([0.0, cos, sin]);
        }
    }
    let at = |i: usize, j: usize| first + (j * segments + i % segments) as u32;
    // Wound outward: around the axis, then along it.
    let tube = crate::tests::fixtures::grid_indices(segments, rings, at);
    mesh.indices.extend(tube);
    (mesh, first)
}

// Behaviour: at every threshold, the cut the runtime draws either keeps the whole cylinder
// within the cut's error of its source surface — its silhouette, not a line or a star — or has
// dropped it, and only once the cut's error covers its radius.
#[test]
fn a_thin_cylinder_keeps_its_silhouette_or_leaves_under_its_error() {
    let (mesh, first) = sheet_and_cylinder();
    let (dag, _) = mesh.build();
    let on_cylinder = |tri: &[u32; 3]| tri.iter().all(|&v| v >= first);
    let source: Vec<u32> = mesh
        .indices
        .as_chunks::<3>()
        .0
        .iter()
        .filter(|tri| on_cylinder(tri))
        .flatten()
        .copied()
        .collect();
    let mut thresholds: Vec<f64> = dag.iter().map(|c| c.lod_error).collect();
    thresholds.sort_by(f64::total_cmp);
    thresholds.dedup();
    assert!(thresholds.len() > 3, "the mesh climbs");
    for t in thresholds {
        let cut: Vec<u32> = dag
            .iter()
            .filter(|c| c.lod_error <= t && t < c.parent_error)
            .flat_map(|c| c.indices.as_chunks::<3>().0.iter())
            .filter(|tri| on_cylinder(tri))
            .flatten()
            .copied()
            .collect();
        if cut.is_empty() {
            assert!(t >= RADIUS as f64, "the cylinder left at error {t}");
            continue;
        }
        let distance = crate::physics_cook::hausdorff::distance(&mesh.positions, &source, &cut);
        assert!(
            distance <= t + 1e-6,
            "at error {t} the cylinder drifts {distance} from its source"
        );
    }
}
