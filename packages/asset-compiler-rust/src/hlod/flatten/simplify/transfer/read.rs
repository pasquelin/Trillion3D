//! What a texel of the fine grid reads of the sources' flattened materials, as the method samples
//! them: a hit's coordinates in its source's images — the source triangle's corners' coordinates
//! blended by the hit's weights, a point outside the unit square read at its origin —, and there
//! an image of more than one texel read bilinearly between the four texels around the point, each
//! held inside the image, an image of one texel that texel, a missing one black (`colour`).
//!
//! The normal a hit reads (`normal`) is a world direction: the source's corners' normals blended at
//! the hit and made unit, bent by its normal map where it has one — the map's value unpacked and
//! made unit at each of the four texels, then blended — over the frame the engine rebuilds from the
//! source triangle's coordinates in its images (`merge::cotangent`, in our frame): the map's
//! `x` along the frame's tangent, `−y` along its bitangent, `z` along the normal.
use super::rays::Answer;
use super::Flattened;
use crate::hlod::flatten::merge::{cotangent, Image};
use crate::hlod::flatten::simplify::nearest::{blend, normalize, SMALL};
use crate::hlod::flatten::simplify::sources::Sources;
use crate::hlod::flatten::units::{from_frame, swap_axes};
use trillion3d_math::vector::vecn::{add, scale, sub};

/// The value in the first channel of a texel no triangle maps to, which no down sampling reads:
/// the least float.
pub(super) const UNREAD: f32 = f32::MIN;

/// The texel an image missing a property reads: opaque black.
const BLACK: [u8; 4] = [0, 0, 0, 255];

/// Where source triangle `source` of `sources`, at weights `w`, reads its images (module doc).
fn coordinates(sources: &Sources, source: usize, w: [f64; 3]) -> [f64; 2] {
    let laid = sources.laid[source];
    let uv: [f64; 2] =
        std::array::from_fn(|k| w[0] * laid[0][k] + w[1] * laid[1][k] + w[2] * laid[2][k]);
    match uv[0] > 1.0 || uv[0] < 0.0 || uv[1] > 1.0 || uv[1] < 0.0 {
        true => [0.0; 2],
        false => uv,
    }
}

/// `image` at `uv` read bilinearly, each of the four texels around it held inside the image and
/// read through `read`, each weight narrowed to single precision as it multiplies.
fn bilinear<const N: usize>(
    image: &Image,
    [u, v]: [f64; 2],
    read: &impl Fn([u8; 4]) -> [f32; N],
) -> [f32; N] {
    let (width, height) = (image.width as i32, image.height as i32);
    let at = [u * f64::from(width), v * f64::from(height)];
    let low = at.map(|x| x.floor() as i32);
    let delta = [0, 1].map(|k| at[k] - f64::from(low[k] as f32));
    let texel = |dx: i32, dy: i32| {
        let x = (low[0] + dx).clamp(0, width - 1);
        let y = (low[1] + dy).clamp(0, height - 1);
        read(image.texels[(y * width + x) as usize])
    };
    let (near, far) = (delta.map(|d| (1.0 - d) as f32), delta.map(|d| d as f32));
    let corners = [
        scale(scale(texel(0, 0), near[0]), near[1]),
        scale(scale(texel(1, 0), far[0]), near[1]),
        scale(scale(texel(0, 1), near[0]), far[1]),
        scale(scale(texel(1, 1), far[0]), far[1]),
    ];
    add(add(add(corners[0], corners[1]), corners[2]), corners[3])
}

/// What a texel answered `answer` reads of the image `image_of` takes from its source's flattened
/// material, each texel through `read` (module doc): a texel no triangle maps to `UNREAD`, one no
/// source answers `missed`.
pub(super) fn colour<const N: usize>(
    answer: &Answer,
    (sources, flattened): (&Sources, &[Flattened]),
    missed: [f32; N],
    (image_of, read): (
        impl Fn(&Flattened) -> Option<&Image>,
        impl Fn([u8; 4]) -> [f32; N],
    ),
) -> [f32; N] {
    let (source, weights) = match *answer {
        Answer::Outside => return std::array::from_fn(|c| if c == 0 { UNREAD } else { 0.0 }),
        Answer::Missed => return missed,
        Answer::Hit { source, weights } => (source as usize, weights),
    };
    let uv = coordinates(sources, source, weights);
    let image = image_of(&flattened[sources.sets[source] as usize]);
    match image.filter(|i| !i.texels.is_empty()) {
        Some(image) if image.texels.len() > 1 => bilinear(image, uv, &read),
        Some(image) => read(image.texels[0]),
        None => read(BLACK),
    }
}

/// A normal map's texel as a direction: each channel over 255, twice, less one, made unit.
fn unpacked(texel: [u8; 4]) -> [f32; 3] {
    let mut m = [0, 1, 2].map(|c| f32::from(texel[c]) / 255.0 * 2.0 - 1.0);
    normalize(&mut m, SMALL);
    m
}

/// The world normal, in the method's frame, a texel answered `answer` reads (module doc); none for
/// a texel no source answers.
pub(super) fn normal(
    answer: &Answer,
    (sources, flattened): (&Sources, &[Flattened]),
) -> Option<[f32; 3]> {
    let Answer::Hit { source, weights } = *answer else {
        return None;
    };
    let source = source as usize;
    let mut n = blend(weights, sources.corner_normals(source));
    normalize(&mut n, SMALL);
    let set = &flattened[sources.sets[source] as usize];
    let Some(map) = set.normal.as_ref().filter(|m| m.texels.len() > 1) else {
        return Some(n);
    };
    let m = bilinear(map, coordinates(sources, source, weights), &unpacked).map(f64::from);
    let corners = sources
        .corners(source)
        .map(|c| from_frame(c).map(f64::from));
    let laid = sources.laid[source];
    let edges = (sub(corners[1], corners[0]), sub(corners[2], corners[0]));
    let up = swap_axes(n).map(f64::from);
    let [t, b] = cotangent(up, edges, (sub(laid[1], laid[0]), sub(laid[2], laid[0])));
    let world = add(sub(scale(t, m[0]), scale(b, m[1])), scale(up, m[2]));
    Some(swap_axes(world.map(|x| x as f32)))
}
