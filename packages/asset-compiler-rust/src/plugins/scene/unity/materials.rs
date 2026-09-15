//! Un `.mat` Unity vers un matériau PBR glTF.
//!
//! On lit les propriétés par leur nom, jamais par la famille de shader : Standard, URP Lit et HDRP
//! Lit écrivent les mêmes grandeurs sous des noms voisins (`_Color` / `_BaseColor`, `_MainTex` /
//! `_BaseMap` / `_BaseColorMap`, `_Glossiness` / `_Smoothness`), et un matériau qui n'en déclare
//! aucune garde les valeurs par défaut du glTF. Rien n'est deviné d'après le nom d'un objet.
//!
//! La seule conversion de grandeur est `roughness = 1 − smoothness` : les deux vivent dans [0, 1],
//! l'application est une bijection, l'aller-retour est exact, aucune information n'est perdue. La
//! couleur de base reste un facteur multiplié par sa texture, comme chez Unity comme en glTF.
use super::*;

/// Les noms d'une même grandeur chez Standard, URP et HDRP, du plus précis au plus ancien.
const BASE_COLOR: [&str; 2] = ["_BaseColor", "_Color"];
const BASE_MAP: [&str; 3] = ["_BaseColorMap", "_BaseMap", "_MainTex"];
const NORMAL_MAP: [&str; 2] = ["_NormalMap", "_BumpMap"];
const NORMAL_SCALE: [&str; 2] = ["_NormalScale", "_BumpScale"];
const EMISSION_COLOR: [&str; 2] = ["_EmissiveColor", "_EmissionColor"];
const EMISSION_MAP: [&str; 2] = ["_EmissiveColorMap", "_EmissionMap"];
const SMOOTHNESS: [&str; 2] = ["_Smoothness", "_Glossiness"];
const METALLIC_MAP: [&str; 3] = ["_MaskMap", "_MetallicGlossMap", "_MetallicRemapMap"];
const CUTOFF: [&str; 2] = ["_AlphaCutoff", "_Cutoff"];
const ALPHA_CLIP: [&str; 2] = ["_AlphaCutoffEnable", "_AlphaClip"];
const CULL: [&str; 2] = ["_CullMode", "_Cull"];

/// Les tables de propriétés d'un `Material` sérialisé.
struct Properties<'a> {
    floats: &'a [Yaml],
    colors: &'a [Yaml],
    textures: &'a [Yaml],
    keywords: Vec<String>,
}

/// Convertit le corps d'un objet `Material` en matériau glTF.
pub(super) fn material_json(
    body: &Yaml,
    name: &str,
    scene: &mut Scene,
    project: &Project,
    table: &mut Textures,
) -> Value {
    let saved = &body["m_SavedProperties"];
    let properties = Properties {
        floats: sequence(saved, "m_Floats"),
        colors: sequence(saved, "m_Colors"),
        textures: sequence(saved, "m_TexEnvs"),
        keywords: sequence(body, "m_ValidKeywords")
            .iter()
            .chain(sequence(body, "m_ShaderKeywords"))
            .filter_map(|word| word.as_str().map(str::to_string))
            .collect(),
    };
    let color = properties.color(&BASE_COLOR, [1.0, 1.0, 1.0, 1.0]);
    let smoothness = properties.float(&SMOOTHNESS, 0.5).clamp(0.0, 1.0);
    let metallic = properties.float(&["_Metallic"], 0.0).clamp(0.0, 1.0);
    let mut pbr = json!({
        "baseColorFactor":color,"metallicFactor":metallic,"roughnessFactor":1.0 - smoothness,
    });
    if let Some(index) = properties.texture(&BASE_MAP, scene, project, table) {
        pbr["baseColorTexture"] = json!({"index":index});
    }
    // Unity empaquette métal et lissage dans un seul plan (R et A, ou le masque HDRP) ; glTF les
    // attend en G et B d'une même image. Les convertir voudrait réencoder les pixels : on garde les
    // facteurs déclarés, exacts, et on compte la carte non convertie.
    if properties.named(&METALLIC_MAP).is_some() {
        scene.report.add("unity-metallic-map-unconverted");
    }
    let mut out = json!({"name":name,"pbrMetallicRoughness":pbr});
    if let Some(index) = properties.texture(&NORMAL_MAP, scene, project, table) {
        let scale = properties.float(&NORMAL_SCALE, 1.0);
        out["normalTexture"] = json!({"index":index,"scale":scale});
    }
    emission(&properties, &mut out, scene, project, table);
    alpha(&properties, &mut out, color[3], scene);
    if properties.float(&CULL, 2.0) == 0.0 {
        out["doubleSided"] = json!(true);
    }
    out
}

