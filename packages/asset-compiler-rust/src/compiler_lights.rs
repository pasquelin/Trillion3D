//! Les lampes déclarées par le fichier source, converties dans le contrat `SceneLight` du moteur.
//!
//! Le glTF les porte dans `KHR_lights_punctual` ; un FBX les porte nativement et l'importeur ufbx
//! les a déjà réécrites sous cette extension, si bien qu'un seul lecteur sert les deux formats. Un
//! OBJ n'en déclare aucune : rien à faire, le produit de cache sort vide.
//!
//! Unités. Le glTF est photométrique : candela (lm/sr) pour une ponctuelle et un projecteur, lux
//! (lm/m²) pour une directionnelle. Le moteur est radiométrique (P1) : W/sr et W/m². La conversion
//! est une division par `LUMENS_PER_WATT`, la constante qui définit la candela au SI — aucune
//! hypothèse de spectre n'est faite, et l'hôte règle l'exposition, jamais l'import.
use super::*;
use crate::compiler_world::{world_matrices, Mat4};

/// Efficacité lumineuse de la conversion photométrique → radiométrique, en lumens par watt. C'est
/// `K_cd`, la constante de définition de la candela (683 lm/W à 540 THz). Une candela vaut donc
/// 1/683 W/sr et un lux 1/683 W/m². Choix publié dans `docs/SDK.md`, pas une constante enfouie.
pub const LUMENS_PER_WATT: f64 = 683.0;
/// Réglage : irradiance en dessous de laquelle une ponctuelle sans `range` est déclarée éteinte, en
/// W/m². Le contrat du moteur exige une portée finie, le glTF autorise l'infini : `range` vaut donc
/// `sqrt(I / seuil)`. Un centième de watt par mètre carré tient sous le plancher d'une image de huit
/// bits à l'exposition neutre, et garde la portée — donc la carte d'ombre — à une taille utile.
pub const RANGE_CUTOFF_IRRADIANCE: f64 = 1e-2;
/// Portée maximale, déclarée ou déduite, en mètres : au-delà, la lampe couvre toute scène jouable.
pub const MAX_RANGE: f64 = 1.0e4;
/// Version du produit de cache `lights.json`. Il vit hors du manifeste : sa version lui est propre.
pub const SCENE_LIGHTS_VERSION: u32 = 1;
pub const SCENE_LIGHTS_FILE: &str = "lights.json";
/// Version du contrat `SceneLight` que ce produit remplit (`packages/sdk-core/sceneLightContracts`).
const SCENE_LIGHT_CONTRACT: u32 = 2;
const QUARTER_PI: f64 = std::f64::consts::FRAC_PI_4;
/// Réglage : ce qu'une unité d'intensité FBX vaut en candela. FBX ne porte aucune unité — son
/// champ `Intensity` est un pourcentage, que ufbx rend en fraction, 100 % valant 1. On prend une
/// ampoule domestique de 1000 lumens rayonnant dans 4π stéradians, soit ≈ 79,6 cd par unité.
pub const FBX_CANDELA_PER_UNIT: f64 = 1000.0 / (4.0 * std::f64::consts::PI);
/// Réglage : ce qu'une unité d'intensité FBX vaut en lux pour une directionnelle — l'éclairement
/// d'une journée couverte. Le rapport avec la ponctuelle ci-dessus est celui du monde réel.
pub const FBX_LUX_PER_UNIT: f64 = 10_000.0;

