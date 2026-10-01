//! LDraw display RGB and authored !COLOUR values become linear glTF materials.
use super::*;

#[derive(Clone)]
pub(super) struct Colors {
    values: BTreeMap<String, serde_json::Value>,
    edges: BTreeMap<String, String>,
}
impl Colors {
    pub fn new() -> Self {
        let mut out = Self {
            values: BTreeMap::new(),
            edges: BTreeMap::new(),
        };
        // The sixteen original LDraw colour codes; other palettes must be supplied by !COLOUR.
        for (code, hex) in [
            0x05131D, 0x0055BF, 0x237841, 0x008F9B, 0xC91A09, 0xC870A0, 0x583927, 0x9BA19D,
            0x6D6E5C, 0xB4D2E3, 0x4B9F4A, 0x55A5AF, 0xF2705E, 0xFC97AC, 0xF2CD37, 0xFFFFFF,
        ]
        .iter()
        .enumerate()
        {
            out.values
                .insert(code.to_string(), surface(&code.to_string(), *hex, 255));
        }
        for code in 0..16 {
            out.edges.insert(
                code.to_string(),
                if code == 0 { "#595959" } else { "#333333" }.to_owned(),
            );
        }
        out
    }
    pub fn signature(&self) -> String {
        crate::hash(
            serde_json::to_string(&(&self.values, &self.edges))
                .unwrap()
                .as_bytes(),
        )
    }
    pub fn define(&mut self, words: &[&str]) -> Result<()> {
        let get = |name: &str| {
            words
                .iter()
                .position(|w| *w == name)
                .and_then(|i| words.get(i + 1))
                .copied()
        };
        let code = get("CODE").ok_or_else(|| source::invalid("ldraw", "colour missing CODE"))?;
        if code == "16" || code == "24" {
            return Err(source::invalid("ldraw", "reserved colour code"));
        }
        let hex = get("VALUE")
            .and_then(|s| s.strip_prefix('#'))
            .and_then(|s| u32::from_str_radix(s, 16).ok())
            .filter(|n| *n <= 0xffffff)
            .ok_or_else(|| source::invalid("ldraw", "invalid colour VALUE"))?;
        let alpha = get("ALPHA")
            .map(|s| s.parse::<u8>())
            .transpose()
            .map_err(|_| source::invalid("ldraw", "invalid ALPHA"))?
            .unwrap_or(255);
        if words
            .iter()
            .any(|w| matches!(*w, "MATERIAL" | "GLITTER" | "SPECKLE" | "PEARLESCENT"))
        {
            return Err(source::unsupported("ldraw", "procedural colour finish"));
        }
        let mut material = surface(words.first().copied().unwrap_or(code), hex, alpha);
        if words.contains(&"CHROME")
            || words.contains(&"METAL")
            || words.contains(&"MATTE_METALLIC")
        {
            material["pbrMetallicRoughness"]["metallicFactor"] = json!(1.0);
            material["pbrMetallicRoughness"]["roughnessFactor"] =
                json!(if words.contains(&"CHROME") { 0.0 } else { 0.4 });
        }
        if let Some(value) = get("LUMINANCE") {
            let luminosity = value
                .parse::<u8>()
                .map_err(|_| source::invalid("ldraw", "invalid LUMINANCE"))?
                as f64
                / 255.;
            let rgb: Vec<_> = material["pbrMetallicRoughness"]["baseColorFactor"]
                .as_array()
                .unwrap()[..3]
                .iter()
                .map(|v| v.as_f64().unwrap() * luminosity)
                .collect();
            material["emissiveFactor"] = json!(rgb);
        }
        let edge = get("EDGE").ok_or_else(|| source::invalid("ldraw", "colour missing EDGE"))?;
        if !edge.starts_with('#') && edge.parse::<u32>().is_err() {
            return Err(source::invalid("ldraw", "invalid EDGE"));
        }
        self.edges.insert(code.to_owned(), edge.to_owned());
        self.values.insert(code.to_owned(), material);
        Ok(())
    }
    pub fn edge(&self, code: &str) -> Result<serde_json::Value> {
        let edge = self
            .edges
            .get(code)
            .map(String::as_str)
            .unwrap_or("#333333");
        if let Some(hex) = edge.strip_prefix('#') {
            if hex.len() == 6 {
                if let Ok(rgb) = u32::from_str_radix(hex, 16) {
                    return Ok(surface(&format!("edge-{code}"), rgb, 255));
                }
            }
            return Err(source::invalid("ldraw", "invalid EDGE hex colour"));
        }
        self.material(edge)
    }
    pub fn material(&self, code: &str) -> Result<serde_json::Value> {
        if let Some(value) = self.values.get(code) {
            return Ok(value.clone());
        }
        if let Some(hex) = code
            .strip_prefix("0x2")
            .or_else(|| code.strip_prefix("0X2"))
        {
            if hex.len() == 6 {
                if let Ok(rgb) = u32::from_str_radix(hex, 16) {
                    return Ok(surface(code, rgb, 255));
                }
            }
        }
        Err(source::unsupported(
            "ldraw",
            format!("undefined colour {code}; supply !COLOUR in the model"),
        ))
    }
}
fn surface(name: &str, rgb: u32, alpha: u8) -> serde_json::Value {
    source::material(
        name,
        source::linear_color([
            ((rgb >> 16) & 255) as f32 / 255.,
            ((rgb >> 8) & 255) as f32 / 255.,
            (rgb & 255) as f32 / 255.,
            alpha as f32 / 255.,
        ]),
    )
}
