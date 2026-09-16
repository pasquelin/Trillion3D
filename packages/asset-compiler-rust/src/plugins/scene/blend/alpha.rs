//! La transparence d'un matériau Blender, telle que le glTF la porte : un facteur, un mode, et
//! parfois un seuil de découpe.
//!
//! Rien ici ne regarde le type de l'objet ni le nom de la scène. Le facteur vient de l'entrée
//! `Alpha` du nuanceur ; l'image qui la porte ne passe que si c'est le canal alpha de l'image que
//! la couleur de base porte déjà, car glTF ne lit l'opacité que là. Une autre image, un autre canal
//! ou un calcul ne s'y ramènent pas sans recomposer des octets : ils sont comptés par leur nom, et
//! la valeur déclarée reprend la main, exacte.
//!
//! Le mode, lui, dépend de l'âge du fichier. Jusqu'à Blender 4.1, le matériau déclarait son mode de
//! mélange, découpe comprise, et le glTF le reprend tel quel. Depuis 4.2, le champ qui décrit le
//! rendu de surface remplace cette déclaration : il n'y a plus de découpe, et c'est l'alpha seul
//! qui dit si la surface se mélange. C'est le SDNA du fichier qui dit lequel des deux cas
//! s'applique, jamais un numéro de version écrit ici.
use super::*;

/// Le canal de l'image que glTF lit comme opacité : l'alpha de la texture de couleur de base.
const ALPHA_CHANNEL: &str = "Alpha";
/// Le champ par lequel Blender 4.2 et au-delà décrivent leur rendu de surface.
const RENDER_METHOD: &str = "surface_render_method";
/// Les modes de mélange qu'un fichier antérieur déclare lui-même.
const SOLID: i64 = 0;
const CLIP: i64 = 3;
/// Une opacité prise sur une image que la couleur de base ne porte pas, ou sur un calcul.
const ALPHA_TEXTURE: &str = "blend-alpha-texture-unsupported";
/// Une opacité prise sur un canal de cette image que glTF ne lit pas à cette place.
const TEXTURE_CHANNEL: &str = "blend-texture-channel-unsupported";

/// Ce que l'entrée `Alpha` a donné : le facteur qui entre dans `baseColorFactor`, et si l'alpha
/// d'une image le module encore.
pub(super) struct Alpha {
    pub(super) factor: f32,
    textured: bool,
}

/// L'opacité du nuanceur, connaissant l'entrée de couleur de base et la texture qu'elle a donnée.
/// Une entrée branchée l'emporte sur la valeur écrite : quand l'alpha de la texture de couleur de
/// base porte l'opacité, le facteur vaut un et laisse passer l'image.
pub(super) fn of(
    node: &At<'_>,
    tree: &shading::Tree<'_>,
    base: Option<&At<'_>>,
    coloured: bool,
    out: &mut Out,
) -> Alpha {
    let Some(socket) = shading::socket(node, "Alpha") else {
        return Alpha {
            factor: 1.0,
            textured: false,
        };
    };
    let declared = Alpha {
        factor: shading::value(&socket, 1.0)[0],
        textured: false,
    };
    let Some(link) = tree.link(&socket) else {
        return declared;
    };
    let same = base
        .and_then(|socket| tree.link(socket))
        .is_some_and(|colour| colour.node.old == link.node.old);
    if !same || !coloured {
        out.report.add(ALPHA_TEXTURE);
        return declared;
    }
    if link.socket != ALPHA_CHANNEL {
        out.report.add(TEXTURE_CHANNEL);
        return declared;
    }
    Alpha {
        factor: 1.0,
        textured: true,
    }
}

/// Le mode de transparence du matériau, écrit dans le glTF quand il n'est pas l'opacité.
pub(super) fn mode(material: &At<'_>, alpha: &Alpha, gltf: &mut Value) {
    if material.has(RENDER_METHOD) {
        if alpha.textured || alpha.factor < 1.0 {
            gltf["alphaMode"] = json!("BLEND");
        }
        return;
    }
    match material.int("blend_method", SOLID) {
        SOLID => {}
        CLIP => {
            gltf["alphaMode"] = json!("MASK");
            gltf["alphaCutoff"] = json!(material.float("alpha_threshold", 0.5));
        }
        _ => gltf["alphaMode"] = json!("BLEND"),
    }
}