fn number(value: Option<&Value>, fallback: f64) -> f64 {
    value.and_then(Value::as_f64).unwrap_or(fallback)
}
/// La couleur linéaire du glTF, ramenée à des canaux finis et non négatifs.
fn colour_of(light: &Value) -> [f64; 3] {
    let items = light.get("color").and_then(Value::as_array);
    let channel = |i: usize| {
        items
            .and_then(|c| c.get(i))
            .and_then(Value::as_f64)
            .filter(|v| v.is_finite() && *v >= 0.0)
            .unwrap_or(1.0)
    };
    [channel(0), channel(1), channel(2)]
}
/// L'axe d'émission d'une lampe glTF : le −Z du nœud, dans le monde, normalisé. C'est le sens de
/// propagation de la lumière, exactement ce que le contrat attend d'un projecteur et du soleil.
fn axis(m: &Mat4) -> Option<[f64; 3]> {
    let raw = [-m[8], -m[9], -m[10]];
    let length = (raw[0] * raw[0] + raw[1] * raw[1] + raw[2] * raw[2]).sqrt();
    if !length.is_finite() || length <= 1e-9 {
        return None;
    }
    Some([raw[0] / length, raw[1] / length, raw[2] / length])
}
/// La portée déclarée, sinon celle que l'intensité impose : la distance où l'irradiance du canal le
/// plus fort tombe sous `RANGE_CUTOFF_IRRADIANCE`. Jamais l'infini, jamais zéro.
fn range_of(light: &Value, radiant: f64, colour: [f64; 3]) -> f64 {
    if let Some(range) = light
        .get("range")
        .and_then(Value::as_f64)
        .filter(|r| r.is_finite() && *r > 0.0)
    {
        return range.min(MAX_RANGE);
    }
    let peak = radiant * colour[0].max(colour[1]).max(colour[2]);
    (peak / RANGE_CUTOFF_IRRADIANCE)
        .sqrt()
        .clamp(1e-3, MAX_RANGE)
}
/// Le demi-angle du cône d'un projecteur, ramené dans l'intervalle ouvert que le contrat accepte.
/// `innerConeAngle` n'a pas d'équivalent : le moteur adoucit le bord par son propre réglage publié.
fn cone_of(light: &Value) -> f64 {
    let outer = number(light.pointer("/spot/outerConeAngle"), QUARTER_PI);
    if !outer.is_finite() {
        return QUARTER_PI;
    }
    outer.clamp(1e-3, std::f64::consts::FRAC_PI_2 - 1e-3)
}
/// Une lampe glTF posée par une matrice monde, dans le contrat du moteur, ou la raison du refus.
fn convert(light: &Value, m: &Mat4, id: String) -> std::result::Result<Value, &'static str> {
    if !m.iter().all(|v| v.is_finite()) {
        return Err("light-invalid-transform");
    }
    let kind = light.get("type").and_then(Value::as_str).unwrap_or("");
    if !matches!(kind, "point" | "spot" | "directional") {
        return Err("light-unsupported-type");
    }
    let radiant = number(light.get("intensity"), 1.0) / LUMENS_PER_WATT;
    if !radiant.is_finite() || radiant <= 0.0 {
        return Err("light-non-positive-intensity");
    }
    let colour = colour_of(light);
    // Le drapeau d'ombre d'un format qui en porte un (FBX) voyage dans `extras` ; sinon une lampe
    // importée projette une ombre, et le plafond par image du runtime en borne déjà le coût (X5).
    let shadow = light
        .pointer("/extras/castsShadow")
        .and_then(Value::as_bool)
        .unwrap_or(true);
    let mut entry =
        json!({"id":id,"kind":kind,"color":colour,"intensity":radiant,"castsShadow":shadow});
    let direction = axis(m);
    if kind == "directional" {
        entry["direction"] = json!(direction.ok_or("light-degenerate-axis")?);
        return Ok(entry);
    }
    entry["position"] = json!([m[12], m[13], m[14]]);
    entry["range"] = json!(range_of(light, radiant, colour));
    // Une ponctuelle rayonne dans toutes les directions : elle n'en porte aucune, et le contrat
    // n'en attend pas. Seul le projecteur a un axe, celui de son cône.
    if kind == "spot" {
        entry["direction"] = json!(direction.ok_or("light-degenerate-axis")?);
        entry["coneAngle"] = json!(cone_of(light));
    }
    Ok(entry)
}
/// Un identifiant unique et stable : le nom de la lampe ou du nœud, sinon son rang, et un suffixe
/// quand deux nœuds portent le même nom. L'hôte s'en sert pour régler ou retirer la lampe.
fn unique_id(light: &Value, node: &Value, index: usize, seen: &mut BTreeSet<String>) -> String {
    let named = |value: &Value| {
        value
            .get("name")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|name| !name.is_empty())
            .map(str::to_string)
    };
    let base = named(light)
        .or_else(|| named(node))
        .unwrap_or_else(|| format!("gltf-light-{index}"));
    let mut id = base.clone();
    let mut suffix = 2;
    while !seen.insert(id.clone()) {
        id = format!("{base}#{suffix}");
        suffix += 1;
    }
    id
}
fn report(lights: Vec<Value>, rejected: BTreeMap<&'static str, usize>) -> Value {
    json!({"version":SCENE_LIGHTS_VERSION,"sceneLightVersion":SCENE_LIGHT_CONTRACT,"units":{"lumensPerWatt":LUMENS_PER_WATT,"rangeCutoffIrradiance":RANGE_CUTOFF_IRRADIANCE,"maxRange":MAX_RANGE},"count":lights.len(),"lights":lights,"rejected":rejected})
}
/// Les lampes du glTF, dans l'ordre des nœuds qui les instancient, en espace monde. Une lampe dont
/// le type, la matrice ou l'intensité ne tient pas le contrat est comptée dans `rejected` et
/// laissée de côté : une compilation ne meurt jamais sur une lampe, elle le dit.
pub(super) fn scene_lights(g: &Value) -> Result<Value> {
    let mut rejected: BTreeMap<&'static str, usize> = BTreeMap::new();
    let (Some(nodes), Some(declared)) = (
        g.get("nodes").and_then(Value::as_array),
        g.pointer("/extensions/KHR_lights_punctual/lights")
            .and_then(Value::as_array),
    ) else {
        return Ok(report(Vec::new(), rejected));
    };
    let world = world_matrices(g)?;
    let mut seen = BTreeSet::new();
    let mut lights = Vec::new();
    for (index, node) in nodes.iter().enumerate() {
        let Some(slot) = node
            .pointer("/extensions/KHR_lights_punctual/light")
            .and_then(Value::as_u64)
        else {
            continue;
        };
        let Some(light) = declared.get(slot as usize) else {
            *rejected.entry("light-index-out-of-bounds").or_insert(0) += 1;
            continue;
        };
        let id = unique_id(light, node, index, &mut seen);
        match convert(light, &world[index], id) {
            Ok(entry) => lights.push(entry),
            Err(why) => *rejected.entry(why).or_insert(0) += 1,
        }
    }
    Ok(report(lights, rejected))
}
