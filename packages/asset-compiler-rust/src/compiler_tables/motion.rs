//! What moves in the prepared scene: the skins its meshes bend by — the joints, in node
//! ranks, and each joint's inverse bind matrix — and the animation clips it plays, each channel's
//! key times and values written out as numbers. The runtime builds its skeletons and clips from
//! these without reading the scene's binary, which stays on the server until a vertex is needed.
use super::*;

/// The paths an animation channel may drive, as glTF names them.
const PATHS: [&str; 4] = ["translation", "rotation", "scale", "weights"];

/// A float as the shortest decimal that reads back to the same `f32`.
fn short(value: f32) -> Value {
    let text = value.to_string();
    json!(text.parse::<f64>().unwrap_or(f64::from(value)))
}

fn floats(g: &Value, bin: &[u8], id: &Value, name: &str) -> Result<Vec<Value>> {
    let values = accessor(g, bin, required_index(Some(id), name)?, None)?.collect_f32()?;
    Ok(values.into_iter().map(short).collect())
}

/// A node rank `name` holds, refused past the node count.
fn node(value: Option<&Value>, name: &str, nodes: usize) -> Result<usize> {
    let rank = required_index(value, name)?;
    if rank >= nodes {
        return Err(invalid(format!("{name} index is out of bounds")));
    }
    Ok(rank)
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
            let joints = values(skin, "joints")?
                .iter()
                .map(|joint| node(Some(joint), "skin.joints", nodes))
                .collect::<Result<Vec<_>>>()?;
            let skeleton = match skin.get("skeleton") {
                Some(root) => Some(node(Some(root), "skin.skeleton", nodes)?),
                None => None,
            };
            let matrices = match skin.get("inverseBindMatrices") {
                Some(id) => Some(floats(g, bin, id, "skin.inverseBindMatrices")?),
                None => None,
            };
            if matrices
                .as_ref()
                .is_some_and(|m| m.len() != joints.len() * 16)
            {
                return Err(invalid(
                    "skin.inverseBindMatrices count differs from its joints",
                ));
            }
            Ok(
                json!({"name": skin.get("name").and_then(Value::as_str).unwrap_or(""),
                "joints": joints, "skeleton": skeleton, "inverseBindMatrices": matrices}),
            )
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
            let samplers = values(animation, "samplers")?;
            let channels = values(animation, "channels")?.iter().filter_map(|channel| {
                // A channel with no node drives something outside the node graph: nothing to play.
                let target = channel.pointer("/target/node")?;
                Some(clip_channel(g, bin, samplers, channel, target, nodes))
            });
            let channels = channels.collect::<Result<Vec<_>>>()?;
            let name = animation.get("name").and_then(Value::as_str).unwrap_or("");
            Ok(json!({"name": name, "channels": channels}))
        })
        .collect()
}

fn clip_channel(
    g: &Value,
    bin: &[u8],
    samplers: &[Value],
    channel: &Value,
    target: &Value,
    nodes: usize,
) -> Result<Value> {
    let path = channel
        .pointer("/target/path")
        .and_then(Value::as_str)
        .unwrap_or("");
    if !PATHS.contains(&path) {
        return Err(invalid(format!("animation path {path:?} is not a node's")));
    }
    let sampler = item(
        samplers,
        required_index(channel.get("sampler"), "channel.sampler")?,
        "sampler",
    )?;
    let interpolation = sampler
        .get("interpolation")
        .and_then(Value::as_str)
        .unwrap_or("LINEAR");
    if !matches!(interpolation, "LINEAR" | "STEP" | "CUBICSPLINE") {
        return Err(invalid(format!(
            "interpolation {interpolation:?} is not glTF's"
        )));
    }
    let times = floats(g, bin, required(sampler, "input")?, "sampler.input")?;
    let values = floats(g, bin, required(sampler, "output")?, "sampler.output")?;
    Ok(
        json!({"node": node(Some(target), "channel.target.node", nodes)?, "path": path,
        "interpolation": interpolation, "times": times, "values": values}),
    )
}

fn required<'a>(owner: &'a Value, field: &str) -> Result<&'a Value> {
    owner
        .get(field)
        .ok_or_else(|| invalid(format!("sampler.{field} is required")))
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
