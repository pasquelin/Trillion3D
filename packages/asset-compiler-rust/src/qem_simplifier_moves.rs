//! A collapse made: every vertex at its two positions moved to the merged one, the lists and
//! pairs brought up to date, the pairs around sent back to be weighed again, the gathered
//! triangles fixed up, and the ghosts told (`ghosts.rs`).
use super::super::quadric;
use super::ghosts::Ghosts;
use super::live::Surface;
use super::merge::Scratch;
use super::{Simplifier, ADJ_TRI, LOCKED, MERGE_MASK, P};

impl Simplifier {
    /// Makes the merge: every vertex of the gathered triangles at `ends` moves to `p` with its
    /// wedge's attributes, its corners locked if either end was; the lists and pairs follow, the
    /// pairs around leave the queue to be weighed again, and the gathered triangles are fixed up,
    /// their edges' quadrics computed afresh; the ghosts follow (`ghosts.rs`).
    pub(super) fn move_to(&mut self, s: &Scratch, (ends, p): ([P; 2], P), lock: bool) {
        let (m, size) = (self.m, quadric::size(self.m));
        self.begin_move(ends[0]);
        self.begin_move(ends[1]);
        for (adj, &tri) in s.adj_tris.iter().enumerate() {
            let w = s.wedge_of[adj];
            let solved = s.wedge_quadrics[w * size + quadric::AREA] > 1e-8;
            for k in 0..3 {
                let corner = tri * 3 + k;
                let vert = self.indexes[corner] as usize;
                let at = vert * (3 + m);
                let old = [self.verts[at], self.verts[at + 1], self.verts[at + 2]];
                if old == ends[0] || old == ends[1] {
                    self.verts[at..at + 3].copy_from_slice(&p);
                    if solved {
                        let values = &s.wedge_values[w * m..(w + 1) * m];
                        self.verts[at + 3..at + 3 + m].copy_from_slice(values);
                    }
                    if lock {
                        self.corner_flags[corner] |= LOCKED;
                    }
                }
            }
        }
        for i in 0..self.moved_pairs.len() {
            let pair = &mut self.pairs[self.moved_pairs[i] as usize];
            for end in pair.iter_mut() {
                if *end == ends[0] || *end == ends[1] {
                    *end = p;
                }
            }
        }
        self.end_moves();
        let (mut verts, mut found) = (
            std::mem::take(&mut self.near_verts),
            std::mem::take(&mut self.near_pairs),
        );
        verts.clear();
        for &tri in &s.adj_tris {
            for k in 0..3 {
                let vert = self.indexes[tri * 3 + k];
                if !verts.contains(&vert) {
                    verts.push(vert);
                }
            }
        }
        for &vert in &verts {
            found.clear();
            self.for_pairs_at(self.position(vert), |pair| found.push(pair));
            for &pair in &found {
                if self.heap.is_present(pair) {
                    self.heap.remove(pair);
                    self.reevaluate.push(pair);
                }
            }
        }
        (self.near_verts, self.near_pairs) = (verts, found);
        for &tri in &s.adj_tris {
            self.fix_up_tri(tri);
        }
        for &tri in &s.adj_tris {
            for k in 0..3 {
                self.calc_edge_quadric(tri * 3 + k);
            }
        }
        let (ghosts, live) = self.ghosts_and_surface();
        ghosts.moved(&live, &s.adj_tris);
    }

    /// The ghosts, and the live surface they are measured against.
    pub(super) fn ghosts_and_surface(&mut self) -> (&mut Ghosts, Surface<'_>) {
        let live = Surface {
            verts: &self.verts,
            m: self.m,
            indexes: &self.indexes,
            tri_removed: &self.tri_removed,
            flags: &self.corner_flags,
        };
        (&mut self.ghosts, live)
    }

    /// Clears the merge and gathered flags of the gathered triangles' corners.
    pub(super) fn clear_flags(&mut self, adj_tris: &[usize]) {
        for &tri in adj_tris {
            for k in 0..3 {
                self.corner_flags[tri * 3 + k] &= !(MERGE_MASK | ADJ_TRI);
            }
        }
    }

    /// Takes every vertex, corner and pair at `p` off its lists, to be listed again once moved.
    fn begin_move(&mut self, p: P) {
        self.moved_verts
            .extend(self.vert_hash.take(p).into_iter().rev());
        self.moved_corners
            .extend(self.corner_hash.take(p).into_iter().rev());
        for pair in self.pair_hash0.take(p).into_iter().rev() {
            self.pair_hash1.remove(self.pairs[pair as usize][1], pair);
            self.moved_pairs.push(pair);
        }
        for pair in self.pair_hash1.take(p).into_iter().rev() {
            self.pair_hash0.remove(self.pairs[pair as usize][0], pair);
            self.moved_pairs.push(pair);
        }
    }

    /// Lists the moved vertices, corners and pairs again at their new positions; a pair whose two
    /// ends met, or that repeats another, leaves the queue.
    fn end_moves(&mut self) {
        for i in 0..self.moved_verts.len() {
            let vert = self.moved_verts[i];
            let p = self.position(vert);
            self.vert_hash.add(p, vert);
        }
        for i in 0..self.moved_corners.len() {
            let corner = self.moved_corners[i];
            let p = self.position(self.indexes[corner as usize]);
            self.corner_hash.add(p, corner);
        }
        for i in 0..self.moved_pairs.len() {
            let pair = self.moved_pairs[i];
            let mut ends = self.pairs[pair as usize];
            let kept = ends[0] != ends[1] && self.add_unique_pair(&mut ends, pair);
            self.pairs[pair as usize] = ends;
            if !kept {
                self.heap.remove(pair);
            }
        }
        self.moved_verts.clear();
        self.moved_corners.clear();
        self.moved_pairs.clear();
    }
}
