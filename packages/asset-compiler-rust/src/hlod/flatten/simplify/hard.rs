//! The simplified mesh's vertices split at hard edges (`split_hard`): an edge between exactly two
//! faces whose normals turn by the layer's hard angle or more is hard, and each of its two vertices
//! — unless one of the vertex's edges lies on fewer or more than two faces — is split into one copy
//! per run of its faces joined across soft edges; a vertex with a single such run is cut along its
//! sharpest soft edge instead. The first run keeps the vertex, each other run's faces are rewired
//! to a copy appended after every vertex, in the order the vertices and their runs are met.
use super::convert::clockwise_normal;
use super::proxy::Proxy;
use std::collections::BTreeMap;
use trillion3d_math::vector::vecn::dot;

/// Lists of indices laid end to end: list `i` is `items[starts[i]..starts[i + 1]]`.
struct Rows {
    starts: Vec<usize>,
    items: Vec<usize>,
}

impl Rows {
    /// `rows` lists from the `(list, item)` pairs `pairs`, each list holding its items in the
    /// order the pairs give them.
    fn of(rows: usize, pairs: &[(usize, usize)]) -> Self {
        let mut starts = vec![0; rows + 1];
        for &(row, _) in pairs {
            starts[row + 1] += 1;
        }
        for row in 0..rows {
            starts[row + 1] += starts[row];
        }
        let mut next = starts.clone();
        let mut items = vec![0; pairs.len()];
        for &(row, item) in pairs {
            items[next[row]] = item;
            next[row] += 1;
        }
        Self { starts, items }
    }

    /// List `i`.
    fn row(&self, i: usize) -> &[usize] {
        &self.items[self.starts[i]..self.starts[i + 1]]
    }
}

/// The mesh's edges and faces about each vertex: each vertex's faces, one entry per corner it
/// takes, in face order; each edge, its two vertices lower first, in that order; each edge's faces
/// in face order; and each vertex's edges in edge order.
struct Adjacency {
    vertex_faces: Rows,
    edges: Vec<[u32; 2]>,
    edge_faces: Rows,
    vertex_edges: Rows,
}

impl Adjacency {
    fn of(indices: &[u32], vertices: usize) -> Self {
        let mut corners: Vec<(usize, usize)> = Vec::with_capacity(indices.len());
        let mut sides: Vec<([u32; 2], usize)> = Vec::with_capacity(indices.len());
        for (f, t) in indices.chunks_exact(3).enumerate() {
            for v in 0..3 {
                corners.push((t[v] as usize, f));
                let (a, b) = (t[v], t[(v + 1) % 3]);
                sides.push(([a.min(b), a.max(b)], f));
            }
        }
        // By edge, then face: the faces of an edge in face order, as each face names it in turn.
        sides.sort_unstable();
        let mut edges: Vec<[u32; 2]> = Vec::new();
        let mut named: Vec<(usize, usize)> = Vec::with_capacity(sides.len());
        for &(edge, f) in &sides {
            if edges.last() != Some(&edge) {
                edges.push(edge);
            }
            named.push((edges.len() - 1, f));
        }
        let ends: Vec<(usize, usize)> = (edges.iter().enumerate())
            .flat_map(|(e, edge)| edge.iter().map(move |&v| (v as usize, e)))
            .collect();
        Self {
            vertex_faces: Rows::of(vertices, &corners),
            edge_faces: Rows::of(edges.len(), &named),
            vertex_edges: Rows::of(vertices, &ends),
            edges,
        }
    }
}

/// A face's place in the chain of faces about a split vertex: itself, the next and the last, the
/// face's own id where it has none; a face already grouped holds `None`.
#[derive(Clone, Copy)]
struct Link {
    face: Option<usize>,
    next: usize,
    last: usize,
}

/// The ordered pair of an edge's two faces, lower first.
fn ordered(faces: &[usize]) -> (usize, usize) {
    (faces[0].min(faces[1]), faces[0].max(faces[1]))
}

