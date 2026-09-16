//! Ce qu'un `UsdUVTexture` déclare autour de son fichier : la répétition de chacun de ses deux
//! axes, le `scale` et le `bias` qu'il applique aux octets lus, et l'espace de couleur dans lequel
//! il les lit.
//!
//! glTF ne porte rien de cela sur la texture : la répétition va à l'échantillonneur, l'échelle au
//! facteur du matériau quand elle s'y ramène, et ce qui ne s'y range pas est compté par son nom.
//! Rien n'est réencodé ici — un pilote qui recalculerait des octets inventerait l'image.
use super::*;

/// Les trois modes de répétition de glTF : répéter, borner, refléter.
const REPEAT: u32 = 10497;
const CLAMP: u32 = 33071;
const MIRROR: u32 = 33648;

/// Les deux espaces de couleur qu'un `UsdUVTexture` nomme en clair ; `auto` laisse le fichier dire.
const RAW: &str = "raw";
const SRGB: &str = "sRGB";

/// L'échantillonneur de cette texture : un mode par axe, jamais un seul pour les deux — un format
/// qui borne un axe et répète l'autre replierait son image si on les confondait.
pub(super) fn sampler(world: &mut World<'_>, shader: &usd::Prim) -> usize {
    let across = wrap(world, shader, "inputs:wrapS");
    let along = wrap(world, shader, "inputs:wrapT");
    world.scene.sampler_uv(across, along)
}

/// Le mode de répétition d'un axe. `black` borde l'image de transparent et `useMetadata` laisse le
/// fichier décider : glTF n'a ni l'un ni l'autre, la texture répète et le compte le dit.
fn wrap(world: &mut World<'_>, shader: &usd::Prim, axis: &str) -> u32 {
    let mode = read::first(&shader.attribute(axis))
        .and_then(|(value, _)| read::text(&value))
        .unwrap_or_default();
    match mode.as_str() {
        "clamp" => CLAMP,
        "mirror" => MIRROR,
        "" | "repeat" => REPEAT,
        _ => {
            world.refuse(world::TEXTURE_WRAP);
            REPEAT
        }
    }
}

/// Le facteur unique auquel `scale` et `bias` se ramènent, ou `None` quand ils n'y tiennent pas.
/// glTF multiplie sa texture par un facteur et n'y ajoute rien : il faut donc un `bias` nul et un
/// `scale` égal sur les trois canaux de couleur, le quatrième — l'alpha — restant à un.
pub(super) fn scale(shader: &usd::Prim) -> Option<f64> {
    let scale = channels(shader, "inputs:scale", 1.0);
    let bias = channels(shader, "inputs:bias", 0.0);
    let uniform = scale[..3].windows(2).all(|pair| pair[0] == pair[1]);
    (uniform && bias == [0.0; 4] && scale[3] == 1.0).then_some(scale[0])
}

/// Les quatre canaux d'une entrée que la spécification écrit en `float4` : une valeur unique vaut
/// pour les trois canaux de couleur, et tout canal que la couche n'écrit pas prend la valeur neutre.
fn channels(shader: &usd::Prim, name: &str, neutral: f64) -> [f64; 4] {
    let written = read::first(&shader.attribute(name))
        .and_then(|(value, _)| read::components(&value))
        .unwrap_or_default();
    match written.as_slice() {
        [] => [neutral; 4],
        [one] => [*one, *one, *one, neutral],
        parts => std::array::from_fn(|axis| parts.get(axis).copied().unwrap_or(neutral)),
    }
}

/// L'espace de couleur déclaré, comparé au rôle de l'entrée qui lit la texture : une couleur lue en
/// linéaire éclaircit la surface, une donnée lue comme une couleur la courbe. Le pilote ne
/// réencode pas les octets, il compte l'écart.
pub(super) fn colour_space(world: &mut World<'_>, shader: &usd::Prim, colour: bool) {
    let declared = read::first(&shader.attribute("inputs:sourceColorSpace"))
        .and_then(|(value, _)| read::text(&value));
    let contrary = match declared.as_deref() {
        Some(RAW) => colour,
        Some(SRGB) => !colour,
        _ => false,
    };
    if contrary {
        world.refuse(world::TEXTURE_COLOUR_SPACE);
    }
}
