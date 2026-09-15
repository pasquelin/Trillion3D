//! Albédo diffus d'un matériau glTF, en linéaire, partagé par le proxy et par l'oracle.
//!
//! Les deux lisent le même matériau et doivent en tirer exactement la même couleur : si l'un
//! comptait le métal et l'autre non, la comparaison à l'oracle mesurerait deux lectures de matériau
//! au lieu du transport de la lumière. Seule la moyenne d'une texture les sépare — le proxy la lit
//! dans l'aperçu que le compilateur a déjà réduit, l'oracle la refait sur l'image source — et c'est
//! l'appelant qui la fournit.
use serde_json::Value;

/// L'albédo diffus de chaque matériau, empaqueté RGBA8 linéaire, dans l'ordre du glTF.
pub struct Palette {
    colours: Vec<u32>,
    default: u32,
}
impl Palette {
    /// L'albédo d'une primitive par son champ `material`. Une primitive sans matériau prend le
    /// matériau opaque par défaut de glTF, c'est-à-dire un blanc diffus.
    pub fn of(&self, material: Option<&Value>) -> u32 {
        material
            .and_then(Value::as_u64)
            .and_then(|id| self.colours.get(id as usize).copied())
            .unwrap_or(self.default)
    }
}

/// Une couleur linéaire dans quatre octets. L'alpha vaut toujours 255 : ni transparence ni émission
/// ne voyagent ici, et c'est dit dans le rapport plutôt que deviné.
pub fn pack(colour: [f64; 3]) -> u32 {
    let byte = |value: f64| (value.clamp(0.0, 1.0) * 255.0).round() as u32;
    byte(colour[0]) | (byte(colour[1]) << 8) | (byte(colour[2]) << 16) | (255 << 24)
}

/// Un octet sRGB ramené en linéaire, la même courbe que le reste de la chaîne (P1).
pub fn srgb_to_linear(byte: u8) -> f64 {
    let value = byte as f64 / 255.0;
    if value <= 0.04045 {
        value / 12.92
    } else {
        ((value + 0.055) / 1.055).powf(2.4)
    }
}

fn factor(material: &Value) -> [f64; 3] {
    material
        .pointer("/pbrMetallicRoughness/baseColorFactor")
        .and_then(Value::as_array)
        .map(|values| {
            let read = |axis: usize| values.get(axis).and_then(Value::as_f64).unwrap_or(1.0);
            [read(0), read(1), read(2)]
        })
        .unwrap_or([1.0, 1.0, 1.0])
}

/// Un métal pur n'a pas d'albédo diffus : ce qu'il renvoie est spéculaire, et le rebond diffus de
/// ce lot ne le porte pas. La part diffuse vaut donc `1 - metallic`, exactement comme le nuanceur.
fn diffuse_share(material: &Value) -> f64 {
    1.0 - material
        .pointer("/pbrMetallicRoughness/metallicFactor")
        .and_then(Value::as_f64)
        .unwrap_or(1.0)
        .clamp(0.0, 1.0)
}

/// La palette d'une scène. `mean` rend la couleur moyenne linéaire d'une texture de couleur de
/// base, ou rien quand elle n'est pas lisible ; le facteur du matériau vaut alors seul.
pub fn palette(g: &Value, mut mean: impl FnMut(u64) -> Option<[f64; 3]>) -> Palette {
    let materials = g
        .get("materials")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or(&[]);
    let mut colours = Vec::with_capacity(materials.len());
    for material in materials {
        let base = factor(material);
        let share = diffuse_share(material);
        let tint = material
            .pointer("/pbrMetallicRoughness/baseColorTexture/index")
            .and_then(Value::as_u64)
            .and_then(&mut mean)
            .unwrap_or([1.0, 1.0, 1.0]);
        colours.push(pack([
            base[0] * tint[0] * share,
            base[1] * tint[1] * share,
            base[2] * tint[2] * share,
        ]));
    }
    Palette {
        colours,
        default: pack([1.0, 1.0, 1.0]),
    }
}
