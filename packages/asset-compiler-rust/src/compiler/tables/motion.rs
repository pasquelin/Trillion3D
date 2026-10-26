//! What moves in the prepared scene: the skins its meshes bend by — the joints, in node
//! ranks, and each joint's inverse bind matrix — and the animation clips it plays, each channel's
//! key times and values written out as numbers. The runtime builds its skeletons and clips from
//! these without reading the scene's binary, which stays on the server until a vertex is needed.
//!
//! Its folder holds what the scene's instanced skinned objects play instead: a clip sampled at a
//! time (`sample.rs`), a skin's frame and the nodes from it down to each joint (`frame.rs`), and
//! the animation banks baked from them (`bank.rs`).
use super::*;

pub(crate) mod bank;
mod frame;
mod rate;
mod sample;

/// The paths an animation channel may drive, as glTF names them: the first `POSE_PATHS` a node's
/// pose — its translation, rotation and scale, in the order glTF composes them —, then its mesh's
/// morph weights.
const PATHS: [&str; 4] = ["translation", "rotation", "scale", "weights"];
/// How many paths of `PATHS`, from the first, pose a node.
const POSE_PATHS: usize = 3;
/// The rank in `PATHS` of a node's rotation, whose keys hold four numbers where a translation's
/// and a scale's hold three.
const ROTATION_PATH: usize = 1;

/// How a sampler goes from one key to the next, glTF's `interpolation`: a straight line, the
/// earlier key held, or a cubic spline through each key's value and tangents.
#[derive(Clone, Copy, Debug, PartialEq)]
enum Interpolation {
    Linear,
    Step,
    CubicSpline,
}

/// Each interpolation and the name glTF gives it, in the order `Interpolation` declares them, the
/// default first.
const INTERPOLATIONS: [(&str, Interpolation); 3] = [
    ("LINEAR", Interpolation::Linear),
    ("STEP", Interpolation::Step),
    ("CUBICSPLINE", Interpolation::CubicSpline),
];

impl Interpolation {
    /// The name glTF gives it, at its rank in `INTERPOLATIONS`.
    fn name(self) -> &'static str {
        INTERPOLATIONS[self as usize].0
    }
}

/// One channel of a clip as its sampler declares it: the node it moves, the rank in `PATHS` of
/// what it drives, its interpolation, its key times in seconds and its values — `CUBICSPLINE` ones
/// as the specification lays them, in-tangent, value, out-tangent per key —, read once from the
/// sampler's accessors.
struct Channel {
    node: usize,
    path: usize,
    interpolation: Interpolation,
    times: Vec<f32>,
    values: Vec<f32>,
}

/// A float as the shortest decimal that reads back to the same `f32`.
fn short(value: f32) -> Value {
    let text = value.to_string();
    json!(text.parse::<f64>().unwrap_or(f64::from(value)))
}

/// The floats accessor `id` holds, `name` naming it in a refusal.
fn f32s(g: &Value, bin: &[u8], id: &Value, name: &str) -> Result<Vec<f32>> {
    accessor(g, bin, required_index(Some(id), name)?, None)?.collect_f32()
}

/// `values` written out as numbers, each its shortest decimal (`short`).
fn shorts(values: &[f32]) -> Vec<Value> {
    values.iter().copied().map(short).collect()
}

/// The joints of `skin`, as ranks among the document's `nodes` nodes.
fn joints(skin: &Value, nodes: usize) -> Result<Vec<usize>> {
    (values(skin, "joints")?.iter())
        .map(|joint| bounded(joint, "skin.joints", nodes))
        .collect()
}

/// The inverse bind matrices of `skin`, whose joints are `joints` — sixteen floats a joint,
/// column-major —, none for identities; refused when their count is not its joints'.
fn inverse_binds(g: &Value, bin: &[u8], skin: &Value, joints: usize) -> Result<Option<Vec<f32>>> {
    let matrices = match skin.get("inverseBindMatrices") {
        Some(id) => Some(f32s(g, bin, id, "skin.inverseBindMatrices")?),
        None => None,
    };
    if matrices.as_ref().is_some_and(|m| m.len() != joints * 16) {
        return Err(invalid(
            "skin.inverseBindMatrices count differs from its joints",
        ));
    }
    Ok(matrices)
}

/// Every skin of the document: its name, its joints and skeleton root as node ranks, and its
/// inverse bind matrices — sixteen numbers a joint, column-major — or `null` for identities.
pub(super) fn skin_table(g: &Value, bin: &[u8]) -> Result<Vec<Value>> {
    let nodes = values(g, "nodes")?.len();
    let skins = g
        .get("skins")
        .and_then(Value::as_array)
        .into_iter()
        .flatten();
    skins
        .map(|skin| {
            let joints = joints(skin, nodes)?;
            let skeleton = match skin.get("skeleton") {
                Some(root) => Some(bounded(root, "skin.skeleton", nodes)?),
                None => None,
            };
            let matrices = inverse_binds(g, bin, skin, joints.len())?.map(|m| shorts(&m));
            Ok(json!({"name": name_of(skin),
                "joints": joints, "skeleton": skeleton, "inverseBindMatrices": matrices}))
        })
        .collect()
}