/// L'émission : couleur HDR chez Unity, facteur borné à [0, 1] en glTF. Un matériau qui déclare ses
/// mots-clés sans `_EMISSION` n'émet pas, quelle que soit la couleur enregistrée.
fn emission(
    properties: &Properties<'_>,
    out: &mut Value,
    scene: &mut Scene,
    project: &Project,
    table: &mut Textures,
) {
    let color = properties.color(&EMISSION_COLOR, [0.0, 0.0, 0.0, 1.0]);
    let off = !properties.keywords.is_empty()
        && !properties.keywords.iter().any(|word| word == "_EMISSION");
    if off {
        if color[..3].iter().any(|value| *value > 0.0) {
            scene.report.add("unity-emission-keyword-off");
        }
        return;
    }
    if color[..3].iter().any(|value| *value > 1.0) {
        scene.report.add("unity-emission-clamped");
    }
    if color[..3].iter().any(|value| *value > 0.0) {
        out["emissiveFactor"] = json!([
            color[0].clamp(0.0, 1.0),
            color[1].clamp(0.0, 1.0),
            color[2].clamp(0.0, 1.0)
        ]);
    }
    if let Some(index) = properties.texture(&EMISSION_MAP, scene, project, table) {
        out["emissiveTexture"] = json!({"index":index});
    }
}

/// Le mode de rendu : `_Mode` chez Standard (0 opaque, 1 découpé, 2 fondu, 3 transparent), `_Surface`
/// et le drapeau de découpe chez URP et HDRP. Un matériau transparent ne devient jamais masqué.
fn alpha(properties: &Properties<'_>, out: &mut Value, opacity: f64, scene: &mut Scene) {
    let mode = properties.float(&["_Mode"], 0.0);
    let surface = properties.float(&["_Surface"], 0.0);
    let clipped = properties.float(&ALPHA_CLIP, 0.0) >= 0.5 || mode == 1.0;
    let blended = surface >= 0.5 || mode >= 2.0;
    if clipped {
        out["alphaMode"] = json!("MASK");
        out["alphaCutoff"] = json!(properties.float(&CUTOFF, 0.5));
        if blended {
            scene.report.add("unity-material-clip-and-blend");
        }
    } else if blended || (opacity < 1.0 && mode == 0.0 && surface == 0.0 && opacity > 0.0) {
        out["alphaMode"] = json!("BLEND");
    }
}

impl Properties<'_> {
    /// La première des propriétés nommées qui existe, quelle que soit la famille de shader.
    fn first<'b>(&self, list: &'b [Yaml], names: &[&str]) -> Option<&'b Yaml> {
        names.iter().find_map(|name| named(list, name))
    }
    fn float(&self, names: &[&str], default: f64) -> f64 {
        self.first(self.floats, names)
            .and_then(number)
            .unwrap_or(default)
    }
    fn color(&self, names: &[&str], default: [f64; 4]) -> [f64; 4] {
        self.first(self.colors, names)
            .map_or(default, |value| vec4(value, ["r", "g", "b", "a"], default))
    }
    /// L'entrée de texture nommée et la texture qu'elle désigne, si elle en désigne une.
    fn named(&self, names: &[&str]) -> Option<(&Yaml, Ref)> {
        let entry = self.first(self.textures, names)?;
        let reference = reference(&entry["m_Texture"]);
        (!reference.is_null()).then_some((entry, reference))
    }
    /// La texture liée à cette propriété. Une échelle ou un décalage d'UV non neutre est compté :
    /// le glTF le porterait dans une extension que la scène intermédiaire n'écrit pas encore.
    fn texture(
        &self,
        names: &[&str],
        scene: &mut Scene,
        project: &Project,
        table: &mut Textures,
    ) -> Option<usize> {
        let (entry, reference) = self.named(names)?;
        let scale = vec3(&entry["m_Scale"], [1.0, 1.0, 1.0]);
        let offset = vec3(&entry["m_Offset"], [0.0, 0.0, 0.0]);
        if scale[0] != 1.0 || scale[1] != 1.0 || offset[0] != 0.0 || offset[1] != 0.0 {
            scene.report.add("unity-texture-transform");
        }
        table.texture(&reference, scene, project)
    }
}
