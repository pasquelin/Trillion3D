//! The flattened materials appended to the published document: each image, its texture over the
//! one clamped, mipmapped sampler, each material naming its textures (`place`).
use super::{coverage_of, flattened_material, Image, Published, ANISOTROPY, EMISSIVE_STRENGTH};
use crate::texture::TexturePreview;
use serde_json::{json, Value};

/// How a flattened material's sampler wraps its atlas along both axes: glTF's clamp to the edge
/// (33071) — past a chart's edge lies its own gutter, never the atlas's far side.
const ATLAS_WRAP: u64 = 33071;

/// The glTF extensions a flattened material may declare, which the document names once used.
const EXTENSIONS: [&str; 2] = [EMISSIVE_STRENGTH, ANISOTROPY];

/// `materials` appended to the published document `scene` — each image as an image named
/// `uri(material, image)`, at that address where it has a PNG, else at the stand-in
/// (`crate::BAKED_IMAGE`, the one-pixel PNG an image whose chains are whole names as its
/// source), a texture over it with a clamped, mipmapped sampler, each material naming its
/// textures —; the images' chains given their ranks. Returns the glTF material rank of each, in
/// order, and the chains.
pub(crate) fn place(
    scene: &mut Value,
    materials: &mut [Published],
    uri: &dyn Fn(&Published, &Image) -> String,
) -> (Vec<usize>, Vec<TexturePreview>) {
    let count = |name: &str| {
        scene
            .get(name)
            .and_then(Value::as_array)
            .map_or(0, Vec::len)
    };
    let (mut image_rank, mut texture_rank) = (count("images"), count("textures"));
    if materials.is_empty() {
        return (Vec::new(), Vec::new());
    }
    let sampler = count("samplers");
    let first_material = count("materials");
    let mut added = (Vec::new(), Vec::new(), Vec::new());
    let mut ranks = Vec::new();
    let mut previews = Vec::new();
    let mut used = [false; EXTENSIONS.len()];
    for (material_rank, material) in (first_material..).zip(materials.iter_mut()) {
        // Each role's texture rank, by `Role as usize`, the emission map's strength and what the
        // base image's alpha is.
        let mut slot = [None::<usize>; 6];
        let strength = material.images.iter().find_map(|image| image.strength);
        let coverage = coverage_of(&material.images);
        let names: Vec<String> = material
            .images
            .iter()
            .map(|image| uri(material, image))
            .collect();
        for (image, name) in material.images.iter_mut().zip(names) {
            let address = if image.png.is_some() {
                name.as_str()
            } else {
                crate::BAKED_IMAGE
            };
            added
                .0
                .push(json!({"name": name, "uri": address, "mimeType": "image/png"}));
            added
                .1
                .push(json!({"source": image_rank, "sampler": sampler}));
            for preview in &mut image.previews {
                preview.texture = texture_rank as u32;
                preview.image = image_rank as u32;
            }
            previews.append(&mut image.previews);
            slot[image.role as usize] = Some(texture_rank);
            image_rank += 1;
            texture_rank += 1;
        }
        let looks = (material.double_sided, coverage, material.sky);
        let made = flattened_material(&material.name, (slot, strength), looks);
        for (used, name) in used.iter_mut().zip(EXTENSIONS) {
            *used |= made.pointer(&format!("/extensions/{name}")).is_some();
        }
        added.2.push(made);
        ranks.push(material_rank);
    }
    let declared = |name: &str| {
        (scene.get("extensionsUsed").and_then(Value::as_array))
            .is_some_and(|used| used.iter().any(|e| e == name))
    };
    let undeclared: Vec<Value> = (used.iter().zip(EXTENSIONS))
        .filter(|&(&used, name)| used && !declared(name))
        .map(|(_, name)| json!(name))
        .collect();
    let mut extend = |name: &str, values: Vec<Value>| {
        if values.is_empty() {
            return;
        }
        let list = scene
            .as_object_mut()
            .expect("a glTF document")
            .entry(name)
            .or_insert_with(|| json!([]));
        if let Some(list) = list.as_array_mut() {
            list.extend(values);
        }
    };
    // Linear filtering, mipmapped, clamped at the atlas's edges (glTF's 9729, 9987, `ATLAS_WRAP`).
    extend(
        "samplers",
        vec![json!({
            "magFilter": 9729,
            "minFilter": 9987,
            "wrapS": ATLAS_WRAP,
            "wrapT": ATLAS_WRAP,
        })],
    );
    extend("images", added.0);
    extend("textures", added.1);
    extend("materials", added.2);
    // An emission past one and an anisotropy map are declared through their extensions, which the
    // document then names.
    extend("extensionsUsed", undeclared);
    (ranks, previews)
}
