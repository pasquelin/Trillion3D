//! A clip sampled at a time, as glTF interpolates its keys and as the runtime's tracks sample them
//! (`sdk-core/src/world/animation/sample.ts`), number for number: from the last key reached, a
//! straight line to the next — a rotation on the shorter arc —, the earlier key held (`STEP`), or
//! the cubic spline of `CUBICSPLINE` through the two values and their tangents, each tangent times
//! the interval between the keys; a rotation normalized once, whatever the branch. Before the
//! first key and after the last, the clip holds them. A node's pose at that time is its rest
//! translation, rotation and scale, each part a channel drives replaced by the sampled one,
//! composed as glTF composes a node.
use super::rate::bake_rate;
use super::*;
use crate::compiler::source::node_transform::{declared_trs, local_matrix, Mat4};
use trillion3d_math::matrix::{compose_trs, linear::decompose_trs};
use trillion3d_math::quaternion::{normalize, slerp_arc, slerp_weights};
use trillion3d_math::scalar::{hermite, hermite_basis, mix};
use trillion3d_math::vector::vecn::weighted_sum;

/// A node's translation, rotation (a quaternion `x, y, z, w`) and scale.
pub(super) type Trs = ([f64; 3], [f64; 4], [f64; 3]);

/// What a clip drives on one node: the channels of its translation, rotation and scale, in
/// `PATHS` order, each none where the clip leaves that part to the node's rest pose.
pub(super) type Posed<'c> = [Option<&'c Channel>; POSE_PATHS];

/// A clip read for sampling: its channels, each read once from its sampler's accessors, the
/// channels posing each node it moves (by rank among `channels`), its duration — its last key
/// over every channel, as the runtime measures a clip — and the rate its bank samples it at
/// (`bake_rate`).
pub(super) struct Clip {
    channels: Vec<Channel>,
    posing: BTreeMap<usize, [Option<usize>; POSE_PATHS]>,
    pub duration: f64,
    pub rate: f64,
}

impl Clip {
    /// Animation `rank` of `g`, each channel posing a node checked to hold one value of its width
    /// a key — three for `CUBICSPLINE`: in-tangent, value, out-tangent — and at least one key.
    pub(super) fn read(g: &Value, bin: &[u8], rank: usize) -> Result<Self> {
        let animation = item(values(g, "animations")?, rank, "animation")?;
        let channels = super::channels(g, bin, animation, values(g, "nodes")?.len())?;
        let mut posing = BTreeMap::<usize, [Option<usize>; POSE_PATHS]>::new();
        for (at, channel) in channels.iter().enumerate() {
            if channel.path >= POSE_PATHS {
                continue;
            }
            let per_key = width(channel.path) * stride(channel.interpolation);
            let keys = channel.times.len();
            if keys == 0 || channel.values.len() != keys * per_key {
                return Err(invalid(format!(
                    "animation {rank} channel {at}: {} values for {keys} keys of {}",
                    channel.values.len(),
                    PATHS[channel.path]
                )));
            }
            posing.entry(channel.node).or_default()[channel.path] = Some(at);
        }
        let last = channels.iter().filter_map(|channel| channel.times.last());
        let duration = last.map(|&time| f64::from(time)).fold(0.0, f64::max);
        Ok(Self {
            channels,
            posing,
            duration,
            rate: bake_rate(duration),
        })
    }

    /// The frames a bank samples it at: its `rate` a second over its duration, rounded, at least
    /// one; frame `f` at `f / rate` seconds.
    pub(super) fn frames(&self) -> usize {
        ((self.duration * self.rate).round() as usize).max(1)
    }

    /// What it drives on `node`, none when it moves nothing of its pose.
    pub(super) fn posed(&self, node: usize) -> Option<Posed<'_>> {
        let ranks = self.posing.get(&node)?;
        Some(ranks.map(|rank| rank.map(|at| &self.channels[at])))
    }
}

