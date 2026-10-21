//! The faces no planar chart took, grouped into charts grown from seeds (Lévy et al.'s
//! least-squares conformal maps' segmentation, variational shape approximation style):
//!
//! 1. seeds placed: while faces remain, a chart is started on the face of the largest planar
//!    region left (the first such face) and grown while its cheapest candidate costs at most
//!    `MAX_COST / 2`;
//! 2. each seed moved to the most central (nearest to the chart's centroid) of the ten faces whose
//!    normals deviate least from the chart's, then every chart restarted from its seed alone;
//! 3. the charts grown together: each step the cheapest candidate of all charts (the first chart
//!    on a tie) joins its chart, until none costs at most `MAX_COST`;
//! 4. holes filled as in 1., then neighbouring charts merged (`merge`).
//!
//! A face always joins with its whole planar region. A chart's frame is its first face's normal and
//! first edge while it has one region, the plane fitted to its corners (`fit_frame`) after, turned
//! to its newest face's side. A face is refused, its region then never offered to the chart again,
//! when no plane fits or when the chart projected on its frame (the frame before the face joined)
//! has some but not all faces turned, or boundary edges that cross (`EdgeGrid`), as `join` tests.
//! Each chart keeps its candidates, the neighbouring faces outside every chart, in a list sorted by
//! decreasing cost (`CostList`, rebuilt in `candidates`); their costs are weighed in `cost`.
use super::grid::EdgeGrid;
use super::planar::{PlanarRegions, Surface};
use super::vector::{Frame, Vec2, Vec3};
use std::cmp::Ordering;
use std::collections::BinaryHeap;
use trillion3d_math::vector::vecn::{length, scale, sub};

mod candidates;
mod cost;
mod join;
mod merge;

use candidates::CostList;

/// The cost a candidate may reach to join its chart.
const MAX_COST: f32 = 2.0;
/// How many of a chart's best-fitting faces the seed is moved among.
const SEED_CANDIDATES: usize = 10;

/// A chart's cheapest candidate cost when last looked at, ordered for a max-heap to give the
/// least cost first, the first chart on a tie. Costs are never NaN.
#[derive(PartialEq)]
struct Top(f32, usize);

impl Eq for Top {}

impl PartialOrd for Top {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for Top {
    fn cmp(&self, other: &Self) -> Ordering {
        (other.0.partial_cmp(&self.0).unwrap_or(Ordering::Equal)).then(other.1.cmp(&self.1))
    }
}

struct Cluster {
    id: i32,
    frame: Frame,
    area: f32,
    boundary_length: f32,
    centroid_sum: Vec3,
    faces: Vec<usize>,
    failed_regions: Vec<usize>,
    candidates: CostList,
    seed: usize,
}

impl Cluster {
    fn new(id: usize) -> Cluster {
        Cluster {
            id: id as i32,
            frame: Frame::default(),
            area: 0.0,
            boundary_length: 0.0,
            centroid_sum: [0.0; 3],
            faces: Vec::new(),
            failed_regions: Vec::new(),
            candidates: CostList::new(usize::MAX),
            seed: 0,
        }
    }
}

/// What the charts grow in: the surface, its regions, which faces are taken, and the scratch of
/// the fit, the validity test and the candidates' rebuild.
struct Growth<'a> {
    surface: &'a Surface,
    planar: &'a PlanarRegions,
    in_chart: Vec<bool>,
    faces_left: u32,
    /// The faces no planar chart took whose region has area, by decreasing area, then by face:
    /// the seeds `fill` takes in turn.
    by_area: Vec<usize>,
    /// Per face, the chart it is in, `-1` for none.
    face_charts: Vec<i32>,
    /// Per corner, the projection of the chart being tested.
    texcoords: Vec<Vec2>,
    grid: EdgeGrid,
    /// The corners of the chart being fitted.
    points: Vec<Vec3>,
    /// The candidates' rebuilds counted; per face the last rebuild that weighed it and its cost
    /// then, per region the last rebuild whose chart had refused it.
    rebuild: u32,
    weighed: Vec<(u32, f32)>,
    refused: Vec<u32>,
}

