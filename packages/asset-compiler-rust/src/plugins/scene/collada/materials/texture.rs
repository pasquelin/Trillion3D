//! COMMON sampler/surface indirection, with safe image-root paths and source fingerprints.
use super::*;
fn parameter<'a, 'd>(profile: Node<'a, 'd>, sid: &str) -> Result<Node<'a, 'd>> {
    profile
        .children()
        .find(|n| n.has_tag_name("newparam") && n.attribute("sid") == Some(sid))
        .ok_or_else(|| source::invalid("collada", format!("missing parameter {sid}")))
}
fn wrap(sampler: Node<'_, '_>, name: &str) -> Result<u32> {
    match xml::child(sampler, name)
        .and_then(|n| n.text())
        .unwrap_or("WRAP")
        .trim()
    {
        "WRAP" => Ok(10497),
        "MIRROR" => Ok(33648),
        "CLAMP" => Ok(33071),
        v => Err(source::unsupported("collada", format!("texture wrap {v}"))),
    }
}
pub(super) fn load(
    world: &mut World<'_, '_, '_>,
    profile: Node<'_, '_>,
    texture: Node<'_, '_>,
) -> Result<usize> {
    let sampler = xml::required(
        parameter(profile, texture.attribute("texture").unwrap_or(""))?,
        "sampler2D",
        "collada",
    )?;
    let surface_id = xml::required(sampler, "source", "collada")?
        .text()
        .unwrap_or("")
        .trim();
    let surface = xml::required(parameter(profile, surface_id)?, "surface", "collada")?;
    if surface.attribute("type") != Some("2D") {
        return Err(source::unsupported("collada", "non-2D texture surface"));
    }
    let image_id = xml::required(surface, "init_from", "collada")?
        .text()
        .unwrap_or("")
        .trim();
    let image = world.lookup(&format!("#{image_id}"))?;
    let uri = xml::required(image, "init_from", "collada")?
        .text()
        .unwrap_or("")
        .trim();
    let root = super::super::super::image_root(world.request.source);
    let file = crate::uri::resolve_under(&root, uri).map_err(|e| source::invalid("collada", e))?;
    let relative =
        crate::uri::decode(uri).ok_or_else(|| source::invalid("collada", "invalid image URI"))?;
    let mime = crate::import::readable(&root, &relative)
        .ok_or_else(|| source::unsupported("collada", format!("unreadable texture {uri}")))?;
    let size = std::fs::metadata(&file)?.len();
    source::admit(
        usize::try_from(size).unwrap_or(usize::MAX),
        world.request.ram_budget / 8,
        "collada",
    )?;
    world
        .scene
        .read_file(&relative, size as usize, &crate::hash_file(&file)?);
    let image = world.scene.image(relative, mime);
    let filtering = |name, default| -> Result<u32> {
        match xml::child(sampler, name)
            .and_then(|n| n.text())
            .map(str::trim)
        {
            None => Ok(default),
            Some("NEAREST") => Ok(9728),
            Some("LINEAR") => Ok(9729),
            Some("NEAREST_MIPMAP_NEAREST") => Ok(9984),
            Some("LINEAR_MIPMAP_NEAREST") => Ok(9985),
            Some("NEAREST_MIPMAP_LINEAR") => Ok(9986),
            Some("LINEAR_MIPMAP_LINEAR") => Ok(9987),
            Some(v) => Err(source::unsupported(
                "collada",
                format!("texture filter {v}"),
            )),
        }
    };
    let sampler = world.scene.sampler_filtered([
        wrap(sampler, "wrap_s")?,
        wrap(sampler, "wrap_t")?,
        filtering("magfilter", 9729)?,
        filtering("minfilter", 9987)?,
    ]);
    Ok(world.scene.texture(image, sampler))
}