/// Numbers a key of path `path` holds: four for a rotation, three for a translation or a scale.
fn width(path: usize) -> usize {
    if path == ROTATION_PATH {
        4
    } else {
        3
    }
}

/// Values a key holds per number: in-tangent, value and out-tangent for a cubic spline, the value
/// alone otherwise.
fn stride(interpolation: Interpolation) -> usize {
    match interpolation {
        Interpolation::CubicSpline => 3,
        Interpolation::Linear | Interpolation::Step => 1,
    }
}

/// `channel`'s value at `t` seconds, its first `width(channel.path)` numbers (the others 0), by
/// `sample.ts`'s steps: the last key at or before `t` — the first before it —, the next, the
/// share of the interval between them `t` lies at, clamped to it; that key's value for a step or a
/// share of zero, else the spline, the arc or the line; a rotation normalized after.
fn sampled(channel: &Channel, t: f64) -> [f64; 4] {
    let (times, values) = (&channel.times, &channel.values);
    let last = times.len() - 1;
    let i = (times.partition_point(|&key| f64::from(key) <= t))
        .saturating_sub(1)
        .min(last);
    let j = (i + 1).min(last);
    let start = f64::from(times[i]);
    let span = f64::from(times[j]) - start;
    let w = if span > 0.0 {
        ((t - start) / span).clamp(0.0, 1.0)
    } else {
        0.0
    };
    let size = width(channel.path);
    let cubic = channel.interpolation == Interpolation::CubicSpline;
    let row = size * stride(channel.interpolation);
    // Key `k`'s numbers from `offset` in its row: the in-tangent at 0, a spline's value at `size`
    // and its out-tangent at `2 · size`.
    let key = |k: usize, offset: usize| -> [f64; 4] {
        std::array::from_fn(|c| {
            if c < size {
                f64::from(values[k * row + offset + c])
            } else {
                0.0
            }
        })
    };
    let value = if cubic { size } else { 0 };
    let rotation = channel.path == ROTATION_PATH;
    let mut out = if channel.interpolation == Interpolation::Step || w == 0.0 {
        key(i, value)
    } else if cubic {
        let basis = hermite_basis(w);
        let (p0, m0, p1, m1) = (key(i, size), key(i, 2 * size), key(j, size), key(j, 0));
        std::array::from_fn(|c| hermite(basis, span, [p0[c], m0[c], p1[c], m1[c]]))
    } else if rotation {
        let (a, b) = (key(i, 0), key(j, 0));
        weighted_sum([a, b], slerp_weights(w, slerp_arc(a, b)))
    } else {
        let (a, b) = (key(i, 0), key(j, 0));
        std::array::from_fn(|c| mix(a[c], b[c], w))
    };
    if rotation {
        normalize(&mut out);
    }
    out
}

/// The rest pose of `node`, rank `rank`, a clip moves: its translation, rotation and scale, or the
/// ones its matrix is made of — which glTF forbids on a node an animation targets, and which the
/// runtime decomposes all the same —; refused when that matrix is no such triple.
pub(super) fn rest(node: &Value, rank: usize) -> Result<Trs> {
    if node.get("matrix").is_none() {
        return declared_trs(node);
    }
    decompose_trs(&local_matrix(node)?).ok_or_else(|| {
        invalid(format!(
            "node {rank}: an animation moves it, and its matrix is no translation, rotation and scale"
        ))
    })
}

/// The local pose at `t` seconds of a node at rest in `rest` that `posed` drives.
pub(super) fn local((translation, rotation, scale): &Trs, posed: &Posed, t: f64) -> Mat4 {
    let [moved, turned, scaled] = posed.map(|channel| channel.map(|channel| sampled(channel, t)));
    let three = |part: Option<[f64; 4]>, rest: [f64; 3]| part.map_or(rest, |v| [v[0], v[1], v[2]]);
    compose_trs(
        three(moved, *translation),
        turned.unwrap_or(*rotation),
        three(scaled, *scale),
    )
}
