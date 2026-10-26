//! A merged mesh's unwrap by the old chart layout of its own first texture set (`uvMethod:
//! 'legacy'`): the triangles' corners as the layout reads them — positions in the frame the ported
//! steps read a scene in, vertex normals, first texture coordinates (`LayoutCorners`) — laid out
//! for an atlas `side` texels wide (`uv::legacy::lay_out`), each corner given the coordinates of
//! its own chart. Corners with no first texture set have none to lay out: their coordinates would
//! be zero, whose charts have no area, and the layout finds none for such charts, so it is not
//! asked. Whether the layout finds one or the default method generates the coordinates, they are
//! then scaled and moved so that together they fill the unit square (`scaled_to_box`).
use super::ground::oriented;
use crate::hlod::flatten::merge::Part;
use crate::hlod::flatten::units::{swap_axes, to_frame};
use crate::hlod::flatten::uv::legacy::{lay_out, Corners};
use trillion3d_math::geometry::aabb::aabb_of;
use trillion3d_math::vector::vec3::point_f32;
use trillion3d_page_codec::FLAG_UV;

/// Per corner of some triangles, in order: its position, normal and first texture coordinates as
/// the layout reads them, and whether any part they come from carries a first texture set.
#[derive(Default)]
pub(super) struct LayoutCorners {
    positions: Vec<[f32; 3]>,
    normals: Vec<[f32; 3]>,
    uvs: Vec<[f32; 2]>,
    has_set: bool,
}

impl LayoutCorners {
    /// The corners of those triangles of `part` that `keep` names by their rank, appended in order.
    pub(super) fn push(&mut self, part: &Part, keep: impl Fn(usize) -> bool) {
        let own = part.carried(FLAG_UV);
        self.has_set |= own.is_some();
        let (positions, _, indices) = &part.geometry;
        let normals = part.normals();
        let kept = (indices.as_chunks::<3>().0.iter().enumerate()).filter(|&(t, _)| keep(t));
        for (_, tri) in kept {
            for &v in tri {
                let v = v as usize;
                self.positions.push(to_frame(point_f32(positions, v)));
                self.normals.push(swap_axes(point_f32(&normals, v)));
                self.uvs
                    .push(own.map_or([0.0; 2], |uv| [uv[2 * v], uv[2 * v + 1]]));
            }
        }
    }

    /// The coordinates the layout gives each corner for an atlas `side` texels wide; none where no
    /// corner has a first texture set or the layout finds no place for its charts.
    pub(super) fn lay_out(&self, side: usize) -> Option<Vec<[f32; 2]>> {
        if !self.has_set {
            return None;
        }
        let corners = Corners {
            positions: &self.positions,
            normals: &self.normals,
            uvs: &self.uvs,
        };
        lay_out(&corners, side)
    }
}

/// Every set of `sets`' coordinates moved and scaled so that together they span the unit square:
/// each less the lowest, times one over the span. An axis whose span is zero or no finite number is
/// only moved, to its lowest where that is a number: the whole mesh lies at one coordinate, or at
/// one that cannot be scaled, and dividing by the span would make every coordinate on that axis no
/// number.
pub(super) fn scaled_to_box(sets: &mut [Vec<[[f64; 2]; 3]>]) {
    let (low, high) = aabb_of(sets.iter().flatten().flatten().copied());
    let axis = |k: usize| {
        let span = high[k] - low[k];
        if span > 0.0 && span.is_finite() {
            (low[k], 1.0 / span)
        } else {
            (if low[k].is_finite() { low[k] } else { 0.0 }, 1.0)
        }
    };
    let fit = [axis(0), axis(1)];
    for uv in sets.iter_mut().flatten().flatten() {
        let old = *uv;
        *uv = [0, 1].map(|k| (old[k] - fit[k].0) * fit[k].1);
    }
}

/// The texture coordinates `part`'s mesh is baked at, per corner of its triangles in its mesh's own
/// order (`oriented`), as the old layout of its first texture set gives them for an atlas `side`
/// texels wide (module doc); none where the mesh has no such set or the layout finds no place for
/// its charts.
pub(super) fn layout(part: &Part, side: usize) -> Option<Vec<[[f64; 2]; 3]>> {
    part.carried(FLAG_UV)?;
    let mut corners = LayoutCorners::default();
    corners.push(part, |_| true);
    let laid = corners.lay_out(side)?;
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
        let mut sets = vec![vec![
            [[0.3, 2.0], [0.3, 4.0], [0.3, 3.0]],
            [[0.3, 2.0], [0.3, 3.0], [0.3, 4.0]],
        ]];
        scaled_to_box(&mut sets);
        for uv in sets.iter().flatten().flatten() {
            assert_eq!(uv[0], 0.0);
            assert!((0.0..=1.0).contains(&uv[1]), "{uv:?}");
        }
        assert_eq!(sets[0][0][0][1], 0.0);
        assert_eq!(sets[0][0][1][1], 1.0);
    }

    #[test]
    fn two_spans_fill_the_unit_square() {
        let mut sets = vec![vec![[[1.0, -2.0], [3.0, 2.0], [2.0, 0.0]]]];
        scaled_to_box(&mut sets);
        assert_eq!(sets[0][0], [[0.0, 0.0], [1.0, 1.0], [0.5, 0.5]]);
    }

    #[test]
    fn several_sets_are_scaled_by_the_box_of_them_all() {
        // One box over both: the first set spans a half, the second the other half.
        let mut sets = vec![
            vec![[[0.0, 0.0], [1.0, 0.0], [0.0, 1.0]]],
            vec![[[3.0, 2.0], [4.0, 2.0], [3.0, 3.0]]],
        ];
        scaled_to_box(&mut sets);
        assert_eq!(sets[0][0][1], [0.25, 0.0]);
        assert_eq!(sets[1][0][2], [0.75, 1.0]);
        assert_eq!(sets[1][0][1], [1.0, 2.0 / 3.0]);
    }
}
