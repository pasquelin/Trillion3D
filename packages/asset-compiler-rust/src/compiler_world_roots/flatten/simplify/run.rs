//! Tolerance, flips, an edge collapse, the loop, the clean-up and compaction.
use super::{segment_parameter, Mesh, Outcome, Refused, Simplifier, NONE, V3};
use trillion3d_math::triangle::facing;
use trillion3d_math::vecn::{add, distance2, scale};
use trillion3d_page_codec::encode::vertices::first_use;

impl Simplifier {
    /// Whether the collapse stays within the geometric tolerance: the new point, the new
    /// midpoints of the other edges and the new centroids of the triangles that stay, all within
    /// the tolerance of the target.
    fn within_tolerance(&self, keep: u32, remove: u32, p: V3, tc: u32, td: u32) -> bool {
        let Some(target) = &self.target else {
            return true;
        };
        if !target.within(p) {
            return false;
        }
        let collapsing = self.mesh.find_edge(keep, remove);
        for v in [keep, remove] {
            for &e in &self.mesh.vertex_edges[v as usize] {
                if Some(e) != collapsing {
                    let o = self.mesh.positions[self.mesh.other(e, v) as usize];
                    if !target.within(scale(add(o, p), 0.5)) {
                        return false;
                    }
                }
            }
        }
        for v in [keep, remove] {
            for t in self.mesh.vertex_triangles(v) {
                if t == tc || t == td {
                    continue;
                }
                let centroid = self.mesh.triangles[t as usize]
                    .iter()
                    .map(|&x| {
                        if x == keep || x == remove {
                            p
                        } else {
                            self.mesh.positions[x as usize]
                        }
                    })
                    .fold([0.0; 3], add);
                if !target.within(scale(centroid, 1.0 / 3.0)) {
                    return false;
                }
            }
        }
        true
    }

    /// Whether moving `v` to `p` turns any triangle about it over (its normal past 90°) or would
    /// join it to `other` twice.
    fn flips(&self, v: u32, other: u32, p: V3, tc: u32, td: u32) -> bool {
        for t in self.mesh.vertex_triangles(v) {
            if t == tc || t == td {
                continue;
            }
            let tri = self.mesh.triangles[t as usize];
            if tri.contains(&other) {
                return true;
            }
            let k = (0..2).find(|&k| tri[k] == v).unwrap_or(2);
            if facing(tri.map(|x| self.mesh.positions[x as usize]), k, p) <= 0.0 {
                return true;
            }
        }
        false
    }

    /// Edge `e` collapsed to `new`, unless out of tolerance, flipping or not manifold.
    fn collapse_edge(&mut self, e: u32, new: V3) -> Outcome {
        if !self.mesh.edge_alive[e as usize] {
            return Outcome::Ignored;
        }
        let ([a, b], [t0, t1]) = self.mesh.edges[e as usize];
        let mut collapse_to = NONE;
        if self.have_boundary {
            if self.boundary[b as usize] {
                collapse_to = b;
            } else if self.boundary[a as usize] {
                collapse_to = a;
            }
        }
        let (keep, remove) = if collapse_to == a { (a, b) } else { (b, a) };
        let (pkeep, premove) = (
            self.mesh.positions[keep as usize],
            self.mesh.positions[remove as usize],
        );
        let mut new = new;
        if !self.within_tolerance(keep, remove, new, t0, t1) {
            let t = segment_parameter(pkeep, premove, new);
            new = add(scale(pkeep, 1.0 - t), scale(premove, t));
            if !self.within_tolerance(keep, remove, new, t0, t1) {
                return Outcome::Ignored;
            }
        }
        if self.flips(a, b, new, t0, t1) || self.flips(b, a, new, t0, t1) {
            return Outcome::Ignored;
        }
        match self.mesh.collapse(keep, remove) {
            Ok(done) => {
                self.mesh.positions[keep as usize] = new;
                Outcome::Collapsed(keep, done.removed_tris, done.opposing)
            }
            Err(Refused::Triangle) => Outcome::IsolatedTriangle,
            Err(Refused::Other) => Outcome::Ignored,
        }
    }

    /// Collapses, least error first, down to `target` triangles.
    pub(super) fn simplify_to(&mut self, target: usize) {
        if self.mesh.triangle_count == 0 {
            return;
        }
        let target = target.max(1);
        // The live mesh alone carries on: the elements earlier passes removed hold no quadric.
        if self.mesh.triangles.len() > self.mesh.triangle_count {
            let (points, indices) = self.compact();
            self.mesh = Mesh::new(Vec::new(), &[]);
            self.mesh = Mesh::new(points, &indices);
        }
        self.precompute();
        self.initialize();
        while self.mesh.triangle_count > target {
            let Some(e) = self.queue.pop() else {
                break;
            };
            if !self.mesh.edge_alive[e as usize] {
                continue;
            }
            let point = self.collapse_points[e as usize];
            match self.collapse_edge(e, point) {
                Outcome::Collapsed(kept, removed, opposing) => {
                    self.update_neighborhood(kept, removed, opposing)
                }
                Outcome::IsolatedTriangle if self.mesh.triangle_count > 2 => {
                    let t = self.mesh.edges[e as usize].1[0];
                    self.remove_isolated(t);
                }
                _ => {}
            }
        }
    }

    /// Triangle `t` removed when no other triangle touches its vertices.
    fn remove_isolated(&mut self, t: u32) {
        if t == NONE || !self.mesh.triangle_alive[t as usize] {
            return;
        }
        let isolated = (self.mesh.triangles[t as usize].iter())
            .all(|&v| self.mesh.vertex_triangles(v).all(|x| x == t));
        if isolated {
            self.mesh.remove_triangle(t);
        }
    }

    /// Interior edges
    /// shorter than the length collapsed to their midpoints, round after round.
    pub(super) fn fast_collapse(
        &mut self,
        min_edge_length: f64,
        rounds: usize,
        min_triangles: usize,
    ) {
        if self.mesh.triangle_count <= min_triangles {
            return;
        }
        let min2 = min_edge_length * min_edge_length;
        self.precompute();
        let count = self.mesh.edges.len() as u32;
        for _ in 0..rounds {
            let mut collapsed = 0usize;
            for e in 0..count {
                if !self.mesh.edge_alive[e as usize] || self.mesh.boundary_edge(e) {
                    continue;
                }
                if self.mesh.triangle_count <= min_triangles {
                    break;
                }
                let [a, b] = self.mesh.edges[e as usize].0;
                let (pa, pb) = (
                    self.mesh.positions[a as usize],
                    self.mesh.positions[b as usize],
                );
                if distance2(pa, pb) > min2 {
                    continue;
                }
                if let Outcome::Collapsed(..) = self.collapse_edge(e, scale(add(pa, pb), 0.5)) {
                    collapsed += 1;
                }
            }
            if collapsed == 0 || self.mesh.triangle_count <= min_triangles {
                break;
            }
        }
    }

    /// The live triangles over the live vertices.
    pub(super) fn compact(&self) -> (Vec<V3>, Vec<u32>) {
        let live: Vec<u32> = (self.mesh.triangles.iter().enumerate())
            .filter(|&(t, _)| self.mesh.triangle_alive[t])
            .flat_map(|(_, tri)| *tri)
            .collect();
        let (used, indices) = first_use(live.into_iter());
        let points = used
            .iter()
            .map(|&v| self.mesh.positions[v as usize])
            .collect();
        (points, indices)
    }
}
