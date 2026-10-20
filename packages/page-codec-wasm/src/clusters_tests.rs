use super::{cluster, Caps};
use crate::fixtures::{grid, soup};

const CAPS: Caps = Caps {
    triangles: 128,
    vertices: 256,
};

/// Every source triangle once, its corners in their order, and every cluster within the caps.
fn assert_partition(indices: &[u32], out: &[u32], ends: &[usize]) {
    let mut a: Vec<[u32; 3]> = indices
        .as_chunks::<3>()
        .0
        .iter()
        .map(|t| [t[0], t[1], t[2]])
        .collect();
    let mut b: Vec<[u32; 3]> = out
        .as_chunks::<3>()
        .0
        .iter()
        .map(|t| [t[0], t[1], t[2]])
        .collect();
    a.sort_unstable();
    b.sort_unstable();
    assert_eq!(a, b, "every triangle once, its winding kept");
    let mut start = 0;
    for &end in ends {
        assert!(end > start && (end - start) / 3 <= CAPS.triangles);
        let mut v: Vec<u32> = out[start..end].to_vec();
        v.sort_unstable();
        v.dedup();
        assert!(v.len() <= CAPS.vertices, "{} vertices", v.len());
        start = end;
    }
    assert_eq!(start, out.len());
}

#[test]
fn the_free_clusters_partition_every_family_within_the_caps() {
    for (positions, indices) in [
        grid(40, false),
        grid(40, true),
        soup(3000, 7),
        grid(1, false),
    ] {
        let built = cluster(&positions, &indices, CAPS, false);
        assert_partition(&indices, &built.indices, &built.ends);
    }
}

/// A grid has as many clusters by columns as by rows, near full ones (parts of 124 to 128
/// triangles), and each cluster a compact patch, never a strip across the mesh — a strip of 128
/// triangles spans 65 quads.
#[test]
fn a_grid_by_columns_clusters_as_compactly_as_by_rows() {
    for by_columns in [false, true] {
        let (positions, indices) = grid(64, by_columns);
        let built = cluster(&positions, &indices, CAPS, false);
        let floor = (indices.len() / 3).div_ceil(CAPS.triangles);
        assert!(
            built.ends.len() <= floor + floor / 8,
            "{} clusters",
            built.ends.len()
        );
        let mut start = 0;
        for &end in &built.ends {
            let xs = built.indices[start..end].iter().map(|&v| v % 65);
            let ys = built.indices[start..end].iter().map(|&v| v / 65);
            let span = |it: &mut dyn Iterator<Item = u32>| {
                let all: Vec<u32> = it.collect();
                all.iter().max().unwrap() - all.iter().min().unwrap()
            };
            // An 8 × 8 patch of quads spans 16; a part of the graph is near that, far from a strip.
            assert!(
                span(&mut xs.clone()) + span(&mut ys.clone()) <= 24,
                "a strip"
            );
            start = end;
        }
    }
}

/// A soup of 1 000 lone triangles is cut by the triangles alone, then each cluster, 384 vertices
/// over the cap of 256, halved at encode.
#[test]
fn a_soup_is_halved_by_its_vertices() {
    let (positions, indices) = soup(1000, 3);
    let built = cluster(&positions, &indices, CAPS, false);
    assert_partition(&indices, &built.indices, &built.ends);
    assert!(built.ends.len() >= 2 * 1000usize.div_ceil(CAPS.triangles));
}

/// Held to the source order, the clusters tile it: runs of consecutive triangles in order, every
/// family within the caps.
#[test]
fn ordered_clusters_tile_the_source_order() {
    for (positions, indices) in [grid(30, false), grid(40, true), soup(3000, 7)] {
        let built = cluster(&positions, &indices, CAPS, true);
        assert_eq!(built.indices, indices, "the source order");
        assert_partition(&indices, &built.indices, &built.ends);
    }
}
