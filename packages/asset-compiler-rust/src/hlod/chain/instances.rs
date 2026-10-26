//! The objects the world's HLOD layers take, one `Instance` per primitive of each (`gather`): only
//! the objects in a layer — no other is decoded, estimated, approximated nor baked.
//!
//! An instanced skinned object's HLOD 0 actor is its own cell rows, playing its track; a merge, a
//! shell or voxels take no skinned object, so no actor above it is built of one — unless the
//! object is marked to stand as itself (`hlodInstance`): it is then a row of every actor above, at
//! its skin frame's world, playing its track, as the reference batches such a component whatever
//! the builder of its layer.
use super::{Instance, SourceCover};
use crate::compiler::tables::partition::CellMembers;
use crate::proxy::placement::Placement;
use crate::*;
use trillion3d_math::matrix::IDENTITY;

/// The instances of the objects `cells` places in a layer, each node's primitives in the order
/// `placement` lists them: its HLOD 0 cell, its material from `primitives`, its world matrix —
/// its skin frame's for an instanced skinned object — and its cover from `covers`. `nodes` is the
/// published scene's, `source` the input scene whose `extras` mark the objects that stand as
/// themselves. `Err` when a mark is not a switch.
pub(super) fn gather<'a>(
    cells: &CellMembers,
    (nodes, source): (&[Value], &Value),
    (primitives, covers, placement): (&[Value], &'a [SourceCover], &Placement),
    fallbacks: &BTreeMap<u64, u64>,
) -> Result<Vec<Instance<'a>>> {
    let Placement { world, by_mesh } = placement;
    let mut instances = Vec::new();
    let assigned =
        (cells.nodes.iter().zip(&cells.hlod)).filter_map(|(members, &leaf)| Some((members, leaf?)));
    for (members, hlod) in assigned {
        for &node in members {
            let Some(mesh) = nodes.get(node).and_then(|n| n["mesh"].as_u64()) else {
                continue;
            };
            let instanced = crate::hlod::options::instanced(source, node)?;
            let banked = cells.banked.get(&node);
            if banked.is_some() && !instanced {
                continue;
            }
            let (matrix, track) = match banked {
                Some(&(item, frame)) => (frame.map_or(IDENTITY, |f| world[f]), Some(item)),
                None => (world[node], None),
            };
            for &primitive in by_mesh.get(&mesh).into_iter().flatten() {
                instances.push(Instance {
                    hlod,
                    material: primitives[primitive]["material"].as_u64(),
                    matrix,
                    cover: &covers[primitive],
                    instanced,
                    node,
                    mesh,
                    track,
                    fallback: fallbacks.get(&mesh).copied().filter(|_| track.is_none()),
                });
            }
        }
    }
    Ok(instances)
}
