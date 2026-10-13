use super::ordered::ordered;
use super::spatial::spatial;
use super::Caps;
use crate::fixtures::{grid, soup};

const CAPS: Caps = Caps {
    triangles: 128,
    vertices: 255,
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
fn the_spatial_rule_partitions_every_family_within_the_caps() {
    for (positions, indices) in [
        grid(40, false),
        grid(40, true),
        soup(3000, 7),
        grid(1, false),
    ] {
        let built = spatial(&positions, &indices, CAPS);
        assert_partition(&indices, &built.indices, &built.ends);
    }
}

/// A grid has as many clusters by columns as by rows, full ones: as few as the caps allow, and each
/// cluster a square patch, never a strip across the mesh.
#[test]
fn a_grid_by_columns_clusters_as_compactly_as_by_rows() {
    for by_columns in [false, true] {
        let (positions, indices) = grid(64, by_columns);
        let built = spatial(&positions, &indices, CAPS);
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
            // An 8 × 8 patch of quads: the square 128 triangles make, whatever the index order.
            assert!(
                span(&mut xs.clone()) + span(&mut ys.clone()) <= 16,
                "a strip"
            );
            start = end;
        }
    }
}

/// A soup of 128-triangle clusters needs 384 vertices: the vertex cap cuts it first.
#[test]
fn a_soup_is_cut_by_its_vertices() {
    let (positions, indices) = soup(1000, 3);
    let built = spatial(&positions, &indices, CAPS);
    assert_partition(&indices, &built.indices, &built.ends);
    assert!(built.ends.len() >= 1000usize.div_ceil(85));
}

/// The ordered rule keeps the source order: its ranges tile the indices, and a grid listed by rows
/// cut into runs of at most 128 triangles.
#[test]
fn the_ordered_rule_tiles_the_source_order() {
    let (positions, indices) = grid(30, false);
    for compact in [None, Some(positions.as_slice())] {
        let ranges = ordered(&indices, positions.len() / 3, compact, CAPS);
        let ends: Vec<usize> = ranges.iter().map(|r| r[1]).collect();
        assert_eq!(ranges[0][0], 0);
        ranges.windows(2).for_each(|w| assert_eq!(w[0][1], w[1][0]));
        assert_partition(&indices, &indices, &ends);
    }
}
