//! A merged mesh's unwrap by the old chart layout of its own first texture set (`uvMethod:
//! 'legacy'`): the mesh's triangles' corners as the layout reads them — positions in the frame the
//! ported steps read a scene in, vertex normals, first texture coordinates — laid out for an atlas
//! `side` texels wide (`uv::legacy::lay_out`), each corner given the coordinates of its own chart.
//! A mesh with no first texture set has none to lay out: its coordinates would be zero, whose
//! charts have no area, and the layout finds none for such charts, so it is not asked. Whether the
//! layout finds one or the default method generates the coordinates, they are then scaled and
//! moved so that together they fill the unit square (`scaled_to_box`).
use super::ground::oriented;
use crate::hlod::flatten::merge::Part;
use crate::hlod::flatten::units::{swap_axes, to_frame};
use crate::hlod::flatten::uv::legacy::{lay_out, Corners};
use trillion3d_math::geometry::aabb::aabb_of;
use trillion3d_math::vector::vec3::point_f32;
use trillion3d_page_codec::FLAG_UV;

/// `corners`' coordinates moved and scaled so that together they span the unit square: each less
/// the lowest, times one over the span. An axis whose span is zero or no finite number is only
/// moved, to its lowest where that is a number: the whole mesh lies at one coordinate, or at one
/// that cannot be scaled, and dividing by the span would make every coordinate no number.
pub(super) fn scaled_to_box(mut corners: Vec<[[f64; 2]; 3]>) -> Vec<[[f64; 2]; 3]> {
    let (low, high) = aabb_of(corners.iter().flatten().copied());
    let axis = |k: usize| {
        let span = high[k] - low[k];
        if span > 0.0 && span.is_finite() {
            (low[k], 1.0 / span)
        } else {
            (if low[k].is_finite() { low[k] } else { 0.0 }, 1.0)
        }
    };
    let fit = [axis(0), axis(1)];
    for uv in corners.iter_mut().flatten() {
        let old = *uv;
        *uv = [0, 1].map(|k| (old[k] - fit[k].0) * fit[k].1);
    }
    corners
}

/// The texture coordinates `part`'s mesh is baked at, per corner of its triangles in its mesh's own
/// order (`oriented`), as the old layout of its first texture set gives them for an atlas `side`
/// texels wide (module doc); none where the mesh has no such set or the layout finds no place for
/// its charts.
pub(super) fn layout(part: &Part, side: usize) -> Option<Vec<[[f64; 2]; 3]>> {
    let own = part.carried(FLAG_UV)?;
    let (positions, _, indices) = &part.geometry;
    let normals = part.normals();
    let corner_positions: Vec<[f32; 3]> = (indices.iter())
        .map(|&v| to_frame(point_f32(positions, v as usize)))
        .collect();
    let corner_normals: Vec<[f32; 3]> = (indices.iter())
        .map(|&v| swap_axes(point_f32(&normals, v as usize)))
        .collect();
    let corner_uvs: Vec<[f32; 2]> = (indices.iter())
        .map(|&v| [own[2 * v as usize], own[2 * v as usize + 1]])
        .collect();
    let corners = Corners {
        positions: &corner_positions,
        normals: &corner_normals,
        uvs: &corner_uvs,
    };
    let laid = lay_out(&corners, side)?;
    Some(
        (laid.as_chunks::<3>().0.iter())
            .map(|t| oriented(t.map(|uv| uv.map(f64::from)), part.mirrored))
            .collect(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_axis_of_no_span_is_moved_and_not_scaled() {
        // Every corner at x = 0.3: the span is zero, and 1 / 0 would make every x no number.
        let corners = vec![
            [[0.3, 2.0], [0.3, 4.0], [0.3, 3.0]],
            [[0.3, 2.0], [0.3, 3.0], [0.3, 4.0]],
        ];
        let laid = scaled_to_box(corners);
        for uv in laid.iter().flatten() {
            assert_eq!(uv[0], 0.0);
            assert!((0.0..=1.0).contains(&uv[1]), "{uv:?}");
        }
        assert_eq!(laid[0][0][1], 0.0);
        assert_eq!(laid[0][1][1], 1.0);
    }

    #[test]
    fn two_spans_fill_the_unit_square() {
        let corners = vec![[[1.0, -2.0], [3.0, 2.0], [2.0, 0.0]]];
        let laid = scaled_to_box(corners);
        assert_eq!(laid[0], [[0.0, 0.0], [1.0, 1.0], [0.5, 0.5]]);
    }
}
