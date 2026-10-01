//! Local ImageTexture uses the existing texture registry; URLs never trigger network access.
use super::*;
use std::{fs::File, io::Read};
pub(super) fn attach(
    appearance: usize,
    document: &document::Document,
    request: &SceneRequest<'_>,
    scene: &mut SceneTables,
    material: &mut serde_json::Value,
) -> Result<()> {
    let appearance = &document.nodes[appearance];
    let Some(id) = appearance.child("texture")? else {
        return Ok(());
    };
    let texture = &document.nodes[id];
    if texture.kind != "ImageTexture" {
        return Err(source::unsupported(
            "vrml",
            format!("texture {}", texture.kind),
        ));
    }
    texture.fields(&["url", "repeatS", "repeatT"])?;
    let urls = match texture.fields.get("url") {
        Some(document::Value::List(values)) => values
            .iter()
            .map(|v| match v {
                document::Value::Text(s) => Ok(s.as_str()),
                _ => Err(source::invalid("vrml", "non-string URL")),
            })
            .collect::<Result<Vec<_>>>()?,
        Some(document::Value::Text(s)) => vec![s.as_str()],
        None => Vec::new(),
        _ => return Err(source::invalid("vrml", "invalid URL field")),
    };
    if urls.is_empty() {
        return Ok(());
    }
    let root = super::super::image_root(request.source).canonicalize()?;
    let mut selected = None;
    for url in urls {
        let path = super::super::archive::safe_join(&root, url)?;
        if !path.is_file() {
            continue;
        }
        if !path.canonicalize()?.starts_with(&root) {
            return Err(source::invalid("vrml", "texture escapes model root"));
        }
        if let Some(mime) = crate::import::readable(&root, url) {
            selected = Some((url.to_owned(), path, mime));
            break;
        }
    }
    let (url, path, mime) =
        selected.ok_or_else(|| source::invalid("vrml", "no readable local texture URL"))?;
    let mut bytes = Vec::new();
    File::open(path)?
        .take((request.ram_budget / 8) as u64 + 1)
        .read_to_end(&mut bytes)?;
    source::admit(bytes.len(), request.ram_budget / 8, "vrml")?;
    let mut reader = image::ImageReader::new(std::io::Cursor::new(&bytes));
    let format = image::ImageFormat::from_mime_type(mime)
        .ok_or_else(|| source::unsupported("vrml", "texture component metadata"))?;
    reader.set_format(format);
    let mut limits = image::Limits::default();
    limits.max_alloc = Some((request.ram_budget / 8) as u64);
    reader.limits(limits);
    let decoder = reader
        .into_decoder()
        .map_err(|_| source::unsupported("vrml", "texture component metadata"))?;
    use image::ImageDecoder;
    let color = decoder.color_type();
    if color.channel_count() >= 3 {
        let factor = &mut material["pbrMetallicRoughness"]["baseColorFactor"];
        for channel in 0..3 {
            factor[channel] = json!(1.);
        }
    }
    if color.has_alpha() {
        material["alphaMode"] = json!("BLEND");
    }
    scene.read_file(&url, bytes.len(), &crate::hash(&bytes));
    let image = scene.image(url, mime);
    let wrap = |name| {
        texture
            .boolean(name, true)
            .map(|repeat| if repeat { 10497 } else { 33071 })
    };
    let sampler = scene.sampler_uv(wrap("repeatS")?, wrap("repeatT")?);
    let index = scene.texture(image, sampler);
    let mut info = json!({"index":index});
    if let Some(id) = appearance.child("textureTransform")? {
        let transform = &document.nodes[id];
        if transform.kind != "TextureTransform" {
            return Err(source::invalid("vrml", "expected TextureTransform"));
        }
        transform.fields(&["center", "rotation", "scale", "translation"])?;
        let center = transform.number_array("center", [0.; 2])?;
        let scale = transform.number_array("scale", [1.; 2])?;
        let offset = transform.number_array("translation", [0.; 2])?;
        let [angle] = transform.number_array("rotation", [0.])?;
        let (sin, cos) = angle.sin_cos();
        let offset = [
            offset[0] + center[0] - cos * scale[0] * center[0] + sin * scale[1] * center[1],
            offset[1] + center[1] - sin * scale[0] * center[0] - cos * scale[1] * center[1],
        ];
        info["extensions"] =
            json!({"KHR_texture_transform":{"offset":offset,"scale":scale,"rotation":angle}});
    }
    material["pbrMetallicRoughness"]["baseColorTexture"] = info;
    Ok(())
}
pub(super) fn default_uv(positions: &[f64]) -> ([usize; 2], [f64; 3], f64) {
    let mut min = [f64::INFINITY; 3];
    let mut max = [f64::NEG_INFINITY; 3];
    for p in positions.as_chunks::<3>().0 {
        for axis in 0..3 {
            min[axis] = min[axis].min(p[axis]);
            max[axis] = max[axis].max(p[axis]);
        }
    }
    let extent = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
    let mut axes = [0, 1, 2];
    axes.sort_by(|a, b| extent[*b].total_cmp(&extent[*a]).then(a.cmp(b)));
    ([axes[0], axes[1]], min, extent[axes[0]])
}
