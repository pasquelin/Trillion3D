//! What six axis cameras see of a cooked cut, against its source.
//!
//! A cut at threshold `t` is every page whose own error is at most `t` and whose parent's is above
//! it: the pages a renderer draws at that distance. On every cut, no triangle wider than the error
//! may face against the normals its page decodes at its corners: a narrower one draws under a
//! pixel wherever the cut is drawn (`dag/quality.rs`).
//!
//! The finest cut, the source as its pages decode it, must also cover the source's walls. Each
//! camera looks along one signed axis and keeps, per sample, the nearest front face of the source.
//! Where the source covers a whole disc of one sample around a sample, the cut must draw a face,
//! of either side, within that disc, no further than two samples behind the source: the pages' grid
//! moves a corner, never a wall. The rest of the mesh, drawn beside the cut, covers for a part the
//! cut removed in front of it, as the cook measures a removal against it
//! (`physics_cook/hausdorff/backdrop.rs`). A coarser cut is not held to its walls: its error is the
//! largest cost a collapse paid — plane distances weighed by the area they span, plus the
//! attributes' differences, plus the area a collapse lost —, which ranks the levels on screen but
//! bounds no distance a wall may move, so a thin shape's wall may leave a coarse cut by more.
use super::silhouette_grid::Grid;
use super::*;
use crate::proxy::cut::in_cut;
use trillion3d_math::geometry::triangle::triangle_cross;
use trillion3d_math::vector::vecn::{dot, length, sub};

pub(super) type Point = [f64; 3];

/// One source primitive: its vertices and, per corner, the vertex it draws.
pub(in crate::tests) struct Mesh {
    pub positions: Vec<Point>,
    pub normals: Vec<Point>,
    pub indices: Vec<u32>,
}

impl Mesh {
    /// The primitives of `meshes` as one mesh.
    pub fn merged<'a>(meshes: impl IntoIterator<Item = &'a Mesh>) -> Mesh {
        let mut all = Mesh {
            positions: Vec::new(),
            normals: Vec::new(),
            indices: Vec::new(),
        };
        for mesh in meshes {
            let base = all.positions.len() as u32;
            all.indices.extend(mesh.indices.iter().map(|&v| v + base));
            all.positions.extend_from_slice(&mesh.positions);
            all.normals.extend_from_slice(&mesh.normals);
        }
        all
    }
}

/// Every cut of `primitive`, finest first: its threshold, what it draws — the pages
/// `proxy::cut::in_cut` selects, each drawing its mesh of `drawn` (`cooked_pages::drawn`).
pub(in crate::tests) fn page_cuts(drawn: &[Mesh], primitive: &Value) -> Vec<(f64, Mesh)> {
    let pages = primitive["pages"].as_array().expect("pages");
    let error = |page: &Value, key: &str| page[key].as_f64().unwrap_or(f64::INFINITY);
    let mut thresholds: Vec<f64> = pages.iter().map(|p| error(p, "lodError")).collect();
    thresholds.sort_by(f64::total_cmp);
    thresholds.dedup();
    let cut = |t: f64| -> (f64, Mesh) {
        let drawn = pages.iter().zip(drawn);
        let drawn: Vec<(&Value, &Mesh)> = drawn
            .filter(|(p, _)| in_cut(error(p, "lodError"), error(p, "parentError"), t))
            .collect();
        (t, Mesh::merged(drawn.iter().map(|(_, mesh)| *mesh)))
    };
    thresholds.into_iter().map(cut).collect()
}

/// Each cut of `primitive`, whose pages draw the meshes of `drawn` as they decode, against
/// `mesh`, its source, drawn beside `rest`, the source of the rest of its mesh: one line per
/// defect.
pub(in crate::tests) fn cut_defects(
    drawn: &[Mesh],
    primitive: &Value,
    mesh: &Mesh,
    rest: &Mesh,
) -> Vec<String> {
    let (low, high) = trillion3d_math::geometry::aabb::aabb_of(mesh.positions.iter().copied());
    let diagonal = trillion3d_math::geometry::aabb::diagonal(low, high);
    let mut defects = Vec::new();
    for (rank, (t, cut)) in page_cuts(drawn, primitive).into_iter().enumerate() {
        for c in cut.indices.chunks(3) {
            let p = [0, 1, 2].map(|k| cut.positions[c[k] as usize]);
            let n = [0, 1, 2].map(|k| cut.normals[c[k] as usize]);
            let facing = triangle_cross(p[0], p[1], p[2]);
            let longest = [(0, 1), (1, 2), (2, 0)]
                .map(|(a, b)| length(sub(p[b], p[a])))
                .into_iter()
                .fold(0.0, f64::max);
            let wide = length(facing) > t * longest;
            if wide && dot(facing, std::array::from_fn(|a| n[0][a] + n[1][a] + n[2][a])) < 0.0 {
                defects.push(format!("cut {t}: triangle {p:?} faces against its normals"));
            }
        }
        // Walls are held on the finest cut alone (the module's rule).
        if rank > 0 {
            continue;
        }
        // An eighth of the error, never finer than the object's own 1/256th: the check's resolution.
        let step = (t / 8.0).max(diagonal / 256.0);
        // The disc a wall must cover: the cut's error, never under one sample — the pages' grid
        // moves a corner, even at the exact cut, where an error of zero would ask every sample on
        // the source's edge to stay covered.
        let radius = ((t / step).ceil() as usize).max(1);
        for axis in 0..3 {
            for sign in [-1.0, 1.0] {
                let [u, v] = [(axis + 1) % 3, (axis + 2) % 3];
                // A margin of `radius` empty samples: past the object's edge nothing covers.
                let size =
                    [u, v].map(|a| ((high[a] - low[a]) / step).ceil() as usize + 1 + 2 * radius);
                let grid = Grid {
                    axis,
                    sign,
                    origin: [u, v].map(|a| low[a] - radius as f64 * step),
                    step,
                    size,
                };
                let source = grid.raster(mesh, &mesh.indices, false);
                let behind = grid.raster(rest, &rest.indices, true);
                let drawn: Vec<f64> = (grid
                    .raster(&cut, &cut.indices, true)
                    .into_iter()
                    .zip(behind))
                .map(|(own, rest)| own.max(rest))
                .collect();
                let solid = grid.filter(&source, radius, f64::min);
                let reach = grid.filter(&drawn, radius, f64::max);
                let slack = t + 2.0 * step;
                let lost = (0..source.len())
                    .filter(|&s| solid[s].is_finite() && reach[s] < solid[s] - slack)
                    .count();
                if lost > 0 {
                    let wanted = solid.iter().filter(|d| d.is_finite()).count();
                    defects.push(format!(
                        "cut {t}: view {sign}·axis {axis} loses {lost} of {wanted} samples"
                    ));
                }
            }
        }
    }
    defects
}
