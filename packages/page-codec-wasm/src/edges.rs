//! THE WELD AND THE DIRECTED EDGES of a triangle list, one for the clusterer (`clusters.rs`) and
//! the compiler's DAG (`asset-compiler-rust/src/dag/clusters.rs`): vertices made one by their
//! position, and the edges between two positions, each found with those running it back.
use trillion3d_math::scalar::normalized_bits;

/// The position of vertex `id` as bits, `-0` written as `+0`: equal coordinates, equal keys.
pub fn position_key(positions: &[f32], id: u32) -> [u32; 3] {
    let i = id as usize * 3;
    [i, i + 1, i + 2].map(|at| normalized_bits(positions[at]))
}

/// The rank of the first corner of `indices` naming each of `count` vertices, `u32::MAX` for a
/// vertex never named.
pub fn first_uses(count: usize, indices: &[u32]) -> Vec<u32> {
    let mut first = vec![u32::MAX; count];
    for (rank, &id) in indices.iter().enumerate() {
        if let Some(slot) = first.get_mut(id as usize).filter(|r| **r == u32::MAX) {
            *slot = rank as u32;
        }
    }
    first
}

/// The canonical vertex of each of `count` vertices, from the named ones as (key, first use,
/// vertex) sorted: each run of one key goes to its first, the vertex of earliest first use; a
/// vertex not listed stays its own.
pub fn canonical<K: Eq>(count: usize, sorted: &[(K, u32, u32)]) -> Vec<u32> {
    let mut canonical: Vec<u32> = (0..count as u32).collect();
    for run in sorted.chunk_by(|x, y| x.0 == y.0) {
        let head = run[0].2;
        run.iter()
            .for_each(|&(_, _, v)| canonical[v as usize] = head);
    }
    canonical
}

/// Canonical vertex per `key` (`canonical`): each vertex `indices` names takes the first in
/// their order with its key; one the list never names stays its own.
pub fn weld_by<K: Ord>(count: usize, indices: &[u32], key: impl Fn(u32) -> K) -> Vec<u32> {
    let first = first_uses(count, indices);
    let mut named: Vec<(K, u32, u32)> = (0..count as u32)
        .filter(|&v| first[v as usize] != u32::MAX)
        .map(|v| (key(v), first[v as usize], v))
        .collect();
    named.sort_unstable();
    canonical(count, &named)
}

/// Directed edges, each from one position to another with a tag (an edge, a cluster, a group),
/// sorted, in runs of one (from, to), each run with the run that goes the other way.
pub struct DirectedEdges {
    /// (from, to, tag), sorted.
    pub edges: Vec<(u32, u32, u32)>,
    /// Where each run starts, then where the last ends.
    starts: Vec<usize>,
    /// Per run, the run going the other way, `u32::MAX` for none.
    back: Vec<u32>,
}

impl DirectedEdges {
    /// The runs of `edges`, which `sort` puts in increasing order (a pool may sort them).
    pub fn of(mut edges: Vec<(u32, u32, u32)>, sort: impl FnOnce(&mut [(u32, u32, u32)])) -> Self {
        sort(&mut edges);
        let mut starts: Vec<usize> = Vec::new();
        for (at, e) in edges.iter().enumerate() {
            if at == 0 || (edges[at - 1].0, edges[at - 1].1) != (e.0, e.1) {
                starts.push(at);
            }
        }
        starts.push(edges.len());
        let keys: Vec<(u32, u32)> = starts[..starts.len() - 1]
            .iter()
            .map(|&at| (edges[at].0, edges[at].1))
            .collect();
        let back = (keys.iter())
            .map(|&(from, to)| {
                keys.binary_search(&(to, from))
                    .map_or(u32::MAX, |r| r as u32)
            })
            .collect();
        Self {
            edges,
            starts,
            back,
        }
    }

    pub fn runs(&self) -> usize {
        self.starts.len() - 1
    }

    /// The edges of run `run`.
    pub fn run(&self, run: usize) -> &[(u32, u32, u32)] {
        &self.edges[self.starts[run]..self.starts[run + 1]]
    }

    /// The run going the other way from run `run`.
    pub fn back(&self, run: usize) -> Option<usize> {
        let back = self.back[run];
        (back != u32::MAX).then_some(back as usize)
    }
}
