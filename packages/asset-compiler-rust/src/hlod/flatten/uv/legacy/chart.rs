//! A chart of the old layout, and the two vector steps the layout reads that `vecn` lacks.

/// A chart: the run `first..last` of the sorted triangles it holds, the bounds and area of their
/// coordinates, how long its edges are in the mesh and in the coordinates, how it is scaled, and —
/// once packed — the transform that places it; and the chart joined to each of its four sides
/// (left, right, bottom, top, `-1` for none), and its rank among the charts found.
#[derive(Clone)]
pub(super) struct Chart {
    pub(super) first: usize,
    pub(super) last: usize,
    pub(super) min: [f32; 2],
    pub(super) max: [f32; 2],
    pub(super) uv_area: f32,
    pub(super) uv_scale: [f32; 2],
    /// The mesh's lengths over the coordinates', for both axes; none until the joins are made.
    pub(super) world_scale: f32,
    pub(super) uv_length_sum: f32,
    pub(super) world_length_sum: f32,
    pub(super) scale_u: [f32; 2],
    pub(super) scale_v: [f32; 2],
    pub(super) bias: [f32; 2],
    pub(super) join: [i32; 4],
    pub(super) id: usize,
}

impl Chart {
    /// An empty chart of rank `id`, its run starting at `first`.
    pub(super) fn new(id: usize, first: usize) -> Self {
        Self {
            first,
            last: first,
            min: [f32::MAX; 2],
            max: [-f32::MAX; 2],
            uv_area: 0.0,
            uv_scale: [0.0; 2],
            world_scale: 0.0,
            uv_length_sum: 0.0,
            world_length_sum: 0.0,
            scale_u: [0.0; 2],
            scale_v: [0.0; 2],
            bias: [0.0; 2],
            join: [-1; 4],
            id,
        }
    }
}

/// `a`'s components each times `b`'s.
pub(super) fn times(a: [f32; 2], b: [f32; 2]) -> [f32; 2] {
    [a[0] * b[0], a[1] * b[1]]
}

/// Whether every component of `a` is within `tolerance` of zero.
pub(super) fn near_zero<const N: usize>(a: [f32; N], tolerance: f32) -> bool {
    a.iter().all(|x| x.abs() <= tolerance)
}
