//! A skin's joints posed through a clip, frame by frame, and the bounds a plain skinned node sweeps
//! through the clips that move its skin.
//!
//! At each frame of a clip (`Clip::frames`), every node from the skin's frame down to each joint
//! (`Chain`) takes its local pose — the sampled one where the clip moves it (`sample.rs`), its
//! declared one otherwise —, and a joint's transform in the frame's space is the product of those
//! from the frame down (`each_frame`). A clip moves a skin when one of its channels drives the
//! translation, rotation or scale of one of the skin's joints (`moves`).
//!
//! A bake keeps each of those transforms as a key (`bakes.rs`). A plain skinned node, one the
//! banks do not hold, keeps only its mesh's box grown by every joint translation of every clip
//! moving its skin (`animated_bounds`): the box the world partition places it by, at its skin
//! frame's world.
use super::*;
use crate::compiler::source::node_transform::{local_matrix, Mat4};
use crate::compiler::tables::graph::node_parents;
use crate::compiler::tables::motion::frame::Chain;
use crate::compiler::tables::motion::sample::{local, rest, Clip, Posed, Trs};
use trillion3d_math::geometry::aabb::extend_flat;
use trillion3d_math::matrix::{multiply_matrix4_from_zero, IDENTITY};

/// How a node of a chain is posed through a clip: at its declared pose throughout, or at its rest
/// pose with the parts the clip drives sampled.
enum Pose<'c> {
    Still(Mat4),
    Moved(Trs, Posed<'c>),
}

/// The translation of `m`.
pub(super) fn translation(m: &Mat4) -> [f64; 3] {
    [m[12], m[13], m[14]]
}

/// Whether a channel of `animation` drives the pose of one of `joints`.
pub(super) fn moves(animation: &Value, joints: &BTreeSet<usize>) -> bool {
    let channels = animation.get("channels").and_then(Value::as_array);
    channels.into_iter().flatten().any(|channel| {
        let node = channel.pointer("/target/node").and_then(Value::as_u64);
        let path = channel.pointer("/target/path").and_then(Value::as_str);
        let poses = path.is_some_and(|path| PATHS[..POSE_PATHS].contains(&path));
        poses && node.is_some_and(|node| joints.contains(&(node as usize)))
    })
}

/// Each frame of `clip` over `chain`, in order: `visit` sees each joint's transform in the frame's
/// space, in the skin's joint order. A node the clip moves takes its sampled pose, any other its
/// declared one.
pub(super) fn each_frame(
    nodes: &[Value],
    chain: &Chain,
    clip: &Clip,
    mut visit: impl FnMut(&[Mat4]),
) -> Result<()> {
    let poses = (chain.nodes.iter())
        .map(|&(node, _)| {
            let declared = &nodes[node];
            Ok(match clip.posed(node) {
                Some(posed) => Pose::Moved(rest(declared, node)?, posed),
                None => Pose::Still(local_matrix(declared)?),
            })
        })
        .collect::<Result<Vec<_>>>()?;
    let mut framed = vec![IDENTITY; chain.nodes.len()];
    let mut joints = vec![IDENTITY; chain.joints.len()];
    for frame in 0..clip.frames() {
        let t = frame as f64 / ANIMATION_BANK_SAMPLE_RATE;
        for (at, (&(_, parent), pose)) in chain.nodes.iter().zip(&poses).enumerate() {
            let matrix = match pose {
                Pose::Still(still) => *still,
                Pose::Moved(at_rest, driven) => local(at_rest, driven, t),
            };
            framed[at] = match parent {
                Some(parent) => multiply_matrix4_from_zero(&framed[parent], &matrix),
                None => matrix,
            };
        }
        for (joint, &at) in joints.iter_mut().zip(&chain.joints) {
            *joint = framed[at];
        }
        visit(&joints);
    }
    Ok(())
}

/// Each node's parent in the input scene, none until a call that needs them reads them.
type Parents = Option<Vec<Option<usize>>>;

/// A plain skinned node's animated bounds in its skin frame's space: the mesh box grown by every
/// joint translation of every clip moving its skin (boundsScale 1), and its frame.
///
/// None when `node` of `g` — the input scene, `bin` its binary — draws no mesh through a skin, or
/// draws one with no box (`boxes`, each input mesh's, its morph targets' offsets included: none
/// when one of its primitives declares no bounds); the mesh's box alone when no animation moves a
/// joint of its skin. The scene's hierarchy is read once, into `parents` the first call that needs
/// it (none until then); each call samples the clips of its skin anew.
pub(crate) fn animated_bounds(
    g: &Value,
    bin: &[u8],
    node: usize,
    (boxes, parents): (&[Option<[f64; 6]>], &mut Parents),
) -> Result<Option<(Option<usize>, [f64; 6])>> {
    let nodes = values(g, "nodes")?;
    let declared = item(nodes, node, "node")?;
    let (Some(mesh), Some(skin)) = (index(declared, "mesh")?, index(declared, "skin")?) else {
        return Ok(None);
    };
    let Some(mut bounds) = boxes.get(mesh).copied().flatten() else {
        return Ok(None);
    };
    let joints = super::joints(item(values(g, "skins")?, skin, "skin")?, nodes.len())?;
    if parents.is_none() {
        *parents = Some(node_parents(nodes)?);
    }
    let chain = Chain::of(parents.get_or_insert_with(Vec::new), &joints);
    let joints: BTreeSet<usize> = joints.into_iter().collect();
    let animations = g.get("animations").and_then(Value::as_array);
    for (rank, animation) in animations.into_iter().flatten().enumerate() {
        if moves(animation, &joints) {
            let clip = Clip::read(g, bin, rank)?;
            each_frame(nodes, &chain, &clip, |posed| {
                posed
                    .iter()
                    .for_each(|m| extend_flat(&mut bounds, translation(m)))
            })?;
        }
    }
    Ok(Some((chain.frame, bounds)))
}
