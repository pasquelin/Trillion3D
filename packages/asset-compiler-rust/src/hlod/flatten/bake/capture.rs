//! The views an approximated shell's atlas reads its sources through (`gpu/capture.wgsl`), laid out
//! as a capture of the sources' surfaces lays them: twenty-two directions — the six axes, the
//! cube's four upper and four lower corners, four edges of its top and its four side edges —, each
//! looking at the centre of the sphere around the sources from as far as that sphere, grown by a
//! quarter, fills its field of view; each image square, `HlodCapture::resolution` pixels a side
//! (the atlas's side when none), its near plane `HlodCapture::near_plane` away. The sphere is the
//! sources' bounds as each object's are measured: its mesh's box and sphere placed by its matrix,
//! the box transformed and the sphere scaled by the matrix's largest axis (`merge::sphere`). The
//! views are laid out up along `z`, as the capture's rule is written, and swapped into the scene's
//! `y`-up axes, the second and third axes exchanged as a `y`-up scene is read into a `z`-up one.
//! Each view's pixel is one ray through its centre, as the capture draws its property images with
//! no anti-aliasing — its post-processing off, no temporal nor spatial filter runs —, each
//! surface's textures filtered over the pixel's footprint as the GPU filters them
//! (`gpu/capture.wgsl`).
use crate::hlod::flatten::units::swap_axes;
use crate::hlod::options::HlodCapture;
use trillion3d_math::vector::vec3::{cross, normalize};
use trillion3d_math::vector::vecn::{dot, length, scale, sub};

/// The views' directions, up along `z`, in the capture's order: the six axes, the upper corners
/// (looking down), the lower corners, the upper edges, the side edges.
pub(crate) const DIRECTIONS: [[f64; 3]; 22] = [
    [1.0, 0.0, 0.0],
    [-1.0, 0.0, 0.0],
    [0.0, 1.0, 0.0],
    [0.0, -1.0, 0.0],
    [0.0, 0.0, 1.0],
    [0.0, 0.0, -1.0],
    [1.0, 1.0, -1.0],
    [-1.0, 1.0, -1.0],
    [1.0, -1.0, -1.0],
    [-1.0, -1.0, -1.0],
    [1.0, 1.0, 1.0],
    [-1.0, 1.0, 1.0],
    [1.0, -1.0, 1.0],
    [-1.0, -1.0, 1.0],
    [-1.0, 0.0, -1.0],
    [1.0, 0.0, -1.0],
    [0.0, -1.0, -1.0],
    [0.0, 1.0, -1.0],
    [1.0, 1.0, 0.0],
    [-1.0, 1.0, 0.0],
    [1.0, -1.0, 0.0],
    [-1.0, -1.0, 0.0],
];

/// How much larger than the sources' sphere the views frame.
const FRAME_MARGIN: f64 = 1.25;

/// A view: its eye, and its axes — `[0]` along its sight, `[1]` its image's right, `[2]` its
/// image's up.
pub(crate) struct View {
    pub origin: [f64; 3],
    pub axes: [[f64; 3]; 3],
}

/// The views and what they share: their near plane's distance, their image's half side on that
/// plane, their image's side in pixels, and the anisotropy clamp their textures are sampled with.
pub(crate) struct Views {
    pub views: Vec<View>,
    pub near: f64,
    pub half_side: f64,
    pub side: usize,
    pub anisotropy: usize,
}

/// The axes of the view looking along `direction`, up along `z`: its sight; its image's up, the
/// world's up turned about the sight until square to it — straight up or down, the turn that
/// brings the first axis onto the sight leaves it the first axis turned away from the sight —; its
/// image's right, square to both.
fn axes(direction: [f64; 3]) -> [[f64; 3]; 3] {
    let sight = normalize(direction);
    let up = [0.0, 0.0, 1.0];
    let across = sub(up, scale(sight, dot(up, sight)));
    let image_up = if length(across) > 1e-12 {
        normalize(across)
    } else {
        [-sight[2], 0.0, 0.0]
    };
    [sight, cross(image_up, sight), image_up]
}

/// The views of the sources whose bounding sphere is `framed`, centre and radius — their objects'
/// bounds, each its mesh's placed by its matrix, gathered (`merge::sphere`) —, as `capture` sets
/// them, an atlas `atlas` texels a side naming the image side when the capture names none.
pub(crate) fn views(framed: ([f64; 3], f64), capture: &HlodCapture, atlas: usize) -> Views {
    let (middle, radius) = framed;
    let half_angle = 0.5 * capture.field_of_view.to_radians();
    let distance = radius * FRAME_MARGIN / half_angle.tan();
    let views = (DIRECTIONS.iter())
        .map(|&direction| {
            let axes = axes(direction).map(swap_axes);
            View {
                origin: sub(middle, scale(axes[0], distance)),
                axes,
            }
        })
        .collect();
    Views {
        views,
        near: capture.near_plane,
        half_side: capture.near_plane * half_angle.tan(),
        side: capture.resolution.unwrap_or(atlas),
        anisotropy: capture.anisotropy,
    }
}
