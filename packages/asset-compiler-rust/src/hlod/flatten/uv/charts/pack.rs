//! The charts packed into one atlas, in texels:
//!
//! 1. each chart measured: its texture area (half its bounding extents' product when under
//!    `AREA_EPSILON`), its surface area, and its least-area box (`least_box`);
//! 2. the texel density estimated so the charts' surface fills three quarters of a 1024² atlas;
//! 3. each chart turned to its box's axes and moved to its corner, scaled to the density (times
//!    the root of surface over texture area), stretched to whole texels on each axis, and moved
//!    half a texel in;
//! 4. each chart rasterized (`cover_triangle`) and grown by the texels bilinear filtering would
//!    sample (a texel whose 2×2 square around its centre meets a boundary edge, next to a covered
//!    one), all charts at once;
//! 5. the charts placed largest first (by width plus height; `sorted_ranks`), each where it
//!    overlaps nothing in the atlas (`find_place`), turned a quarter (its axes swapped) or not; the
//!    atlas grows to the next powers of two holding what is used.
//!
//! The atlas's size is the extent the charts use.
use super::chart::UvChart;
use super::grid::EdgeGrid;
use super::hull::{least_box, sorted_ranks, AxisBox};
use super::mesh::TriMesh;
use super::raster::{cover_triangle, Bits};
use super::vector::{bounds2, most, most2, Vec2, AREA_EPSILON};
use crate::hlod::flatten::uv::raster::neighbours8;
use rayon::prelude::*;
use trillion3d_math::vector::vecn::{dot, scale, sub};

mod place;
use place::{find_place, Kiss};

/// The atlas side the texel density is estimated for, and the atlas's first size.
const RESOLUTION: u32 = 1024;

/// What the packer measures of a chart before scaling it.
struct Measure {
    uv_area: f32,
    surface_area: f32,
    axes: AxisBox,
}

/// The charts packed, their texture coordinates now in texels; the atlas's width and height.
pub(super) fn pack(charts: &mut [UvChart]) -> (u32, u32) {
    if charts.is_empty() {
        return (0, 0);
    }
    let measures: Vec<Measure> = charts
        .par_iter()
        .map(|chart| measure(&chart.mesh))
        .collect();
    let surface = measures.iter().fold(0.0f32, |sum, m| sum + m.surface_area);
    let texel_count = most(1.0, surface / 0.75);
    let texels_per_unit = ((RESOLUTION * RESOLUTION) as f32 / texel_count).sqrt();
    let extents: Vec<Vec2> = (charts.par_iter_mut())
        .zip(&measures)
        .map(|(chart, measure)| to_texels(&mut chart.mesh.texcoords, measure, texels_per_unit))
        .collect();
    let keys: Vec<f32> = extents.iter().map(|e| e[0] + e[1]).collect();
    let stamps: Vec<Stamp> = (charts.par_iter().zip(&extents))
        .map(|(chart, &extents)| Stamp::new(&chart.mesh, extents))
        .collect();
    let mut atlas = Bits::new(RESOLUTION, RESOLUTION);
    let mut used = [0i32; 2];
    let mut draws = Kiss::new();
    for &index in sorted_ranks(&keys).iter().rev() {
        let stamp = &stamps[index];
        let place = find_place(&atlas, &stamp.bilinear, &stamp.turned, used, &mut draws);
        used = [
            used[0].max(place.x + place.w),
            used[1].max(place.y + place.h),
        ];
        let (width, height) = (used[0] as u32, used[1] as u32);
        if width > atlas.width || height > atlas.height {
            atlas.resize_keeping(width.next_power_of_two(), height.next_power_of_two());
        }
        let image = if place.turned {
            &stamp.turned
        } else {
            &stamp.bilinear
        };
        // A place is never left of or above the origin.
        atlas.mark_from(image, (place.x as u32, place.y as u32), [width, height]);
        for uv in charts[index].mesh.texcoords.iter_mut() {
            let t = if place.turned { [uv[1], uv[0]] } else { *uv };
            *uv = [place.x as f32 + t[0], place.y as f32 + t[1]];
        }
    }
    (used[0].max(0) as u32, used[1].max(0) as u32)
}