/// Every animation of the document, each channel with the node it moves, the path it drives, its
/// interpolation and its keys: times in seconds, then the values, `CUBICSPLINE` ones as the
/// specification lays them — in-tangent, value, out-tangent per key.
pub(super) fn animation_table(g: &Value, bin: &[u8]) -> Result<Vec<Value>> {
    let nodes = values(g, "nodes")?.len();
    let animations = g
        .get("animations")
        .and_then(Value::as_array)
        .into_iter()
        .flatten();
    animations
        .map(|animation| {
            let channels: Vec<Value> = (channels(g, bin, animation, nodes)?.iter())
                .map(|channel| {
                    json!({"node": channel.node, "path": PATHS[channel.path],
                    "interpolation": channel.interpolation.name(),
                    "times": shorts(&channel.times), "values": shorts(&channel.values)})
                })
                .collect();
            Ok(json!({"name": name_of(animation), "channels": channels}))
        })
        .collect()
}

/// The channels of `animation` that move a node of the document's `nodes`, in its order, each
/// read once from its sampler (`clip_channel`): the one reading of a clip, the animation table's
/// and the banks'.
fn channels(g: &Value, bin: &[u8], animation: &Value, nodes: usize) -> Result<Vec<Channel>> {
    let samplers = values(animation, "samplers")?;
    let channels = values(animation, "channels")?.iter().filter_map(|channel| {
        // A channel with no node drives something outside the node graph: nothing to play.
        let target = channel.pointer("/target/node")?;
        Some(clip_channel(g, bin, samplers, channel, target, nodes))
    });
    channels.collect()
}

fn clip_channel(
    g: &Value,
    bin: &[u8],
    samplers: &[Value],
    channel: &Value,
    target: &Value,
    nodes: usize,
) -> Result<Channel> {
    let path = channel
        .pointer("/target/path")
        .and_then(Value::as_str)
        .unwrap_or("");
    let Some(path) = PATHS.iter().position(|named| *named == path) else {
        return Err(invalid(format!("animation path {path:?} is not a node's")));
    };
    let sampler = item(
        samplers,
        required_index(channel.get("sampler"), "channel.sampler")?,
        "sampler",
    )?;
    let interpolation = sampler
        .get("interpolation")
        .and_then(Value::as_str)
        .unwrap_or(INTERPOLATIONS[0].0);
    let named = INTERPOLATIONS
        .iter()
        .find(|(name, _)| *name == interpolation);
    let Some(&(_, interpolation)) = named else {
        return Err(invalid(format!(
            "interpolation {interpolation:?} is not glTF's"
        )));
    };
    let times = f32s(g, bin, required(sampler, "input")?, "sampler.input")?;
    let values = f32s(g, bin, required(sampler, "output")?, "sampler.output")?;
    Ok(Channel {
        node: bounded(target, "channel.target.node", nodes)?,
        path,
        interpolation,
        times,
        values,
    })
}

fn required<'a>(owner: &'a Value, field: &str) -> Result<&'a Value> {
    owner
        .get(field)
        .ok_or_else(|| invalid(format!("sampler.{field} is required")))
}

/// The nodes a channel of an animation targets, whatever it drives: their pose, or what hangs
/// under them, is not the one the table declares.
pub(crate) fn moved(g: &Value) -> BTreeSet<usize> {
    let animations = g["animations"].as_array().into_iter().flatten();
    let channels = animations.flat_map(|a| a["channels"].as_array().into_iter().flatten());
    let node = |c: &Value| Some(c.pointer("/target/node")?.as_u64()? as usize);
    channels.filter_map(node).collect()
}

/// The node ranks a skin or an animation names, renumbered through `rank` — the node table's
/// renumbering once the partition took the placed nodes out, which never takes one of these.
pub(super) fn renumber(skins: &mut [Value], animations: &mut [Value], rank: &[Option<usize>]) {
    let map = |value: &mut Value| {
        if let Some(id) = value.as_u64() {
            *value = json!(rank[id as usize]);
        }
    };
    for skin in skins.iter_mut() {
        skin["joints"]
            .as_array_mut()
            .into_iter()
            .flatten()
            .for_each(map);
        map(&mut skin["skeleton"]);
    }
    let channels = animations
        .iter_mut()
        .flat_map(|a| a["channels"].as_array_mut());
    for channel in channels.flatten() {
        map(&mut channel["node"]);
    }
}
