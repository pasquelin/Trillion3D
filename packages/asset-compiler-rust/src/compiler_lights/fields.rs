//! Les champs d'une lampe glTF, lus un par un et ramenés dans ce que le contrat du moteur accepte.
//! Un champ absent, non fini ou hors bornes prend la valeur publiée dans `docs/SDK.md` : la lampe
//! reste allumée, elle ne disparaît pas parce qu'un exportateur a écrit un nombre impossible.
use super::*;

pub(super) fn number(value: Option<&Value>, fallback: f64) -> f64 {
    value.and_then(Value::as_f64).unwrap_or(fallback)
}
/// La couleur linéaire du glTF, ramenée à des canaux finis et non négatifs.
pub(super) fn colour_of(light: &Value) -> [f64; 3] {
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
pub(super) fn axis(m: &Mat4) -> Option<[f64; 3]> {
    let raw = [-m[8], -m[9], -m[10]];
    let length = (raw[0] * raw[0] + raw[1] * raw[1] + raw[2] * raw[2]).sqrt();
    if !length.is_finite() || length <= 1e-9 {
        return None;
    }
    Some([raw[0] / length, raw[1] / length, raw[2] / length])
}
/// La portée déclarée, sinon celle que l'intensité impose : la distance où l'irradiance du canal le
/// plus fort tombe sous `RANGE_CUTOFF_IRRADIANCE`. Jamais l'infini, jamais zéro.
pub(super) fn range_of(light: &Value, radiant: f64, colour: [f64; 3]) -> f64 {
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
pub(super) fn cone_of(light: &Value) -> f64 {
    let outer = number(light.pointer("/spot/outerConeAngle"), QUARTER_PI);
    if !outer.is_finite() {
        return QUARTER_PI;
    }
    outer.clamp(1e-3, std::f64::consts::FRAC_PI_2 - 1e-3)
}
