//! Distances from a set of sources to every vertex of a chart.
//!
//! Each source's distances come from a search along edges, greatest negated distance first,
//! where reaching a vertex across an edge also tries the straight path through each settled
//! vertex opposite that edge (the triangle's unfolding), with the signal distance carried along
//! the edges' signal lengths. On meshes under 25 000 faces (or always, for the quality setting),
//! without a signal, the window propagation's surface distance then replaces each distance it
//! undercuts. With a signal the signal distances are blended in (`landmarks`). Last, each pair of
//! sources gets the lesser of its two distances, both ways.
//!
//! The sources' searches read the chart and write nothing of it: each runs on its own thread, on
//! its own copy of the propagation, and its distances are laid in the sources' order.
use crate::hlod::flatten::uv::spectral::geodesic::Windows;
use crate::hlod::flatten::uv::spectral::mesh::{Chart, Edge, Vert, NONE};
use crate::hlod::flatten::uv::spectral::util::{near_zero, root, ZERO};
use crate::hlod::flatten::uv::spectral::ChartQuality;
use rayon::prelude::*;
use trillion3d_math::heap::{Greatest, IndexedHeap};
use trillion3d_math::vector::vec3::cross;
use trillion3d_math::vector::vecn::{dot, length, sub};

/// Below this many faces the default setting measures exact surface distances.
const EXACT_FACE_LIMIT: usize = 25000;

/// The chart as a source's search reads it: its vertices' rings, its edges and its points.
struct Search<'c> {
    verts: &'c [Vert],
    edges: &'c [Edge],
    points: Vec<[f32; 3]>,
}

/// One source's distances to every vertex: along the surface, and weighed by the signal.
struct Distances {
    geodesic: Vec<f32>,
    signal: Vec<f32>,
}

impl<'a> Chart<'a> {
    /// Whether the window propagation refines the distances.
    fn exact_distances(&self) -> bool {
        let quality = self.source.quality;
        let wanted = (quality == ChartQuality::ByFaceCount
            && self.source.face_count < EXACT_FACE_LIMIT)
            || quality == ChartQuality::Quality;
        wanted && !self.has_signal() && !self.verts.is_empty() && !self.faces.is_empty()
    }

    /// The distances from each of `sources` to every vertex, one row per source: the signal-blended
    /// ones in `combined` when a signal is given and `combined` is asked, the geodesic ones in
    /// `geodesic` when asked.
    pub(crate) fn distances_from(
        &mut self,
        sources: &[u32],
        mut combined: Option<&mut [f32]>,
        geodesic: Option<&mut [f32]>,
    ) {
        if sources.is_empty() {
            return;
        }
        let count = self.verts.len();
        let signal = self.has_signal();
        let template = self.exact_distances().then(|| Windows::from_chart(self));
        let rows: Vec<Distances> = {
            let search = Search {
                verts: &self.verts,
                edges: &self.edges,
                points: (0..count as u32).map(|v| self.point(v)).collect(),
            };
            sources
                .par_iter()
                .map(|&s| search.distances(s, signal, template.as_ref()))
                .collect()
        };
        let asked_geodesic = geodesic.is_some();
        let mut own: Vec<f32>;
        let geodesic = match geodesic {
            Some(g) => g,
            None => {
                own = vec![0f32; sources.len() * count];
                &mut own[..]
            }
        };
        let use_combined = signal && combined.is_some();
        for (i, row) in rows.iter().enumerate() {
            if use_combined {
                let combined = combined.as_deref_mut().expect("combined distances");
                combined[i * count..(i + 1) * count].copy_from_slice(&row.signal);
            }
            geodesic[i * count..(i + 1) * count].copy_from_slice(&row.geodesic);
        }
        if let (true, Some(c)) = (use_combined, combined.as_deref_mut()) {
            self.blend_signal(
                &mut c[..sources.len() * count],
                &geodesic[..sources.len() * count],
            );
        }
        for i in 0..sources.len() {
            for j in i..sources.len() {
                let (one, two) = (
                    i * count + sources[j] as usize,
                    j * count + sources[i] as usize,
                );
                if let (true, Some(c)) = (use_combined, combined.as_deref_mut()) {
                    let least = if c[two] < c[one] { c[two] } else { c[one] };
                    c[one] = least;
                    c[two] = least;
                }
                if asked_geodesic {
                    let least = if geodesic[two] < geodesic[one] {
                        geodesic[two]
                    } else {
                        geodesic[one]
                    };
                    geodesic[one] = least;
                    geodesic[two] = least;
                }
            }
        }
    }
}

