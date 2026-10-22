//! Charts scaled: one chart by a factor, every chart to its optimal share of the atlas, a chart by
//! the affine map that lowers its signal stretch most, and a single face laid in the plane.
//!
//! The optimal shares: chart `i` of stretch `Eᵢ` and plane area `aᵢ` is scaled in area by
//! `√(Eᵢ/aᵢ) · A / Σ√(Eⱼ aⱼ)`, `A` the plane areas' sum over the space rate 0.5; with a signal, a
//! chart that would fall under the smallest share of the atlas (100 texels of 512²) while it and
//! its surface are larger is held at that share, a single face whose tensor is almost a line keeps
//! its size, and when the signal is optimised the scale is bounded so the geometric stretch stays
//! between the expected bounds.
use super::INFINITE_STRETCH;
use crate::hlod::flatten::uv::spectral::mesh::Chart;
use crate::hlod::flatten::uv::spectral::util::{
    canonical_frame, l2_lower_bound, near_zero, near_zero2, root, transform,
};

/// The share of the atlas the charts are expected to cover.
const SPACE_RATE: f32 = 0.5;
/// The smallest share of the atlas a chart is given, with a signal.
const SMALLEST_CHART_SHARE: f32 = 100.0 / (512.0 * 512.0);
/// How far the whole-chart map may distort, with a signal.
const CHART_MAX_SCALE: f32 = 2.0;
/// How far a single face's map may distort, with a signal.
const FACE_MAX_SCALE: f32 = 2.0;

impl<'a> Chart<'a> {
    /// Every vertex scaled by `factor`, the plane area and stretch following; nothing when
    /// `factor` is within `ZERO` of 1.
    pub(crate) fn scale(&mut self, factor: f32) {
        if near_zero(factor - 1.0) {
            return;
        }
        for v in &mut self.verts {
            v.uv = [v.uv[0] * factor, v.uv[1] * factor];
        }
        self.area_2d *= factor * factor;
        if !near_zero(factor * factor) {
            self.stretch_l2 /= factor * factor;
        }
    }

    /// The chart's only face laid in the plane: by the map of least signal stretch from its
    /// canonical frame, or as its canonical frame.
    pub(crate) fn parameterize_one_face(&mut self, signal: bool, face: usize) {
        let root_face = self.faces[face].root as usize;
        let first = self.faces[0];
        if signal {
            let mt = self.tensor(root_face as u32);
            let (stretch, map) = l2_lower_bound(mt, self.source.areas[root_face], FACE_MAX_SCALE);
            self.stretch_l2 = stretch;
            let canonical = self.source.canonical_uvs[first.root as usize];
            for (k, &corner) in canonical.iter().enumerate() {
                self.verts[first.verts[k] as usize].uv = transform(corner, &map);
            }
        } else {
            let p = first.verts.map(|v| self.point(v));
            let (uvs, _) = canonical_frame(p);
            for (k, &uv) in uvs.iter().enumerate() {
                self.verts[first.verts[k] as usize].uv = uv;
            }
            self.stretch_l2 = self.source.areas[root_face];
        }
        self.area_2d = self.area_3d;
        self.parameterized = true;
    }

    /// The chart mapped by the affine map of least signal stretch for its summed tensor, unless
    /// a face's stretch is infinite or the map would raise the geometric stretch past
    /// `max_geometric` per surface area.
    pub(crate) fn optimize_whole_chart(&mut self, max_geometric: f32) {
        let mut m = [0f64; 3];
        let mut geometric = [0f64; 3];
        for face in 0..self.faces.len() {
            let uv = self.corners_with(face, u32::MAX, [0.0; 2]);
            let (stretch, _, carried) = self.face_signal_stretch(face, uv);
            if stretch == INFINITE_STRETCH {
                return;
            }
            let area = self.source.areas[self.faces[face].root as usize];
            for k in 0..3 {
                m[k] += carried.tensor[k] as f64;
                geometric[k] += (carried.geometric[k] * area) as f64;
            }
        }
        let count = self.faces.len() as f64;
        let mean = m.map(|v| (v / count) as f32);
        let (_, matrix) = l2_lower_bound(Some(&mean), 1.0, CHART_MAX_SCALE);
        let new_geometric = ((geometric[0]
            * (matrix[0] * matrix[0] + matrix[2] * matrix[2]) as f64
            + geometric[2] * (matrix[1] * matrix[1] + matrix[3] * matrix[3]) as f64
            + 2.0 * geometric[1] * (matrix[1] * matrix[0] + matrix[2] * matrix[3]) as f64)
            / 2.0) as f32;
        if new_geometric > max_geometric * self.area_3d {
            return;
        }
        for v in &mut self.verts {
            v.uv = transform(v.uv, &matrix);
        }
    }
}

/// Every chart scaled to its optimal share for the mean squared stretch `l2`.
pub(crate) fn scale_charts_optimally(charts: &mut [Chart], l2: f32, signal: bool) {
    let Some(first) = charts.first() else {
        return;
    };
    let source = first.source;
    let weighted_sum = root(l2) * source.area;
    if near_zero2(weighted_sum) {
        return;
    }
    let mut domain = charts.iter().fold(0.0, |sum, c| sum + c.area_2d);
    domain /= SPACE_RATE;
    let smallest_2d = domain * SMALLEST_CHART_SHARE;
    let smallest_3d = source.area * SMALLEST_CHART_SHARE;
    let expected = source.expected_l2.get();
    for chart in charts.iter_mut() {
        let (stretch, area) = (chart.stretch_l2, chart.area_2d);
        if near_zero2(area) {
            continue;
        }
        let mut alpha = root(stretch / area) * domain / weighted_sum;
        if chart.faces.len() == 1 {
            if let Some(p) = chart.tensor(chart.faces[0].root) {
                let thin = |a: f32, b: f32| a > b && ((b / a) as f64) < 1e-8;
                if thin(p[0], p[2]) || (p[0] < p[2] && ((p[0] / p[2]) as f64) < 1e-8) {
                    continue;
                }
            }
        }
        if source.has_signal()
            && chart.area_2d * alpha < smallest_2d
            && chart.area_2d > smallest_2d
            && chart.area_3d > smallest_3d
        {
            alpha = smallest_2d / chart.area_2d;
        }
        if signal {
            if chart.geometric_l2 > expected * chart.area_3d * alpha {
                alpha = expected * chart.area_3d / chart.geometric_l2;
            }
            if chart.geometric_l2 < source.expected_min_l2 * chart.area_3d * alpha {
                alpha = source.expected_min_l2 * chart.area_3d / chart.geometric_l2;
            }
        }
        chart.scale(root(alpha));
        if signal && !near_zero2(alpha) {
            chart.geometric_l2 /= alpha;
        }
    }
}
