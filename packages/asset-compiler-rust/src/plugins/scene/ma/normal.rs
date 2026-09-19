//! A Maya shader's normal: what `normalCamera` receives, and what glTF carries of it.
//!
//! Maya wires a `bump2d` onto `normalCamera`, and that node reads its image in two ways that the
//! bytes do not distinguish: `bumpInterp` says which. Zero is a **height bump**, whose value is an
//! altitude Maya derives to light; one is a **tangent-space normal map**, the one glTF's
//! `normalTexture` expects; two is object-space normals, which would need reprojecting by the
//! surface pose. Only the tangent mode therefore passes through: attaching a height to
//! `normalTexture` lights the surface from an image that says nothing about its orientation, a
//! mistake nothing later can recover.
use super::*;

/// The `bumpInterp` mode for tangent-space normals, and the one for object-space normals.
const TANGENT: f64 = 1.0;
const OBJECT: f64 = 2.0;

/// The normal texture wired onto `normalCamera`, when there is one. A `bump2d`'s image is its
/// `bumpValue` input; any other source is read as a direct texture.
pub(super) fn through_bump(world: &mut World<'_>, shader: usize) -> Option<Value> {
    let (document, graph) = (world.document, world.graph);
    let (source, _) = graph.input(shader, &["n", "normalCamera"])?;
    let node = &document.nodes[source];
    if node.kind != "bump2d" {
        return texture::of(world, source);
    }
    let interp = node
        .attr(&["bi", "bumpInterp"])
        .and_then(Attr::scalar)
        .unwrap_or_default();
    if interp != TANGENT {
        world.refuse(match interp == OBJECT {
            true => report::BUMP_OBJECT,
            false => report::BUMP_HEIGHT,
        });
        return None;
    }
    let mut texture = texture::connected(world, source, &["bv", "bumpValue"])?;
    // `bumpDepth` is the bump strength, and `scale` is that of `normalTexture`: same quantity,
    // same place in the product, so it passes through as-is.
    let depth = node
        .attr(&["bd", "bumpDepth"])
        .and_then(Attr::scalar)
        .unwrap_or(1.0);
    if depth != 1.0 {
        texture["scale"] = json!(depth);
    }
    Some(texture)
}
