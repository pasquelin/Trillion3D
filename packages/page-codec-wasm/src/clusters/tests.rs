use super::{cluster, Caps};
use crate::fixtures::{grid, soup};

const CAPS: Caps = Caps {
    triangles: 128,
    vertices: 256,
};

/// A triangle's corners turned so its least vertex comes first, its winding kept: the strips
/// start a triangle at whichever corner they enter it, so a cluster's triangles are the source's
/// up to that turn.
fn turned(t: &[u32]) -> [u32; 3] {
    let first = (0..3).min_by_key(|&k| t[k]).unwrap_or(0);
    [t[first], t[(first + 1) % 3], t[(first + 2) % 3]]
}

/// Every source triangle once, its winding kept (each corner order up to a turn), and every
/// cluster within the caps.
fn assert_partition(indices: &[u32], out: &[u32], ends: &[usize]) {
    let mut a: Vec<[u32; 3]> = indices
        .as_chunks::<3>()
        .0
        .iter()
        .map(|t| turned(t))
        .collect();
    let mut b: Vec<[u32; 3]> = out.as_chunks::<3>().0.iter().map(|t| turned(t)).collect();
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
            // An 8 × 8 patch of quads spans 8 each way; the graph's parts are patches of irregular
            // outline near that, a strip spans the grid's 64 one way.
            let (wide, tall) = (span(&mut xs.clone()), span(&mut ys.clone()));
            assert!(
                wide.max(tall) <= 24,
                "a strip: {wide} × {tall} (by columns: {by_columns})"
            );
            start = end;
        }
    }
}

/// A soup of 1 000 lone triangles is cut by the triangles alone, then each cluster, whose strips
/// lay 375 vertices over the cap of 256, is halved (`strip::constrained`).
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
