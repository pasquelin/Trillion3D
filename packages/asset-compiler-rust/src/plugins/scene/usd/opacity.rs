//! La transparence d'un `UsdPreviewSurface`, telle que glTF la porte : un facteur d'alpha, un mode,
//! et parfois un seuil de découpe.
//!
//! Rien ici ne regarde le type de l'objet ni le nom de la scène : la découpe vient de
//! `opacityThreshold`, le mélange d'une opacité inférieure à un ou d'une image qui la porte, et
//! c'est tout. glTF ne lit l'opacité d'une image que dans l'alpha de `baseColorTexture` : une
//! `opacity` branchée sur cette texture-là passe telle quelle, une autre image ne s'y ramène pas
//! sans en recomposer une troisième, ce qui serait inventer des octets.
use super::*;

/// Le canal où glTF lit l'opacité d'une image : l'alpha de la texture de couleur de base, et lui
/// seul. Un autre canal de la même image ne s'y range pas sans recomposer des octets.
const ALPHA_CHANNEL: &str = "outputs:a";

/// Ce que l'opacité de la surface a donné : le facteur qui entre dans `baseColorFactor`, et si
/// l'alpha d'une image le module encore.
#[derive(Clone, Copy)]
pub(super) struct Opacity {
    pub(super) factor: f64,
    textured: bool,
}

/// L'opacité de la surface, connaissant la connexion de `diffuseColor` et le `pbrMetallicRoughness`
/// déjà rempli. Une entrée connectée l'emporte sur la valeur écrite : quand l'alpha de la texture
/// de couleur de base porte l'opacité, le facteur vaut un et laisse passer l'image.
pub(super) fn of(
    world: &mut World<'_>,
    shader: &usd::Prim,
    pbr: &Value,
    diffuse: Option<&sdf::Path>,
) -> Opacity {
    let factor = material::scalar(shader, "opacity").unwrap_or(1.0);
    let written = Opacity {
        factor,
        textured: false,
    };
    let Some(target) = material::connection(shader, "inputs:opacity") else {
        return written;
    };
    let carried = diffuse.map(sdf::Path::prim_path) == Some(target.prim_path())
        && pbr.get("baseColorTexture").is_some();
    if !carried {
        world.refuse(world::OPACITY_TEXTURE);
        return written;
    }
    // L'image est bien celle que glTF portera ; reste le canal, car glTF n'en lit qu'un. Un autre
    // canal de cette image donnerait une transparence lue ailleurs qu'écrite : la valeur reprend.
    if !target
        .split_property()
        .is_some_and(|(_, name)| name == ALPHA_CHANNEL)
    {
        world.refuse(world::TEXTURE_CHANNEL);
        return written;
    }
    Opacity {
        factor: 1.0,
        textured: true,
    }
}

/// Le mode de transparence de ce matériau.
pub(super) fn mode(shader: &usd::Prim, opacity: Opacity) -> &'static str {
    if cutoff(shader).is_some() {
        return "MASK";
    }
    match opacity.textured || opacity.factor < 1.0 {
        true => "BLEND",
        false => "OPAQUE",
    }
}

/// Le seuil de découpe, quand la surface en déclare un qui découpe vraiment.
pub(super) fn cutoff(shader: &usd::Prim) -> Option<f64> {
    material::scalar(shader, "opacityThreshold").filter(|threshold| *threshold > 0.0)
}
