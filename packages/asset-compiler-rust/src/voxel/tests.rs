//! What the voxel modules' tests share.

/// The triangles — nine floats each — of two quads of two triangles over x in 0..0.5 and y in 0..1:
/// ranks 0 and 1 at z = 0.5, inside voxel `[0, 0, 0]` of side 1, and ranks 2 and 3 at z = −0.5, in
/// the voxel below it, which they do not overlap.
pub(super) fn two_quads() -> Vec<f32> {
    let quad = |z: f32| {
        let corner = |x: f32, y: f32| [x, y, z];
        let (a, b, c, d) = (
            corner(0.0, 0.0),
            corner(0.5, 0.0),
            corner(0.5, 1.0),
            corner(0.0, 1.0),
        );
        [a, b, c, a, c, d].concat()
    };
    [quad(0.5), quad(-0.5)].concat()
}
