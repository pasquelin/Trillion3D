//! The simplified mesh's vertex colours, as the method carries the sources' onto it
//! (`allowVertexColors`): each vertex white, unless the source triangle nearest it (`Nearest`) holds
//! its projection — then the triangle's corner colours, each kept as an sRGB byte (`rounded`),
//! blended at the projection's weights, set back to the corners' mean luminance when both that and
//! the blend's pass a hundred-thousandth. A colour depends on its vertex's position alone: vertices
//! that share a position share it.
use super::colour::{linear, luminance, srgb};
use crate::hlod::flatten::simplify::nearest::{blend, missed, weights, Nearest};
use rayon::prelude::*;
use trillion3d_math::vector::vecn::scale;

/// The colour of a vertex no source answers.
const WHITE: [f32; 4] = [1.0; 4];

/// The luminance a colour must pass for its luminance to be set.
const LEAST: f32 = 1e-5;

/// Linear colour `c` as the method holds a corner's colour: an sRGB byte a channel, read back.
fn rounded(c: [f32; 4]) -> [f32; 4] {
    linear(srgb(c))
}

/// The colour of the vertex at `p`, in the method's frame (module doc).
fn colour(nearest: &Nearest, p: [f32; 3]) -> [f32; 4] {
    let (t, found) = nearest.at(p);
    if !found {
        return WHITE;
    }
    let w = weights(nearest.sources.corners(t), p);
    if missed(w) {
        return WHITE;
    }
    let corners = nearest.sources.corner_colours(t).map(rounded);
    let colour = blend(w, corners);
    let mean = (luminance(corners[0]) + luminance(corners[1]) + luminance(corners[2])) / 3.0;
    let blended = luminance(colour);
    match blended > LEAST && mean > LEAST {
        true => scale(colour, mean / blended),
        false => colour,
    }
}

/// The colours of the vertices `points`, in the method's frame, four floats each, end to end
/// (module doc).
pub(in crate::hlod::flatten::simplify) fn vertex_colours(
    nearest: &Nearest,
    points: &[[f32; 3]],
) -> Vec<f32> {
    points
        .par_iter()
        .flat_map_iter(|&p| colour(nearest, p))
        .collect()
}
