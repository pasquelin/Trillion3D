//! The one clusterer (`trillion3d_page_codec::clusters`, the spatial rule) against the linked
//! meshlet builder it replaced, kept here as the oracle: on every generated family it makes no more
//! clusters, and their bounding spheres are on average no wider than the oracle's by more than a
//! twentieth — narrower on grids in either index order and on soups.
use super::*;
use crate::qem::compact_region;
use trillion3d_page_codec::fixtures::soup;

/// The oracle: the meshlet builder's clusters of `indices`, as the compiler cut them before.
fn meshlets(positions: &[f32], indices: &[u32]) -> Vec<Vec<u32>> {
    let (local, local_indices, remap) = compact_region(positions, indices);
    let bytes: Vec<u8> = local.iter().flat_map(|v| v.to_le_bytes()).collect();
    let vertices = meshopt::VertexDataAdapter::new(&bytes, 12, 0).expect("positions");
    let built = meshopt::build_meshlets(
        &local_indices,
        &vertices,
        DAG_CLUSTER_VERTICES,
        DAG_CLUSTER_TRIANGLES,
        0.0,
    );
    (0..built.len())
        .map(|k| {
            let m = built.get(k);
            m.triangles
                .iter()
                .map(|&c| remap[m.vertices[c as usize] as usize])
                .collect()
        })
        .collect()
}

/// A UV sphere of `rings` × `segments` quads: poles of tiny triangles, a curved surface.
fn uv_sphere(rings: u32, segments: u32) -> (Vec<f32>, Vec<u32>) {
    let mut positions = Vec::new();
    for r in 0..=rings {
        for s in 0..=segments {
            let theta = std::f64::consts::PI * r as f64 / rings as f64;
            let phi = std::f64::consts::TAU * s as f64 / segments as f64;
            let p = [
                theta.sin() * phi.cos(),
                theta.cos(),
                theta.sin() * phi.sin(),
            ];
            positions.extend(p.map(|x| x as f32));
        }
    }
    let mut indices = Vec::new();
    for r in 0..rings {
        for s in 0..segments {
            let v = r * (segments + 1) + s;
            indices.extend([
                v,
                v + segments + 1,
                v + 1,
                v + 1,
                v + segments + 1,
                v + segments + 2,
            ]);
        }
    }
    (positions, indices)
}

/// `grid(n)`'s triangles listed column by column.
fn by_columns(n: usize) -> (Vec<f32>, Vec<u32>) {
    let (positions, rows) = grid(n);
    let mut indices = Vec::with_capacity(rows.len());
    for x in 0..n {
        for y in 0..n {
            indices.extend_from_slice(&rows[(y * n + x) * 6..(y * n + x) * 6 + 6]);
        }
    }
    (positions, indices)
}

fn mean_radius(positions: &[f32], clusters: &[Vec<u32>]) -> f64 {
    let total: f64 = clusters
        .iter()
        .map(|c| bounding_sphere(positions, c)[3])
        .sum();
    total / clusters.len() as f64
}

#[test]
fn the_one_clusterer_is_as_full_and_as_compact_as_the_meshlet_builder() {
    let families = [
        ("grid", grid(96)),
        ("grid by columns", by_columns(96)),
        ("sphere", uv_sphere(80, 120)),
        ("soup", soup(6000, 5)),
    ];
    for (name, (positions, indices)) in families {
        let ours =
            cluster_triangles(&positions, &indices, DAG_CLUSTER_TRIANGLES).expect("clusters");
        let oracle = meshlets(&positions, &indices);
        let (r, o) = (
            mean_radius(&positions, &ours),
            mean_radius(&positions, &oracle),
        );
        assert!(
            ours.len() <= oracle.len(),
            "{name}: {} clusters, the oracle {}",
            ours.len(),
            oracle.len()
        );
        assert!(r <= o * 1.05, "{name}: mean radius {r}, the oracle's {o}");
        if name != "sphere" {
            assert!(r < o, "{name}: mean radius {r}, the oracle's {o}");
        }
    }
}
