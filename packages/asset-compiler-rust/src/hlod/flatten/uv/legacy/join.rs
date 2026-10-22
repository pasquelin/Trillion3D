//! Charts joined side by side: two charts whose coordinates, once one is translated, meet along a
//! whole side of their boxes — a box's sides numbered left, right, bottom, top — are linked
//! (`link`); a run of linked charts is then made one chart, its triangles and coordinates moved
//! along, rows first and columns second (`merge`).
//!
//! A link is read from an edge two triangles of two charts share across a translation of their
//! coordinates (`finder`): both its ends lie on the borders the side names, along the axis the
//! side is on, and the boxes, the second moved by the translation, are equal across the other axis
//! and touch along this one. Both borders are read against the first chart's box, as the layout
//! reads them. A mirrored pair of triangles is never linked.
use super::chart::Chart;
use super::finder::{Found, SAME};
use trillion3d_math::vector::vecn::{add, scale, sub};

/// What the linking reads beside the charts: per corner the corner matched across an edge by a
/// translation (`-1` for none), the chart of each set's root, each triangle's set's root, and each
/// triangle's signed area of coordinates.
pub(super) struct Links<'a> {
    pub(super) matched: &'a [i32],
    pub(super) chart_of: &'a [u32],
    pub(super) roots: &'a [u32],
    pub(super) areas: &'a [f32],
}

/// An edge two triangles share across a translation: where it starts in the first triangle's
/// chart and in the second's, its direction in the first's, and the translation that brings the
/// second's end on the first's.
struct Edge {
    start_i: [f32; 2],
    start_j: [f32; 2],
    direction: [f32; 2],
    translation: [f32; 2],
}

/// Chart `i`'s side `side` and chart `j`'s side `side ^ 1` linked when both are free and the
/// charts meet there along `edge` (module doc).
fn link_at(charts: &mut [Chart], (i, j): (usize, usize), edge: &Edge, side: usize) -> bool {
    if charts[i].join[side] != -1 || charts[j].join[side ^ 1] != -1 {
        return false;
    }
    let (a, b) = (&charts[i], &charts[j]);
    let (sign, axis) = (side & 1, side >> 1);
    let border = |s: usize| if s == 1 { a.max[axis] } else { a.min[axis] };
    let aligned = edge.direction[axis].abs() < SAME;
    let border_a = (edge.start_i[axis] - border(sign)).abs() < SAME;
    let border_b = (edge.start_j[axis] - border(sign ^ 1)).abs() < SAME;
    if !(aligned && border_a && border_b) {
        return false;
    }
    let center_a = scale(add(a.min, a.max), 0.5);
    let center_b = add(scale(add(b.min, b.max), 0.5), edge.translation);
    let extent_a = scale(sub(a.max, a.min), 0.5);
    let extent_b = scale(sub(b.max, b.min), 0.5);
    let center_diff = sub(center_a, center_b);
    let extent_diff = sub(extent_a, extent_b);
    let toward = if sign == 1 { 1.0 } else { -1.0 };
    let separation = add(add(extent_a, extent_b), scale(center_diff, toward));
    let meets = center_diff[axis ^ 1].abs() < SAME
        && extent_diff[axis ^ 1].abs() < SAME
        && separation[axis].abs() < SAME;
    if !meets {
        return false;
    }
    charts[i].join[side] = j as i32;
    charts[j].join[side ^ 1] = i as i32;
    true
}

/// The charts linked through the edges `links` holds (module doc).
pub(super) fn link(found: &mut Found, links: &Links) {
    for i in 0..found.charts.len() {
        let (first, last) = (found.charts[i].first, found.charts[i].last);
        for tri in first..last {
            for k in 0..3 {
                let v0i = 3 * found.sorted[tri] as usize + k;
                if links.matched[v0i] < 0 {
                    continue;
                }
                let v0j = links.matched[v0i] as usize;
                let (tri_i, tri_j) = (v0i / 3, v0j / 3);
                if tri_j <= tri_i || links.areas[tri_i] * links.areas[tri_j] < 0.0 {
                    continue;
                }
                let v1i = 3 * tri_i + (v0i + 1) % 3;
                let v1j = 3 * tri_j + (v0j + 1) % 3;
                let uv = |corner: usize| found.uvs[corner];
                let edge = Edge {
                    start_i: uv(v0i),
                    start_j: uv(v0j),
                    direction: sub(uv(v1i), uv(v0i)),
                    translation: sub(uv(v0i), uv(v1j)),
                };
                let chart_j = links.chart_of[links.roots[tri_j] as usize] as usize;
                for side in 0..4 {
                    if link_at(&mut found.charts, (i, chart_j), &edge, side) {
                        break;
                    }
                }
            }
        }
    }
}

