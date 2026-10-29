//! The old chart layout of a mesh's own first texture set: the triangles' corners joined into
//! charts, the charts packed into a square, each coordinate moved with its chart — step for step
//! and value for value as the layout the mesh tools laid lightmaps by computes them, at its
//! latest revision, in single precision:
//!
//! 1. the corners at one place found (`support::neighbours`), the triangles joined into sets
//!    wherever two share an edge their coordinates and winding agree on, the sets sorted and cut
//!    into charts, each measured, and the charts that meet along a whole side of their boxes
//!    joined, rows then columns (`finder`, `join`);
//! 2. the square's side, a quarter of the texture's, from 32 to 512 texels, or the least power of
//!    two whose square holds a texel for each chart if that is larger;
//! 3. the charts packed into it (`packer`, `scale`): each at the scale of its edges' lengths in
//!    the mesh, those too long for the square shrunk to it, placed largest first in its eight
//!    orientations by the raster packer (`uv::pack`), the scale searched for the largest that
//!    fits;
//! 4. each corner's coordinates moved to where its chart landed, in the unit square (`commit`).
//!
//! The layout finds none where the charts are more than the square's texels, or where their
//! coordinates have no area in total, or an area that is not a number; the caller then takes
//! another method.
mod chart;
mod finder;
mod join;
mod packer;
mod scale;
use chart::Chart;
use finder::Found;

/// A mesh's triangles' corners, three to a triangle, as the layout reads them: each corner's
/// position, normal and first coordinates.
pub(crate) struct Corners<'a> {
    pub positions: &'a [[f32; 3]],
    pub normals: &'a [[f32; 3]],
    pub uvs: &'a [[f32; 2]],
}

/// The charts' transforms applied: per corner, the coordinates it lands at in the unit square of
/// `resolution` texels.
fn commit(charts: &[Chart], found: &Found, resolution: u32) -> Vec<[f32; 2]> {
    let reciprocal = 1.0f32 / resolution as f32;
    let mut out = vec![[0.0f32; 2]; found.uvs.len()];
    for chart in charts {
        let scale_u = chart.scale_u.map(|x| x * reciprocal);
        let scale_v = chart.scale_v.map(|x| x * reciprocal);
        let bias = chart.bias.map(|x| x * reciprocal);
        for &tri in &found.sorted[chart.first..chart.last] {
            for k in 0..3 {
                let corner = 3 * tri as usize + k;
                let uv = found.uvs[corner];
                out[corner] =
                    [0, 1].map(|axis| uv[0] * scale_u[axis] + uv[1] * scale_v[axis] + bias[axis]);
            }
        }
    }
    out
}

/// The coordinates the old layout gives each corner of the mesh `corners` for an atlas
/// `texture_size` texels wide (module doc); none where it finds no layout.
pub(crate) fn lay_out(corners: &Corners, texture_size: usize) -> Option<Vec<[f32; 2]>> {
    let found = finder::find(corners);
    // The packing is searched in a smaller square to be quick, but one that holds a texel a chart.
    let packing = (texture_size / 4).clamp(32, 512);
    let least = ((found.charts.len() as f32).sqrt() as usize).next_power_of_two();
    let resolution = packing.max(least) as u32;
    let charts = packer::find_best(&found, resolution)?;
    Some(commit(&charts, &found, resolution))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A triangle soup: its positions, its normals and its coordinates.
    type Soup = (Vec<[f32; 3]>, Vec<[f32; 3]>, Vec<[f32; 2]>);

    /// The corners of a unit square, in centimetres, as two triangles over its corners 0, 1, 2 and
    /// 0, 2, 3, wearing its own coordinates, those of the second triangle moved by `shift`.
    fn square(shift: f32) -> Soup {
        let corner = [[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]];
        let named = [0usize, 1, 2, 0, 2, 3];
        let positions = (named.iter())
            .map(|&v| [corner[v][0] * 100.0, corner[v][1] * 100.0, 0.0])
            .collect();
        let uvs = (named.iter().enumerate())
            .map(|(c, &v)| {
                let moved = if c >= 3 { shift } else { 0.0 };
                [corner[v][0] + moved, corner[v][1] + moved]
            })
            .collect();
        (positions, vec![[0.0, 0.0, 1.0]; 6], uvs)
    }

    /// The corners a soup holds.
    fn view(soup: &Soup) -> Corners<'_> {
        Corners {
            positions: &soup.0,
            normals: &soup.1,
            uvs: &soup.2,
        }
    }

    #[test]
    fn two_triangles_of_one_square_are_one_chart_laid_in_the_unit_square() {
        let soup = square(0.0);
        let corners = view(&soup);
        assert_eq!(finder::find(&corners).charts.len(), 1);
        let laid = lay_out(&corners, 256).expect("a layout");
        assert_eq!(laid.len(), 6);
        for uv in &laid {
            assert!(uv.iter().all(|x| (0.0..=1.0).contains(x)), "{uv:?}");
        }
        // The corners at one place of one chart land at one place; the four places differ.
        assert_eq!((laid[0], laid[2]), (laid[3], laid[4]));
        let places = [laid[0], laid[1], laid[2], laid[5]];
        for a in 0..4 {
            for b in a + 1..4 {
                assert_ne!(places[a], places[b]);
            }
        }
    }

    #[test]
    fn triangles_whose_coordinates_differ_by_a_shift_are_two_charts_each_laid_on_its_own() {
        let soup = square(5.0);
        let corners = view(&soup);
        assert_eq!(finder::find(&corners).charts.len(), 2);
        // The corners at one place of two charts land at two places: a corner keeps its own
        // chart's transform, whatever corner of another chart lies at its position.
        let laid = lay_out(&corners, 256).expect("a layout");
        assert_ne!(laid[0], laid[3]);
        assert_ne!(laid[2], laid[4]);
    }

    #[test]
    fn coordinates_without_area_give_no_layout() {
        let mut soup = square(0.0);
        soup.2 = vec![[0.0, 0.0]; 6];
        let corners = view(&soup);
        assert!(lay_out(&corners, 256).is_none());
    }

    #[test]
    fn an_area_that_is_not_a_number_gives_no_layout() {
        // A coordinate past the floats: the charts' lengths overflow, their area is no number,
        // and every chart would "fit" at the origin.
        let mut soup = square(0.0);
        soup.2[2] = [f32::INFINITY, 1.0];
        let corners = view(&soup);
        assert!(lay_out(&corners, 256).is_none());
    }

    #[test]
    fn an_area_that_overflows_to_infinity_gives_no_layout() {
        // Finite coordinates of 1e20: each length is finite, the area of a triangle (1e40) is
        // past the single-precision floats. Left to the search, its scale starts at zero, every
        // chart collapses to a point and "fits", and the first set is lost without a number
        // wrong in it.
        let mut soup = square(0.0);
        soup.2
            .iter_mut()
            .for_each(|uv| *uv = uv.map(|x| x * 1.0e20));
        let corners = view(&soup);
        assert!(lay_out(&corners, 256).is_none());
    }
}
