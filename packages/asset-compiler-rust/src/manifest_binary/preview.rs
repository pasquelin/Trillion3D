use super::*;

/// Section des niveaux progressifs : une entrée de longueur fixe par texture couleur décodée, et
/// une plage d'octets à elle dans la colonne des pixels.
///
/// Une entrée nomme la texture et l'image de `source.gltf` qu'elle couvre, les dimensions de la
/// source, le genre de provenance — 0 pour une `uri`, 1 pour une vue de tampon dont l'index suit —
/// puis le rang du premier niveau porté, leur nombre, le début et la longueur de ses pixels, l'atlas
/// qu'elle sert — 0 couleur, 1 données — et le nombre de niveaux cuits en fichiers sous
/// `textures/<sha>/`, du 0 au `baked - 1`.
/// L'`uri` elle-même n'est pas recopiée : elle se lit dans `images[image]`, que l'entrée nomme, et
/// la dupliquer serait deux vérités. Les niveaux, eux, ne sont pas décrits un par un : leurs
/// dimensions se redéduisent des dimensions de la source, si bien qu'un lecteur recalcule la
/// géométrie annoncée au lieu de la croire. Les entrées sont strictement croissantes par index de
/// texture puis par atlas, et leurs plages se suivent sans trou, ce qu'un lecteur revérifie.
pub(super) fn encode_previews(previews: &[TexturePreview], columns: &mut [Column]) -> Result<()> {
    let mut previous: Option<(u32, u32)> = None;
    let mut offset: u32 = 0;
    for preview in previews {
        let key = (preview.texture, preview.kind.word());
        if previous.is_some_and(|last| last >= key) {
            return Err(bad(format!(
                "Texture preview {} does not follow the previous (texture, atlas) pair",
                preview.texture
            )));
        }
        previous = Some(key);
        if preview.width == 0 || preview.height == 0 {
            return Err(bad(format!(
                "Texture preview {} declares an empty source image",
                preview.texture
            )));
        }
        let first = preview_first_level(preview.width, preview.height);
        if preview.first_level != first {
            return Err(bad(format!(
                "Texture preview {} declares first level {}, expected {first}",
                preview.texture, preview.first_level
            )));
        }
        let bytes = preview_pixel_bytes(preview.width, preview.height);
        if preview.pixels.len() != bytes {
            return Err(bad(format!(
                "Texture preview {} carries {} pixel bytes, expected {bytes}",
                preview.texture,
                preview.pixels.len()
            )));
        }
        let length = as_u32(bytes as i64, "Texture preview pixel length")?;
        let words = &mut columns[TEXTURE_PREVIEW_U32];
        words.u32(preview.texture);
        words.u32(preview.image);
        words.u32(preview.width);
        words.u32(preview.height);
        words.u32(preview.source.kind());
        words.u32(preview.source.buffer_view());
        words.u32(first);
        words.u32(preview_level_count(preview.width, preview.height));
        words.u32(offset);
        words.u32(length);
        words.u32(preview.kind.word());
        if preview.baked_levels > first {
            return Err(bad(format!(
                "Texture preview {} bakes {} levels but the sidecar starts at level {first}",
                preview.texture, preview.baked_levels
            )));
        }
        words.u32(preview.baked_levels);
        offset = offset
            .checked_add(length)
            .ok_or_else(|| bad("Texture preview pixels exceed four gigabytes"))?;
        columns[TEXTURE_PREVIEW_SHA].sha(&preview.sha256)?;
        columns[TEXTURE_PREVIEW_PIXELS].raw(&preview.pixels);
    }
    debug_assert_eq!(
        columns[TEXTURE_PREVIEW_U32].bytes.len(),
        previews.len() * PREVIEW_WORDS * 4
    );
    debug_assert_eq!(columns[TEXTURE_PREVIEW_PIXELS].bytes.len(), offset as usize);
    Ok(())
}