/// Chart `chart`'s link on `side` cut, the chart it names forgetting it too.
fn disconnect(charts: &mut [Chart], chart: usize, side: usize) {
    let other = charts[chart].join[side];
    if other != -1 {
        charts[other as usize].join[side ^ 1] = -1;
        charts[chart].join[side] = -1;
    }
}

/// Chart `b` made part of chart `a`, which it follows along `axis`: its triangles appended to
/// `joined`, its coordinates translated to follow `a`'s, `a` grown over it and taking its
/// lengths and area and its links, `b` emptied and cut from its other sides.
fn absorb(found: &mut Found, joined: &mut Vec<u32>, (a, b): (usize, usize), axis: usize) {
    let side = axis << 1;
    let (a_min, a_max) = (found.charts[a].min, found.charts[a].max);
    let other = found.charts[b].clone();
    let mut translation = sub(a_min, other.min);
    translation[axis] += a_max[axis] - a_min[axis];
    for &tri in &found.sorted[other.first..other.last] {
        joined.push(tri);
        for k in 0..3 {
            let uv = &mut found.uvs[3 * tri as usize + k];
            *uv = add(*uv, translation);
        }
    }
    let chart = &mut found.charts[a];
    chart.join[side ^ 1] = other.join[side ^ 1];
    chart.max[axis] += other.max[axis] - other.min[axis];
    // The box grown across the other axis to hold the chart joined, whatever its place.
    let across = other.max[axis ^ 1] - other.min[axis ^ 1];
    chart.max[axis ^ 1] = chart.max[axis ^ 1].max(chart.min[axis ^ 1] + across);
    chart.uv_length_sum += other.uv_length_sum;
    chart.world_length_sum += other.world_length_sum;
    chart.uv_area += other.uv_area;
    let emptied = &mut found.charts[b];
    emptied.first = 0;
    emptied.last = 0;
    emptied.uv_length_sum = 0.0;
    emptied.world_length_sum = 0.0;
    emptied.uv_area = 0.0;
    disconnect(&mut found.charts, b, side ^ 2);
    disconnect(&mut found.charts, b, side ^ 3);
}

/// The loops of links along each axis broken: a chart that reaches itself through the links on its
/// right, or its top, loses its left, or bottom, link and the last chart of the loop its right.
fn break_loops(charts: &mut [Chart]) {
    for axis in 0..2 {
        let side = axis << 1;
        for i in 0..charts.len() {
            let mut j = charts[i].join[side ^ 1];
            while j != -1 {
                let next = charts[j as usize].join[side ^ 1];
                if next == i as i32 {
                    charts[i].join[side] = -1;
                    charts[j as usize].join[side ^ 1] = -1;
                    break;
                }
                j = next;
            }
        }
    }
}

/// The empty charts removed, the last taking the place of each, and each chart's scale read from
/// the lengths of its edges in the mesh over those in its coordinates, one where it has none.
fn finish(charts: &mut Vec<Chart>) {
    let mut i = 0;
    while i < charts.len() {
        if charts[i].first == charts[i].last {
            charts.swap_remove(i);
        } else {
            i += 1;
        }
    }
    for chart in charts.iter_mut() {
        chart.world_scale = if chart.uv_length_sum < 1.0e-8 {
            1.0
        } else {
            chart.world_length_sum / chart.uv_length_sum
        };
    }
}

/// The links made one chart each: from each chart with none on its left, or bottom, the run it
/// starts joined into it, along the first axis then along the second, the charts then settled
/// (`finish`).
pub(super) fn merge(found: &mut Found) {
    break_loops(&mut found.charts);
    for axis in 0..2 {
        let side = axis << 1;
        let mut joined: Vec<u32> = Vec::with_capacity(found.sorted.len());
        for a in 0..found.charts.len() {
            let chart = &found.charts[a];
            if chart.first == chart.last || chart.join[side] != -1 {
                continue;
            }
            let first = joined.len();
            joined.extend_from_slice(&found.sorted[chart.first..chart.last]);
            while found.charts[a].join[side ^ 1] != -1 {
                let b = found.charts[a].join[side ^ 1] as usize;
                absorb(found, &mut joined, (a, b), axis);
            }
            found.charts[a].first = first;
            found.charts[a].last = joined.len();
        }
        found.sorted = joined;
    }
    finish(&mut found.charts);
}
