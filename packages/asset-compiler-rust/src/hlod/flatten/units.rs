//! The frame the ported steps read a scene in: centimetres, up the third axis. Our point
//! `(x, y, z)` — metres, glTF's `y` up — is the point `100 · (x, z, y)` there, a triangle's corners
//! kept in their order, so every tolerance, cross product and side test of a ported step reads as
//! it was written for that frame.

/// Metres to centimetres.
pub(crate) const CENTIMETRES: f64 = 100.0;

/// Square metres to square centimetres.
pub(crate) const SQUARE_CENTIMETRES: f64 = CENTIMETRES * CENTIMETRES;

/// `[x, y, z]` with its second and third axes exchanged: from up along `y` to up along `z`, and
/// back.
pub(crate) fn swap_axes<T>([x, y, z]: [T; 3]) -> [T; 3] {
    [x, z, y]
}

/// Our point in the ported steps' frame: centimetres, its second and third coordinates exchanged.
pub(crate) fn to_reference(p: [f64; 3]) -> [f64; 3] {
    swap_axes(p).map(|v| v * CENTIMETRES)
}

/// A point of the ported steps' frame in ours (`to_reference`'s inverse).
pub(crate) fn from_reference(p: [f64; 3]) -> [f64; 3] {
    swap_axes(p).map(|v| v / CENTIMETRES)
}

/// `to_reference` of a point kept in single precision, each coordinate scaled in double precision
/// and rounded once to single.
pub(crate) fn to_frame(p: [f32; 3]) -> [f32; 3] {
    to_reference(p.map(f64::from)).map(|x| x as f32)
}

/// `from_reference` of a point kept in single precision (`to_frame`'s inverse).
pub(crate) fn from_frame(p: [f32; 3]) -> [f32; 3] {
    from_reference(p.map(f64::from)).map(|x| x as f32)
}
