//! The border of a group's simplification: its children's external edges (`clusters.rs`) less
//! those another of its children runs, the positions their ends lock, and the count each takes
//! back when a solve leaves it end to end as it was.
use trillion3d_math::geometry::triangle::next_corner;
use trillion3d_page_codec::clusters::{Linking, Links};
use trillion3d_page_codec::hash::{word_map, WordMap};

/// The bits of the positions of the edge from vertex `a` to vertex `b` of `positions`, as they
/// are: an edge a solve keeps keeps them.
fn edge_key(positions: &[f32], a: u32, b: u32) -> [u32; 6] {
    let (a, b) = (a as usize * 3, b as usize * 3);
    [a, a + 1, a + 2, b, b + 1, b + 2].map(|at| positions[at].to_bits())
}

/// A group's border: per corner of the group, its external edges once its own children's are
/// taken away (`outer`), which a solve that leaves the group as it was keeps; the canonical
/// vertices their ends lie at, locked; and each such edge with its count, the last corner's of
/// equal edges, which a solve's edges take back (`kept`).
pub(super) struct Border {
    pub outer: Vec<u8>,
    locked: Vec<u32>,
    edges: WordMap<[u32; 6], u8>,
}

impl Border {
    /// The border of the group whose `corners` — its children's triangles, one child after the
    /// other, `outer` each child's counts — lie over the level's `positions`, `weld` its canonical
    /// vertex per position. A corner keeps its child's count less every link of its edge, among
    /// the group's edges linked as a re-split links them (`Linking::Resplit`), to an edge of
    /// another child, never under zero.
    pub fn of(positions: &[f32], weld: &[u32], corners: &[u32], outer: &[&[u8]]) -> Self {
        let at = |e: usize| weld[corners[e] as usize];
        let links = Links::of_ends(
            corners.len(),
            |e| (at(e), at(next_corner(e))),
            Linking::Resplit,
        );
        let mut counts = Vec::with_capacity(corners.len());
        let mut low = 0;
        for child in outer {
            let own = low..low + child.len();
            for (e, &count) in own.clone().zip(child.iter()) {
                let mut left = i32::from(count);
                links.each(e, |o| left -= i32::from(!own.contains(&(o as usize))));
                counts.push(left.max(0) as u8);
            }
            low = own.end;
        }
        let mut locked = Vec::new();
        let mut edges = word_map(0);
        for (e, &count) in counts.iter().enumerate().filter(|&(_, &count)| count != 0) {
            let (a, b) = (corners[e], corners[next_corner(e)]);
            locked.extend([weld[a as usize], weld[b as usize]]);
            edges.insert(edge_key(positions, a, b), count);
        }
        locked.sort_unstable();
        locked.dedup();
        Self {
            outer: counts,
            locked,
            edges,
        }
    }

    /// Whether the group's simplification locks the position whose canonical vertex is
    /// `canonical`: an end of one of its external edges lies there.
    pub fn locks(&self, canonical: u32) -> bool {
        self.locked.binary_search(&canonical).is_ok()
    }

    /// The external edges of a solve's triangles `indices` over `positions`: an edge still one of
    /// the border's, end to end, takes its count back; any other counts none.
    pub fn kept(&self, positions: &[f32], indices: &[u32]) -> Vec<u8> {
        (0..indices.len())
            .map(|e| {
                let key = edge_key(positions, indices[e], indices[next_corner(e)]);
                self.edges.get(&key).copied().unwrap_or(0)
            })
            .collect()
    }
}
