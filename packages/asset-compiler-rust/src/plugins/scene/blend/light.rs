//! Les lampes d'un fichier Blender : le bloc `Lamp` que désigne un objet de type lampe, vers
//! `KHR_lights_punctual`. Comme partout dans ce pilote, chaque champ est demandé **par son nom** à
//! la SDNA du fichier, jamais à un décalage écrit en dur.
//!
//! **Ce qui est lu.** Les quatre types que Blender écrit aujourd'hui : ponctuelle, soleil,
//! projecteur, et surface — le glTF n'ayant pas de source étendue, une surface devient une
//! ponctuelle que son rayon d'émetteur habille. Tout autre type est compté et laissé de côté.
//!
//! **Unités.** Blender est radiométrique : la puissance d'une lampe est en watts, la force d'un
//! soleil en watts par mètre carré, et l'exposition la multiplie par `2^exposure`. L'intensité
//! radiante d'une ponctuelle ou d'un projecteur est donc `P / 4π` W/sr — Blender répartit la
//! puissance d'un projecteur sur la sphère entière, le cône ne fait que la découper —, celle d'une
//! surface lambertienne `P / π` dans l'axe, et l'éclairement d'un soleil est sa force telle quelle.
//! Le glTF étant photométrique, `compiler_lights::photometric` fait la conversion, et sa relecture
//! rend exactement le watt lu ici.
//!
//! **Le rayon d'émetteur** vient de la donnée native : `radius` — `shadow_soft_size` dans les
//! fichiers qui le nomment encore ainsi — pour une ponctuelle et un projecteur, la demi-diagonale
//! ou le demi-diamètre de la surface émissive pour une lampe de surface. Il est porté en mètres du
//! monde par l'échelle de l'objet. Un soleil n'en reçoit pas : le contrat du moteur refuse toute
//! enveloppe à une lampe qui n'a ni centre ni portée.
use super::*;

/// Le type d'objet qui porte une lampe.
pub(super) const OB_LAMP: i64 = 10;
/// Les types de lampe de Blender : ponctuelle, soleil, projecteur, surface.
const LA_LOCAL: i64 = 0;
const LA_SUN: i64 = 1;
const LA_SPOT: i64 = 2;
const LA_AREA: i64 = 4;
/// Les formes d'une lampe de surface : carré, rectangle, disque, ellipse.
const LA_AREA_SQUARE: i64 = 0;
const LA_AREA_DISK: i64 = 4;
const LA_AREA_ELLIPSE: i64 = 5;
/// Le type de lampe qu'un fichier écrit sans que ce pilote sache le rendre — le `hemi` des
/// fichiers d'avant Blender 2.8, entre autres.
const UNSUPPORTED: &str = "blend-light-type-unsupported";
/// Un objet de type lampe dont la donnée n'est pas un bloc `Lamp`, ou n'est rien.
const MISSING: &str = "blend-lamp-missing";

/// La lampe glTF d'un objet de type lampe, ou rien quand ce pilote ne la rend pas. `scale` est
/// l'échelle du monde de l'objet : c'est elle qui met le rayon d'émetteur en mètres.
pub(super) fn build(
    lamp: Option<At<'_>>,
    name: String,
    scale: f64,
    out: &mut Out,
) -> Option<usize> {
    let Some(lamp) = lamp.filter(|data| data.layout.name == "Lamp") else {
        out.report.add(MISSING);
        return None;
    };
    let kind = lamp.int("type", -1);
    let (gltf_kind, cone) = match kind {
        LA_LOCAL | LA_AREA => ("point", None),
        LA_SUN => ("directional", None),
        LA_SPOT => ("spot", Some(cone(&lamp))),
        _ => {
            out.report.add(UNSUPPORTED);
            return None;
        }
    };
    let power = f64::from(energy(&lamp)) * f64::from(lamp.float("exposure", 0.0)).exp2();
    let source = crate::import::LightSource {
        name,
        kind: gltf_kind,
        colour: [
            lamp.float("r", 1.0),
            lamp.float("g", 1.0),
            lamp.float("b", 1.0),
        ]
        .map(|channel| f64::from(channel).max(0.0)),
        intensity: crate::compiler_lights::photometric(power * spread(kind)),
        cone,
        casts_shadow: None,
        emitter_radius: radius(&lamp, kind, scale),
    };
    out.lights.push(source.json());
    out.count("lights", 1);
    Some(out.lights.len() - 1)
}

/// La puissance de la lampe. Les fichiers où le champ courant s'appelle encore `energy` n'ont pas
/// d'`energy_new` ; ceux qui en ont un y portent la puissance, et gardent dans `energy` la valeur
/// héritée de l'ancienne unité. Le nom présent dans la SDNA tranche, jamais une position.
fn energy(lamp: &At<'_>) -> f32 {
    if lamp.has("energy_new") {
        return lamp.float("energy_new", 0.0);
    }
    lamp.float("energy", 0.0)
}

/// Ce par quoi la puissance se divise pour devenir une intensité dans l'axe : la sphère entière
/// pour une ponctuelle et un projecteur, l'hémisphère lambertien d'une surface, et rien pour un
/// soleil, dont la force est déjà un éclairement.
fn spread(kind: i64) -> f64 {
    match kind {
        LA_SUN => 1.0,
        LA_AREA => 1.0 / std::f64::consts::PI,
        _ => 1.0 / (4.0 * std::f64::consts::PI),
    }
}

/// Les deux demi-angles du cône d'un projecteur, en radians. `spotsize` est l'angle **entier** du
/// cône, et `spotblend` la fraction qui s'adoucit vers son bord.
fn cone(lamp: &At<'_>) -> (f64, f64) {
    let outer = f64::from(lamp.float("spotsize", 0.0)) / 2.0;
    let blend = f64::from(lamp.float("spotblend", 0.0)).clamp(0.0, 1.0);
    (outer * (1.0 - blend), outer)
}

/// Le rayon de l'enveloppe émissive, en mètres du monde, ou rien quand la lampe n'en porte pas.
fn radius(lamp: &At<'_>, kind: i64, scale: f64) -> Option<f64> {
    let local = match kind {
        LA_SUN => return None,
        LA_AREA => area_radius(lamp),
        _ if lamp.has("radius") => f64::from(lamp.float("radius", 0.0)),
        _ => f64::from(lamp.float("shadow_soft_size", 0.0)),
    };
    Some(local * scale).filter(|value| value.is_finite() && *value > 0.0)
}

/// Le rayon de la sphère qui contient la surface émissive d'une lampe de surface : la demi-diagonale
/// d'un carré ou d'un rectangle, le demi-diamètre d'un disque, le demi-grand axe d'une ellipse.
fn area_radius(lamp: &At<'_>) -> f64 {
    let x = f64::from(lamp.float("area_size", 0.0));
    let y = f64::from(lamp.float("area_sizey", 0.0));
    match lamp.int("area_shape", LA_AREA_SQUARE) {
        LA_AREA_DISK => x / 2.0,
        LA_AREA_ELLIPSE => x.max(y) / 2.0,
        LA_AREA_SQUARE => x.hypot(x) / 2.0,
        _ => x.hypot(y) / 2.0,
    }
}
