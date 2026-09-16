//! Les lampes `UsdLux` d'une couche, vers `KHR_lights_punctual`.
//!
//! **Ce qui est lu.** `SphereLight` et `DiskLight` (ponctuelles), `RectLight` (ponctuelle aussi :
//! le glTF n'a pas de source étendue) et `DistantLight` (directionnelle), plus la `ShapingAPI` qui
//! fait d'une lampe un projecteur, et la `ShadowAPI` qui dit si elle porte une ombre. Tout autre
//! type de `UsdLux` — `DomeLight`, `CylinderLight`, `GeometryLight`, `PortalLight`, et les filtres
//! — reste compté par `world::LIGHT`, faute d'équivalent ponctuel.
//!
//! **Unités.** `UsdLux` est radiométrique et relatif : une lampe émet la radiance
//! `inputs:intensity · 2^inputs:exposure`, que `inputs:normalize` divise par l'aire de la source.
//! L'intensité radiante d'une lampe de surface est donc cette radiance multipliée par l'aire
//! projetée de sa géométrie — `π r²` pour une sphère ou un disque, `largeur × hauteur` pour un
//! rectangle —, et l'éclairement d'une `DistantLight` est directement cette radiance. Le glTF, lui,
//! est photométrique : la conversion est la multiplication par `LUMENS_PER_WATT`, la constante que
//! `compiler_lights` redivise ensuite pour revenir au radiométrique du moteur. Rien ne s'invente
//! entre les deux, aucun spectre n'est supposé.
//!
//! **Le rayon d'émetteur** vient de la donnée native : `inputs:radius` pour une sphère ou un
//! disque, la demi-diagonale de `inputs:width` × `inputs:height` pour un rectangle. Il s'écrit en
//! mètres du monde, l'échelle du prim et `metersPerUnit` compris. `inputs:angle` d'une
//! `DistantLight` est un diamètre angulaire, pas une longueur : une directionnelle n'a ni centre
//! ni portée, et le contrat du moteur lui refuse déjà toute enveloppe.
use super::*;

/// Le demi-angle par défaut du cône de la `ShapingAPI`, en degrés.
const DEFAULT_CONE: f64 = 90.0;
/// Le rayon par défaut d'une `SphereLight` et d'une `DiskLight`, en unités de la couche.
const DEFAULT_RADIUS: f64 = 0.5;
/// Les côtés par défaut d'une `RectLight`, en unités de la couche.
const DEFAULT_SIDE: f64 = 1.0;

/// La forme émissive d'un type de lampe : ce qu'il faut lire pour en tirer une aire et un rayon.
enum Shape {
    /// Une sphère ou un disque, par `inputs:radius`.
    Round,
    /// Un rectangle, par `inputs:width` et `inputs:height`.
    Rect,
    /// Une source à l'infini : ni aire, ni rayon.
    Distant,
}

/// La forme d'un type de prim, ou `None` quand ce pilote ne le convertit pas.
fn shape(type_name: &str) -> Option<Shape> {
    Some(match type_name {
        "SphereLight" | "DiskLight" => Shape::Round,
        "RectLight" => Shape::Rect,
        "DistantLight" => Shape::Distant,
        _ => return None,
    })
}

/// La lampe glTF de ce prim, versée dans les tables, et son rang. `scale` est l'échelle du monde
/// accumulée jusqu'à ce prim, `metersPerUnit` compris : c'est elle qui met le rayon en mètres.
pub(super) fn build(world: &mut World<'_>, prim: &usd::Prim, scale: f64) -> Option<usize> {
    let type_name = prim.type_name().ok().flatten()?;
    let Some(shape) = shape(type_name.as_str()) else {
        world.refuse(world::LIGHT);
        return None;
    };
    let radiance = number(world, prim, "inputs:intensity", 1.0)
        * number(world, prim, "inputs:exposure", 0.0).exp2();
    let (area, radius) = extent(world, prim, &shape, scale);
    let normalized = flag(world, prim, "inputs:normalize").unwrap_or(false);
    let cone = cone(world, prim);
    let source = crate::import::LightSource {
        name: prim.path().name().unwrap_or("Light").to_string(),
        kind: match (&shape, cone.is_some()) {
            (Shape::Distant, _) => "directional",
            (_, true) => "spot",
            (_, false) => "point",
        },
        colour: colour(world, prim),
        intensity: crate::compiler_lights::photometric(
            radiance * if normalized { 1.0 } else { area },
        ),
        cone,
        casts_shadow: flag(world, prim, "inputs:shadow:enable"),
        emitter_radius: radius.filter(|value| value.is_finite() && *value > 0.0),
    };
    world.scene.lights.push(source.json());
    world.count("lights", 1);
    Some(world.scene.lights.len() - 1)
}

