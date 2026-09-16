//! Les lampes déclarées par le fichier source, converties dans le contrat `SceneLight` du moteur.
//!
//! Le glTF les porte dans `KHR_lights_punctual` ; l'importeur ufbx réécrit celles d'un FBX sous
//! cette extension, si bien qu'un seul lecteur sert les deux formats — un OBJ n'en déclare aucune,
//! et le produit de cache sort vide. Le glTF est photométrique (candela, lux), le moteur est
//! radiométrique (W/sr, W/m²) : la conversion est une division par `LUMENS_PER_WATT`, sans aucune
//! hypothèse de spectre, et l'hôte règle l'exposition, jamais l'import. Détail dans `docs/SDK.md`.
use super::*;
use crate::compiler_world::{world_matrices, Mat4};

mod naming;
use naming::unique_id;

/// Efficacité lumineuse de la conversion photométrique → radiométrique, en lumens par watt. C'est
/// `K_cd`, la constante de définition de la candela (683 lm/W à 540 THz). Une candela vaut donc
/// 1/683 W/sr et un lux 1/683 W/m². Choix publié dans `docs/SDK.md`, pas une constante enfouie.
const LUMENS_PER_WATT: f64 = 683.0;
/// Réglage : irradiance en dessous de laquelle une ponctuelle sans `range` est déclarée éteinte, en
/// W/m². Le contrat exige une portée finie, le glTF autorise l'infini : `range` vaut `sqrt(I/seuil)`.
/// Un centième de watt par mètre carré tient sous le plancher d'une image de huit bits, et garde la
/// portée — donc la carte d'ombre — à une taille utile.
const RANGE_CUTOFF_IRRADIANCE: f64 = 1e-2;
/// Portée maximale, déclarée ou déduite, en mètres : au-delà, la lampe couvre toute scène jouable.
const MAX_RANGE: f64 = 1.0e4;
/// Version du produit de cache `lights.json`. Il vit hors du manifeste : sa version lui est propre.
const SCENE_LIGHTS_VERSION: u32 = 1;
const SCENE_LIGHTS_FILE: &str = "lights.json";
/// Version du contrat `SceneLight` que ce produit remplit (`packages/sdk-core/sceneLightContracts`).
const SCENE_LIGHT_CONTRACT: u32 = 2;
const QUARTER_PI: f64 = std::f64::consts::FRAC_PI_4;
/// Ce qu'une unité d'intensité FBX vaut dans l'unité photométrique du glTF — le seul endroit où ce
/// réglage se prend. FBX n'a pas d'unité : son `Intensity` est un pourcentage, que ufbx rend en
/// fraction. Une ponctuelle ou un projecteur prend l'ampoule de 1000 lm dans 4π sr (≈ 79,6 cd par
/// unité), une directionnelle l'éclairement d'une journée couverte (10 000 lux).
pub(crate) fn fbx_intensity_scale(kind: &str) -> f64 {
    if kind == "directional" {
        10_000.0
    } else {
        1000.0 / (4.0 * std::f64::consts::PI)
    }
}
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
    // Une ponctuelle rayonne partout : pas d'axe, et le contrat n'en attend pas. Le soleil et le
    // projecteur en exigent un, et une matrice qui l'écrase les refuse.
    if kind != "point" {
        entry["direction"] = json!(axis(m).ok_or("light-degenerate-axis")?);
    }
    if kind == "directional" {
        return Ok(entry);
    }
    entry["position"] = json!([m[12], m[13], m[14]]);
    entry["range"] = json!(range_of(light, radiant, colour));
    if kind == "spot" {
        entry["coneAngle"] = json!(cone_of(light));
    }
    Ok(entry)
}
fn report(lights: Vec<Value>, rejected: BTreeMap<&'static str, usize>) -> Value {
    json!({"version":SCENE_LIGHTS_VERSION,"sceneLightVersion":SCENE_LIGHT_CONTRACT,"units":{"lumensPerWatt":LUMENS_PER_WATT,"rangeCutoffIrradiance":RANGE_CUTOFF_IRRADIANCE,"maxRange":MAX_RANGE},"count":lights.len(),"lights":lights,"rejected":rejected})
}
/// Les lampes du glTF, dans l'ordre des nœuds qui les instancient, en espace monde. Seuls les nœuds
/// de la scène rendue comptent : une lampe posée dans une autre scène n'éclaire pas celle-ci. Une
/// lampe dont le type, la matrice ou l'intensité ne tient pas le contrat est comptée dans `rejected`
/// et laissée de côté : une compilation ne meurt jamais sur une lampe, elle le dit.
fn scene_lights(g: &Value, scene_nodes: &BTreeSet<usize>) -> Result<Value> {
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
        if !scene_nodes.contains(&index) {
            continue;
        }
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
/// L'étape de compilation : les lampes sortent en produit de cache à leur nom, hors du manifeste.
/// Sa version ne bouge donc pas, et un lecteur qui ignore ce fichier lit le cache comme avant.
pub(super) fn stage_scene_lights(
    g: &Value,
    scene_nodes: &BTreeSet<usize>,
    directory: &Path,
    progress: impl Fn(Value),
) -> Result<()> {
    let lights = scene_lights(g, scene_nodes)?;
    atomic(
        &directory.join(SCENE_LIGHTS_FILE),
        &serde_json::to_vec(&lights)?,
    )?;
    progress(
        json!({"phase":"lights","completed":1,"total":1,"lights":lights["count"],"rejected":lights["rejected"]}),
    );
    Ok(())
}
