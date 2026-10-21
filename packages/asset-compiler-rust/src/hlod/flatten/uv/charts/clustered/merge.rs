//! Neighbouring charts merged until none merges: the charts are visited from the last, and for
//! each its neighbours from the last; a merge restarts the visit.
//!
//! A chart's boundary is measured per neighbour: the length it shares (`shared`, a normal seam
//! counted as outer boundary instead), the length it shares seams included, and the edges it
//! shares seams included; the rest is its outer boundary. A neighbour whose normal is within 60
//! degrees of the chart's (a dot product of at least `MERGE_MIN_NORMAL_DOT`) and that shares some
//! length merges into the chart when it is one face of at most a tenth of the chart's area (the
//! chart more than one face), two faces bordered by at least two shared edges, wholly inside the
//! chart (its boundary `near` the length shared), or when the length shared is more than a fifth of
//! the chart's inner boundary or three quarters of the neighbour's boundary. The merged chart must
//! fit a plane and project validly (on the chart's frame before the merge); it then takes the
//! fitted frame, both charts' refused regions, their summed area, and their boundaries less the
//! length shared seams included.
use super::super::mesh::NONE;
use super::super::vector::{most, near, negate, EPSILON};
use super::{Cluster, Growth};
use trillion3d_math::vector::vecn::dot;

/// The least dot product of two charts' normals for them to merge.
const MERGE_MIN_NORMAL_DOT: f32 = 0.5;

impl Growth<'_> {
    /// The charts merged, those left in order.
    pub(super) fn merge_neighbours(&mut self, charts: Vec<Cluster>) -> Vec<Cluster> {
        let surface = self.surface;
        let mut charts: Vec<Option<Cluster>> = charts.into_iter().map(Some).collect();
        let count = charts.len();
        let mut shared = vec![0.0f32; count];
        let mut shared_seams = vec![0.0f32; count];
        let mut shared_edges = vec![0u32; count];
        // The neighbours the chart measured shares edges with; the others share nothing.
        let mut touched: Vec<usize> = Vec::new();
        'restart: loop {
            for c in (0..count).rev() {
                let Some(chart) = &charts[c] else {
                    continue;
                };
                let mut external = 0.0f32;
                for &neighbour in &touched {
                    shared[neighbour] = 0.0;
                    shared_seams[neighbour] = 0.0;
                    shared_edges[neighbour] = 0;
                }
                touched.clear();
                for &face in &chart.faces {
                    for edge in face * 3..face * 3 + 3 {
                        let l = surface.edge_lengths[edge];
                        let other = surface.mesh.face_across(edge);
                        if other == NONE || self.face_charts[other] == -1 {
                            external += l;
                            continue;
                        }
                        let neighbour = self.face_charts[other] as usize;
                        if neighbour == c {
                            continue;
                        }
                        if shared_edges[neighbour] == 0 {
                            touched.push(neighbour);
                        }
                        if surface.mesh.joins_colocals(edge) && self.breaks_normals(edge) {
                            external += l;
                        } else {
                            shared[neighbour] += l;
                        }
                        shared_seams[neighbour] += l;
                        shared_edges[neighbour] += 1;
                    }
                }
                let (faces, area, boundary, normal) = (
                    chart.faces.len(),
                    chart.area,
                    chart.boundary_length,
                    chart.frame.normal,
                );
                // The neighbours from the last, as every chart would be visited.
                touched.sort_unstable_by(|a, b| b.cmp(a));
                for &cc in &touched {
                    let Some(other) = &charts[cc] else {
                        continue;
                    };
                    if shared[cc] <= 0.0 || dot(other.frame.normal, normal) < MERGE_MIN_NORMAL_DOT {
                        continue;
                    }
                    let merges = (shared_seams[cc] > 0.0
                        && faces > 1
                        && other.faces.len() == 1
                        && other.area <= area * 0.1)
                        || (other.faces.len() == 2 && shared_edges[cc] >= 2)
                        || (shared_seams[cc] > 0.0
                            && near(shared_seams[cc], other.boundary_length, EPSILON))
                        || shared[cc] > 0.2 * most(0.0, boundary - external)
                        || shared[cc] > 0.75 * other.boundary_length;
                    if merges && self.absorb(&mut charts, c, cc, shared_seams[cc]) {
                        continue 'restart;
                    }
                }
            }
            break;
        }
        charts.into_iter().flatten().collect()
    }

    /// Chart `from` merged into chart `into` if the result fits a plane and projects validly.
    fn absorb(
        &mut self,
        charts: &mut [Option<Cluster>],
        into: usize,
        from: usize,
        shared: f32,
    ) -> bool {
        let other = charts[from]
            .take()
            .expect("merge_neighbours offers a chart it found");
        let owner = charts[into]
            .as_mut()
            .expect("merge_neighbours offers a chart it found");
        let old_count = owner.faces.len();
        owner.faces.extend_from_slice(&other.faces);
        for &face in &other.faces {
            self.face_charts[face] = owner.id;
        }
        let frame = self.chart_frame(&owner.faces).and_then(|mut frame| {
            if dot(frame.normal, self.surface.face_normals[owner.faces[0]]) < 0.0 {
                frame.normal = negate(frame.normal);
            }
            self.project(owner);
            self.projection_valid(owner).then_some(frame)
        });
        let Some(frame) = frame else {
            owner.faces.truncate(old_count);
            for &face in &other.faces {
                self.face_charts[face] = other.id;
            }
            charts[from] = Some(other);
            return false;
        };
        owner.frame = frame;
        owner
            .failed_regions
            .extend_from_slice(&other.failed_regions);
        owner.area += other.area;
        owner.boundary_length += other.boundary_length - shared;
        true
    }
}