impl Search<'_> {
    /// Every vertex's distance from `source`: the edge search, then, with `template`, a copy of
    /// the window propagation run from `source`, each distance it undercuts replaced.
    fn distances(&self, source: u32, signal: bool, template: Option<&Windows>) -> Distances {
        let mut found = self.edge_distances(source, signal);
        if let Some(template) = template {
            let mut windows = template.clone();
            windows.run(source);
            for (i, d) in found.geodesic.iter_mut().enumerate() {
                let exact = windows.distance(i) as f32;
                if exact < *d {
                    *d = exact;
                }
            }
            found.signal.copy_from_slice(&found.geodesic);
        }
        found
    }

    /// The edge search with triangle unfolding from `source`.
    fn edge_distances(&self, source: u32, signal: bool) -> Distances {
        let count = self.verts.len();
        let mut settled = vec![false; count];
        let mut heap = IndexedHeap::<Greatest>::new(count);
        let mut found = Distances {
            geodesic: vec![f32::MAX; count],
            signal: vec![f32::MAX; count],
        };
        settled[source as usize] = true;
        found.geodesic[source as usize] = 0.0;
        found.signal[source as usize] = 0.0;
        heap.insert(source, 0.0);
        for _ in 0..count {
            let Some(v) = heap.pop() else {
                break;
            };
            settled[v as usize] = true;
            for &e in &self.verts[v as usize].edges {
                let edge = self.edges[e as usize];
                let other = edge.other_end(v);
                if !settled[other as usize] {
                    self.relax(&mut found, (v, other, e), &settled, signal);
                }
            }
            for &n in &self.verts[v as usize].verts {
                if settled[n as usize] {
                    continue;
                }
                let key = -found.geodesic[n as usize];
                if heap.contains(n) {
                    heap.update(n, key);
                } else {
                    heap.insert(n, key);
                }
            }
        }
        found
    }

    /// `next`'s distance lowered through edge `e` from `here`, then through each settled vertex
    /// opposite the edge.
    fn relax(
        &self,
        found: &mut Distances,
        (here, next, e): (u32, u32, u32),
        settled: &[bool],
        signal: bool,
    ) {
        let edge = self.edges[e as usize];
        let through = found.geodesic[here as usize] + edge.length;
        if found.geodesic[next as usize] > through {
            found.geodesic[next as usize] = through;
            if signal {
                found.signal[next as usize] = found.signal[here as usize] + edge.signal_length;
            }
        }
        for &opposite in &edge.opposite {
            if opposite == NONE {
                break;
            }
            if !settled[opposite as usize] {
                continue;
            }
            if found.geodesic[opposite as usize] > found.geodesic[here as usize] {
                self.unfold(found, here, opposite, next);
            } else {
                self.unfold(found, opposite, here, next);
            }
        }
    }

    /// `c`'s distance lowered by the straight path across triangle `a b c` from the front through
    /// `a` and `b`, when that path crosses the edge `a b` inside the triangle.
    fn unfold(&self, found: &mut Distances, a: u32, b: u32, c: u32) {
        let u = found.geodesic[b as usize] - found.geodesic[a as usize];
        let v0 = sub(self.points[b as usize], self.points[c as usize]);
        let v1 = sub(self.points[a as usize], self.points[c as usize]);
        let (la, lb) = (length(v0), length(v1));
        let product = la * lb;
        if near_zero(product) {
            return;
        }
        let cos = dot(v0, v1) / product;
        let sin = length(cross(v0, v1)) / product;
        let qa = la * la + lb * lb - 2.0 * la * lb * cos;
        let qb = 2.0 * lb * u * (la * cos - lb);
        let qc = lb * lb * (u * u - la * la * sin * sin);
        let mut t = qb * qb - 4.0 * qa * qc;
        if t < 0.0 || near_zero(qa) {
            return;
        }
        t = (root(t) - qb) / (2.0 * qa);
        if t < u || near_zero(t) {
            return;
        }
        let along = lb * (t - u) / t;
        if (cos > ZERO && along > la / cos) || along < la * cos {
            return;
        }
        let through = found.geodesic[a as usize] + t;
        if found.geodesic[c as usize] > through {
            found.geodesic[c as usize] = through;
        }
    }
}
