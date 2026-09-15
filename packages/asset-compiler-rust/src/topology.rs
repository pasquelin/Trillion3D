pub(crate) mod link;
use crate::{invalid, Result};
use link::{classify_link, LinkScratch};
#[derive(Debug, Clone, PartialEq)]
pub struct TopologyReport {
    pub triangles: usize,
    pub boundary_edges: usize,
    pub manifold_edges: usize,
    pub non_manifold_edges: usize,
    pub interior_vertices: usize,
    pub boundary_vertices: usize,
    pub locked_vertices: usize,
    pub unused_vertices: usize,
    pub manifold: bool,
}
fn edge_key(a: u32, b: u32) -> (u32, u32) {
    if a < b {
        (a, b)
    } else {
        (b, a)
    }
}
/// Edge and vertex classification of a triangle soup. The cluster DAG builds its own cluster
/// graph, so no triangle adjacency is derived here.
pub fn classify_topology(indices: &[u32], vertex_count: usize) -> Result<TopologyReport> {
    if !indices.len().is_multiple_of(3) || indices.is_empty() {
        return Err(invalid("Index count must be a positive multiple of three"));
    }
    let triangle_count = indices.len() / 3;
    let mut halves = Vec::with_capacity(triangle_count * 3);
    let mut incident = vec![0u32; vertex_count];
    let mut link_count = vec![0u32; vertex_count];
    for face in 0..triangle_count {
        let tri = [
            indices[face * 3],
            indices[face * 3 + 1],
            indices[face * 3 + 2],
        ];
        for vertex in tri {
            if vertex as usize >= vertex_count {
                return Err(invalid("Invalid index"));
            }
        }
        for e in 0..3 {
            let start = tri[e];
            let end = tri[(e + 1) % 3];
            let key = edge_key(start, end);
            halves.push((key.0, key.1, start, end, face));
            incident[start as usize] += 1;
            if start != end {
                link_count[start as usize] += 1;
            }
        }
    }
    // Compressed links: one flat array with a per-vertex offset, instead of a vector per vertex.
    let mut offsets = vec![0u32; vertex_count + 1];
    for vertex in 0..vertex_count {
        offsets[vertex + 1] = offsets[vertex] + link_count[vertex];
    }
    let mut cursor = offsets.clone();
    let mut links = vec![(0u32, 0u32); offsets[vertex_count] as usize];
    for face in 0..triangle_count {
        let tri = [
            indices[face * 3],
            indices[face * 3 + 1],
            indices[face * 3 + 2],
        ];
        for e in 0..3 {
            let start = tri[e];
            let end = tri[(e + 1) % 3];
            let other = tri[(e + 2) % 3];
            if start == end {
                continue;
            }
            let at = &mut cursor[start as usize];
            links[*at as usize] = (end, other);
            *at += 1;
        }
    }
    halves.sort_unstable_by(|left, right| {
        left.0
            .cmp(&right.0)
            .then(left.1.cmp(&right.1))
            .then(left.4.cmp(&right.4))
    });
    let mut boundary = 0;
    let mut manifold = 0;
    let mut non_manifold = 0;
    let mut cursor = 0usize;
    while cursor < halves.len() {
        let mut end = cursor + 1;
        while end < halves.len()
            && halves[end].0 == halves[cursor].0
            && halves[end].1 == halves[cursor].1
        {
            end += 1;
        }
        let n = end - cursor;
        if n == 1 {
            boundary += 1;
        } else if n == 2
            && halves[cursor].2 == halves[cursor + 1].3
            && halves[cursor].3 == halves[cursor + 1].2
        {
            manifold += 1;
        } else {
            non_manifold += 1;
        }
        cursor = end;
    }
    let mut interior = 0;
    let mut boundary_vertices = 0;
    let mut locked = 0;
    let mut unused = 0;
    let mut scratch = LinkScratch::default();
    for vertex in 0..vertex_count {
        if incident[vertex] == 0 {
            unused += 1;
            continue;
        }
        let span = offsets[vertex] as usize..offsets[vertex + 1] as usize;
        match classify_link(&links[span], &mut scratch) {
            "interior" => interior += 1,
            "boundary" => boundary_vertices += 1,
            _ => locked += 1,
        }
    }
    Ok(TopologyReport {
        triangles: triangle_count,
        boundary_edges: boundary,
        manifold_edges: manifold,
        non_manifold_edges: non_manifold,
        interior_vertices: interior,
        boundary_vertices,
        locked_vertices: locked,
        unused_vertices: unused,
        manifold: non_manifold == 0 && locked == 0,
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn triangle_is_boundary_manifold() {
        let report = classify_topology(&[0, 1, 2], 3).expect("topology");
        assert_eq!(report.boundary_edges, 3);
        assert_eq!(report.manifold_edges, 0);
        assert_eq!(report.boundary_vertices, 3);
        assert!(report.manifold);
    }
    #[test]
    fn tetrahedron_is_closed_manifold() {
        let report = classify_topology(&[0, 1, 2, 0, 3, 1, 1, 3, 2, 0, 2, 3], 4).expect("topology");
        assert_eq!(report.boundary_edges, 0);
        assert_eq!(report.manifold_edges, 6);
        assert_eq!(report.interior_vertices, 4);
        assert!(report.manifold);
    }
    #[test]
    fn three_triangles_on_one_edge_are_non_manifold() {
        let report = classify_topology(&[0, 1, 2, 0, 1, 3, 0, 1, 4], 5).expect("topology");
        assert_eq!(report.non_manifold_edges, 1);
        assert!(!report.manifold);
        assert!(report.locked_vertices >= 2);
    }
}
