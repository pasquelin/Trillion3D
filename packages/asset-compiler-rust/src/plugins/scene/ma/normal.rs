//! La normale d'un nuanceur de Maya : ce que `normalCamera` reçoit, et ce que glTF en porte.
//!
//! Maya branche un `bump2d` sur `normalCamera`, et ce nœud lit son image de deux façons que rien ne
//! distingue dans les octets : `bumpInterp` le dit. Zéro fait un **relief de hauteur**, dont la
//! valeur est une altitude que Maya dérive pour éclairer ; un fait une **carte de normales en
//! espace tangent**, celle que `normalTexture` de glTF attend ; deux fait des normales en espace
//! objet, qu'il faudrait reprojeter par la pose de la surface. Seul le mode tangent passe donc tel
//! quel : accrocher une hauteur à `normalTexture` éclaire la surface par une image qui ne dit rien
//! de son orientation, et c'est une faute que rien ne rattrape ensuite.
use super::*;

/// Le mode `bumpInterp` des normales en espace tangent, et celui des normales en espace objet.
const TANGENT: f64 = 1.0;
const OBJECT: f64 = 2.0;

/// La texture de normales branchée sur `normalCamera`, quand il y en a une. L'image d'un `bump2d`
/// est son entrée `bumpValue` ; toute autre source est lue comme une texture directe.
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
    // `bumpDepth` est la force du relief, et `scale` est celle de `normalTexture` : même grandeur,
    // même place dans le produit, donc elle passe telle quelle.
    let depth = node
        .attr(&["bd", "bumpDepth"])
        .and_then(Attr::scalar)
        .unwrap_or(1.0);
    if depth != 1.0 {
        texture["scale"] = json!(depth);
    }
    Some(texture)
}