fn measure(mesh: &TriMesh) -> Measure {
    let mut uv_area = mesh.uv_area();
    if uv_area < AREA_EPSILON {
        let (low, high) = bounds2(mesh.texcoords.iter().copied());
        let half = scale(sub(high, low), 0.5);
        uv_area = half[0] * half[1];
    }
    let boundary: Vec<Vec2> = (mesh.texcoords.iter().enumerate())
        .filter(|&(vertex, _)| mesh.on_boundary(vertex))
        .map(|(_, &uv)| uv)
        .collect();
    Measure {
        uv_area,
        surface_area: mesh.surface_area(),
        axes: least_box(&boundary, &mesh.texcoords),
    }
}

/// The chart's coordinates turned to its box, scaled to texels, stretched to whole texels and
/// moved half a texel in; its extents.
fn to_texels(texcoords: &mut [Vec2], measure: &Measure, texels_per_unit: f32) -> Vec2 {
    let ratio = if measure.uv_area != 0.0 {
        (measure.surface_area / measure.uv_area).sqrt() * texels_per_unit
    } else {
        1.0
    };
    let axes = &measure.axes;
    let minor = axes.minor();
    let mut extents = [0.0f32; 2];
    for uv in texcoords.iter_mut() {
        let turned = [dot(*uv, axes.major), dot(*uv, minor)];
        *uv = scale(sub(turned, axes.min), ratio);
        extents = most2(extents, *uv);
    }
    if extents[0] > 0.0 && extents[1] > 0.0 {
        let whole = [
            extents[0].ceil() as i32 as f32,
            extents[1].ceil() as i32 as f32,
        ];
        for uv in texcoords.iter_mut() {
            *uv = [uv[0] / extents[0] * whole[0], uv[1] / extents[1] * whole[1]];
        }
    }
    let mut extents = [0.0f32; 2];
    for uv in texcoords.iter_mut() {
        *uv = [uv[0] + 0.5, uv[1] + 0.5];
        extents = most2(extents, *uv);
    }
    extents
}

/// A chart's raster grown for bilinear filtering, upright and turned (axes swapped).
struct Stamp {
    bilinear: Bits,
    turned: Bits,
}

impl Stamp {
    fn new(mesh: &TriMesh, extents: Vec2) -> Stamp {
        let (width, height) = (
            extents[0].ceil() as i32 as u32,
            extents[1].ceil() as i32 as u32,
        );
        let mut plain = Bits::new(width, height);
        let mut bilinear = Bits::new(width, height);
        let mut turned = Bits::new(height, width);
        let size = [width as f32, height as f32];
        for face in 0..mesh.face_count() {
            cover_triangle(size, mesh.face_texcoords(face), |x, y| {
                plain.set(x as u32, y as u32)
            });
        }
        let mut grid = EdgeGrid::default();
        grid.reset_to(mesh.border_edges.iter().copied());
        let corners = mesh.uv_corners();
        let sides = [width as usize, height as usize];
        for y in 0..height {
            for x in 0..width {
                let covered = plain.get(x, y) || {
                    let beside = neighbours8(sides, y as usize * sides[0] + x as usize)
                        .any(|n| plain.get((n % sides[0]) as u32, (n / sides[0]) as u32));
                    beside && {
                        let centre = [x as f32 + 0.5, y as f32 + 0.5];
                        let square = [
                            [centre[0] - 1.0, centre[1] - 1.0],
                            [centre[0] + 1.0, centre[1] - 1.0],
                            [centre[0] + 1.0, centre[1] + 1.0],
                            [centre[0] - 1.0, centre[1] + 1.0],
                        ];
                        (0..4).any(|j| {
                            grid.crosses_segment(corners, square[j], square[(j + 1) % 4], 0.0)
                        })
                    }
                };
                if covered {
                    bilinear.set(x, y);
                    turned.set(y, x);
                }
            }
        }
        Stamp { bilinear, turned }
    }
}
