//! Ce qu'un `UsdPreviewSurface` déclare hors de `pbrMetallicRoughness` : l'occlusion, que glTF
//! range dans sa propre carte, et les entrées auxquelles le glTF de base n'a pas de place.
//!
//! Une entrée écrite à sa valeur par défaut ne change rien à la surface : elle n'est pas un écart
//! et n'entre pas au rapport. C'est l'écart qui compte, jamais la présence de l'attribut.
use super::*;

/// L'indice de réfraction implicite d'un `UsdPreviewSurface`, et sa normale implicite : celle qui
/// laisse la surface telle que sa géométrie la donne.
const DEFAULT_IOR: f64 = 1.5;
const DEFAULT_NORMAL: [f64; 3] = [0.0, 0.0, 1.0];
/// Le canal où glTF lit l'occlusion de sa carte.
const OCCLUSION_CHANNEL: &str = "outputs:r";

/// L'occlusion texturée. glTF la lit dans le canal rouge de sa propre carte ; un autre canal de la
/// même image donnerait une occlusion lue ailleurs qu'écrite, et la carte reste portée telle quelle.
pub(super) fn occlusion(world: &mut World<'_>, shader: &usd::Prim, out: &mut Value) {
    let Some(target) = material::connection(shader, "inputs:occlusion") else {
        return;
    };
    let Some(bound) = texture::resolve(world, &target, false) else {
        return;
    };
    if !target
        .split_property()
        .is_some_and(|(_, name)| name == OCCLUSION_CHANNEL)
    {
        world.refuse(world::TEXTURE_CHANNEL);
    }
    out["occlusionTexture"] = bound.plain(world);
}

/// Ce que ce nœud de surface écarte de sa valeur par défaut et que le glTF de base ne porte pas :
/// le flux de travail spéculaire, le vernis, l'indice de réfraction, une normale écrite plutôt que
/// texturée. Rien n'est approché par une autre entrée, chacun est compté par son nom.
pub(super) fn counted(world: &mut World<'_>, shader: &usd::Prim) {
    if specular(shader) {
        world.refuse(world::SPECULAR_WORKFLOW);
    }
    if material::scalar(shader, "clearcoat").is_some_and(|coat| coat > 0.0) {
        world.refuse(world::CLEARCOAT);
    }
    if material::scalar(shader, "ior").is_some_and(|ior| ior != DEFAULT_IOR) {
        world.refuse(world::IOR);
    }
    if written_normal(shader) {
        world.refuse(world::NORMAL_VALUE);
    }
}

/// Cette surface est-elle décrite par son flux de travail spéculaire ? `useSpecularWorkflow` le
/// demande, et une couleur spéculaire écrite le dit aussi : ni l'un ni l'autre ne se ramène au
/// métal et à la rugosité de glTF sans réinventer la surface.
fn specular(shader: &usd::Prim) -> bool {
    let asked = material::scalar(shader, "useSpecularWorkflow").is_some_and(|flow| flow != 0.0);
    asked || material::value(shader, "specularColor").is_some()
}

/// Une normale écrite à la main, hors de sa valeur par défaut et sans texture pour la porter :
/// glTF n'a pas de normale constante par matériau.
fn written_normal(shader: &usd::Prim) -> bool {
    if material::connection(shader, "inputs:normal").is_some() {
        return false;
    }
    material::value(shader, "normal")
        .as_ref()
        .and_then(read::triple)
        .is_some_and(|normal| normal != DEFAULT_NORMAL)
}