/// The charts grown over the faces `in_chart` leaves free: their faces and frames, in order.
pub(super) fn clustered_charts(
    surface: &Surface,
    planar: &PlanarRegions,
    in_chart: Vec<bool>,
) -> Vec<(Vec<usize>, Frame)> {
    let face_count = surface.mesh.face_count();
    let faces_left = in_chart.iter().filter(|&&taken| !taken).count() as u32;
    if faces_left == 0 {
        return Vec::new();
    }
    let area_of = |face: usize| planar.areas[planar.region[face]];
    let mut by_area: Vec<usize> = (0..face_count)
        .filter(|&face| !in_chart[face] && area_of(face) > 0.0)
        .collect();
    by_area.sort_by(|&a, &b| area_of(b).total_cmp(&area_of(a)));
    let mut growth = Growth {
        surface,
        planar,
        in_chart,
        faces_left,
        by_area,
        face_charts: vec![-1; face_count],
        texcoords: vec![[0.0; 2]; face_count * 3],
        grid: EdgeGrid::default(),
        points: Vec::new(),
        rebuild: 0,
        weighed: vec![(0, 0.0); face_count],
        refused: vec![0; planar.areas.len()],
    };
    let mut charts = Vec::new();
    growth.fill(&mut charts, MAX_COST * 0.5);
    for chart in charts.iter_mut() {
        growth.recentre_seed(chart);
    }
    growth.restart(&mut charts);
    growth.grow(&mut charts, MAX_COST);
    growth.fill(&mut charts, MAX_COST * 0.5);
    let charts = growth.merge_neighbours(charts);
    charts
        .into_iter()
        .map(|chart| (chart.faces, chart.frame))
        .collect()
}

impl Growth<'_> {
    /// Charts started and grown until no face is left.
    fn fill(&mut self, charts: &mut Vec<Cluster>, threshold: f32) {
        // Faces are only taken while charts fill: the seeds already taken are never looked at
        // again.
        let mut next_seed = 0;
        while self.faces_left > 0 {
            let mut chart = Cluster::new(charts.len());
            // The first free face of the largest region left; face 0 when no free region has
            // area.
            while let Some(&face) = self.by_area.get(next_seed) {
                if !self.in_chart[face] {
                    chart.seed = face;
                    break;
                }
                next_seed += 1;
            }
            let seed = chart.seed;
            self.add_face(&mut chart, seed);
            while let Some((cost, face)) = chart.candidates.peek() {
                if cost > threshold {
                    break;
                }
                chart.candidates.pop();
                if self.in_chart[face] {
                    continue;
                }
                if !self.add_face(&mut chart, face) {
                    chart.failed_regions.push(self.planar.region[face]);
                }
            }
            charts.push(chart);
        }
    }

    /// The chart's seed moved to the most central of its best-fitting faces.
    fn recentre_seed(&self, chart: &mut Cluster) {
        let mut best = CostList::new(SEED_CANDIDATES);
        for &face in &chart.faces {
            best.push(self.deviation(chart, face), face);
        }
        let centroid = scale(chart.centroid_sum, 1.0 / chart.faces.len() as f32);
        let mut central = 0;
        let mut nearest = f32::MAX;
        while let Some(face) = best.pop() {
            let distance = length(sub(centroid, self.surface.mesh.face_center(face)));
            if distance < nearest {
                nearest = distance;
                central = face;
            }
        }
        chart.seed = central;
    }

    /// Every face of the clustered charts freed, every chart restarted from its seed alone.
    fn restart(&mut self, charts: &mut [Cluster]) {
        for face in 0..self.face_charts.len() {
            if self.face_charts[face] != -1 {
                self.in_chart[face] = false;
            }
            self.face_charts[face] = -1;
        }
        self.faces_left = self.in_chart.iter().filter(|&&taken| !taken).count() as u32;
        for chart in charts.iter_mut() {
            let (id, seed) = (chart.id as usize, chart.seed);
            *chart = Cluster::new(id);
            chart.seed = seed;
            self.add_face(chart, seed);
        }
    }

    /// The cheapest candidate of all charts joined to its chart, over and over, while it costs at
    /// most `threshold`; candidates already taken by another chart are dropped on the way.
    ///
    /// The charts wait in a heap by the cost of their cheapest candidate when last looked at.
    /// Until a chart joins a face, other charts only take its candidates, so its cheapest free one
    /// never gets cheaper: the chart surfacing first with its cost unchanged is the cheapest of
    /// all, and the first of them on a tie.
    fn grow(&mut self, charts: &mut [Cluster], threshold: f32) {
        let mut tops: BinaryHeap<Top> = (0..charts.len())
            .filter_map(|index| Some(Top(self.cheapest_free(&mut charts[index])?.0, index)))
            .collect();
        while self.faces_left > 0 {
            let Some(Top(seen, index)) = tops.pop() else {
                return;
            };
            let chart = &mut charts[index];
            let Some((cost, face)) = self.cheapest_free(chart) else {
                continue;
            };
            if cost != seen {
                tops.push(Top(cost, index));
                continue;
            }
            if cost > threshold {
                return;
            }
            chart.candidates.pop();
            if !self.add_face(chart, face) {
                chart.failed_regions.push(self.planar.region[face]);
            }
            if let Some((cost, _)) = self.cheapest_free(chart) {
                tops.push(Top(cost, index));
            }
        }
    }

    /// The chart's cheapest candidate still free, the taken ones dropped on the way.
    fn cheapest_free(&self, chart: &mut Cluster) -> Option<(f32, usize)> {
        while let Some((cost, face)) = chart.candidates.peek() {
            if !self.in_chart[face] {
                return Some((cost, face));
            }
            chart.candidates.pop();
        }
        None
    }
}