/// The runs of faces about vertex `v` (module doc).
fn runs(adjacency: &Adjacency, angles: &[f32], v: usize, hard: f32) -> Vec<Vec<usize>> {
    let faces = adjacency.vertex_faces.row(v);
    let mut links: Vec<Link> = (faces.iter())
        .map(|&f| Link {
            face: Some(f),
            next: f,
            last: f,
        })
        .collect();
    // A face's link: the last listed for it, as a map by face keeps the last.
    let mut of_face: BTreeMap<usize, usize> = BTreeMap::new();
    faces.iter().enumerate().for_each(|(at, &f)| {
        of_face.insert(f, at);
    });
    let mut sharpest = (-1.0f32, None);
    for &e in adjacency.vertex_edges.row(v) {
        if angles[e] < hard {
            if angles[e] > sharpest.0 {
                sharpest = (angles[e], Some(e));
            }
            let (a, b) = ordered(adjacency.edge_faces.row(e));
            links[of_face[&a]].next = b;
            links[of_face[&b]].last = a;
        }
    }
    let mut count = links.iter().filter(|l| l.face == Some(l.last)).count();
    if let (1, (_, Some(e))) = (count, sharpest) {
        let (a, b) = ordered(adjacency.edge_faces.row(e));
        links[of_face[&a]].next = a;
        links[of_face[&b]].last = b;
        count += 1;
    }
    if count <= 1 {
        return vec![links.iter().filter_map(|l| l.face).collect()];
    }
    let mut groups = Vec::new();
    for at in 0..links.len() {
        let Some(face) = links[at].face else { continue };
        let mut group = vec![face];
        for forward in [true, false] {
            // The link's own face as it stands now: a walk that came back to it let it go.
            let own = links[at].face;
            let start = if forward {
                links[at].next
            } else {
                links[at].last
            };
            if own == Some(start) {
                continue;
            }
            let (mut toward, mut current) = (start, own);
            while current.is_some_and(|c| c != toward) {
                let link = &mut links[of_face[&toward]];
                current = link.face;
                toward = if forward { link.next } else { link.last };
                if let Some(c) = current {
                    group.push(c);
                }
                link.face = None;
            }
        }
        links[at].face = None;
        groups.push(group);
    }
    groups
}

/// `proxy`'s vertices split at the edges turning by `degrees` or more (module doc); nothing on a
/// mesh of fewer than two triangles.
pub(super) fn split_hard(proxy: &mut Proxy, degrees: f32) {
    let hard = degrees.to_radians().abs();
    let faces = proxy.indices.len() / 3;
    if faces < 2 {
        return;
    }
    let normals: Vec<[f32; 3]> = (0..faces)
        .map(|t| clockwise_normal(proxy.corners(t)))
        .collect();
    let vertices = proxy.points.len();
    let adjacency = Adjacency::of(&proxy.indices, vertices);
    let two = |e: usize| adjacency.edge_faces.row(e).len() == 2;
    let angles: Vec<f32> = (0..adjacency.edges.len())
        .map(|e| match two(e) {
            true => {
                let [a, b] = [0, 1].map(|k| normals[adjacency.edge_faces.row(e)[k]]);
                dot(a, b).clamp(-1.0, 1.0).acos()
            }
            false => 0.0,
        })
        .collect();
    let mut marked = vec![false; vertices];
    for e in (0..adjacency.edges.len()).filter(|&e| two(e) && angles[e] >= hard) {
        adjacency.edges[e]
            .iter()
            .for_each(|&v| marked[v as usize] = true);
    }
    let split: Vec<usize> = (0..vertices)
        .filter(|&v| marked[v] && adjacency.vertex_edges.row(v).iter().all(|&e| two(e)))
        .collect();
    let mut copies: Vec<u32> = Vec::new();
    for &v in &split {
        for group in runs(&adjacency, &angles, v, hard).iter().skip(1) {
            let copy = (vertices + copies.len()) as u32;
            for &f in group {
                for corner in &mut proxy.indices[3 * f..3 * f + 3] {
                    if *corner as usize == v {
                        *corner = copy;
                    }
                }
            }
            copies.push(v as u32);
        }
    }
    proxy.split(&copies);
}