/// L'aire projetée de la source, en mètres carrés, et le rayon de son enveloppe, en mètres. Une
/// source à l'infini n'a ni l'une ni l'autre : son aire vaut un, l'intensité restant l'éclairement.
fn extent(
    world: &mut World<'_>,
    prim: &usd::Prim,
    shape: &Shape,
    scale: f64,
) -> (f64, Option<f64>) {
    match shape {
        Shape::Round => {
            let radius = number(world, prim, "inputs:radius", DEFAULT_RADIUS) * scale;
            (std::f64::consts::PI * radius * radius, Some(radius))
        }
        Shape::Rect => {
            let width = number(world, prim, "inputs:width", DEFAULT_SIDE) * scale;
            let height = number(world, prim, "inputs:height", DEFAULT_SIDE) * scale;
            (width * height, Some(width.hypot(height) / 2.0))
        }
        Shape::Distant => (1.0, None),
    }
}

/// Les deux demi-angles du cône d'un projecteur, en radians, ou `None` quand le prim ne porte pas
/// la `ShapingAPI`. `inputs:shaping:cone:softness` est la fraction du cône qui s'adoucit : le
/// demi-angle intérieur est ce que cette fraction laisse.
fn cone(world: &mut World<'_>, prim: &usd::Prim) -> Option<(f64, f64)> {
    let outer = read(world, prim, "inputs:shaping:cone:angle")?.to_radians();
    let softness = number(world, prim, "inputs:shaping:cone:softness", 0.0).clamp(0.0, 1.0);
    let outer = if outer.is_finite() {
        outer
    } else {
        DEFAULT_CONE.to_radians()
    };
    Some((outer * (1.0 - softness), outer))
}

/// La couleur de la lampe, canaux finis et non négatifs ; blanche par défaut, comme `UsdLux`.
fn colour(world: &mut World<'_>, prim: &usd::Prim) -> [f64; 3] {
    let Some((value, sampled)) = read::first(&prim.attribute("inputs:color")) else {
        return [1.0; 3];
    };
    if sampled {
        world.refuse(world::TIME_SAMPLE);
    }
    read::triple(&value).map_or([1.0; 3], |rgb| {
        rgb.map(|c| if c.is_finite() && c >= 0.0 { c } else { 1.0 })
    })
}

/// Un attribut numérique de la lampe, ou son défaut `UsdLux` quand elle ne l'écrit pas.
fn number(world: &mut World<'_>, prim: &usd::Prim, name: &str, default: f64) -> f64 {
    read(world, prim, name)
        .filter(|value| value.is_finite())
        .unwrap_or(default)
}

/// Un attribut numérique écrit par la lampe, et rien quand elle ne l'écrit pas : c'est ainsi qu'on
/// distingue une lampe façonnée en projecteur d'une lampe qui ne l'est pas.
fn read(world: &mut World<'_>, prim: &usd::Prim, name: &str) -> Option<f64> {
    let (value, sampled) = read::first(&prim.attribute(name))?;
    if sampled {
        world.refuse(world::TIME_SAMPLE);
    }
    read::number(&value)
}

/// Un attribut booléen écrit par la lampe, et rien quand elle ne l'écrit pas.
fn flag(world: &mut World<'_>, prim: &usd::Prim, name: &str) -> Option<bool> {
    let (value, sampled) = read::first(&prim.attribute(name))?;
    if sampled {
        world.refuse(world::TIME_SAMPLE);
    }
    read::flag(&value)
}
