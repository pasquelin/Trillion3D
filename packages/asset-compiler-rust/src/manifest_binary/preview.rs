use super::*;

/// Section des aperçus de texture : une entrée de longueur fixe par texture couleur décodée.
///
/// Une entrée nomme la texture et l'image de `source.gltf` qu'elle couvre, les dimensions de la
/// source, le genre de provenance — 0 pour une `uri`, 1 pour une vue de tampon dont l'index suit —
/// et le décalage de chacun des cinq niveaux dans ses pixels. L'`uri` elle-même n'est pas recopiée :
/// elle se lit dans `images[image]`, que l'entrée nomme, et la dupliquer serait deux vérités.
/// Les entrées sont strictement croissantes par index de texture, ce qu'un lecteur revérifie.
pub(super) fn encode_previews(previews: &[TexturePreview], columns: &mut [Column]) -> Result<()> {
    let mut previous: Option<u32> = None;
    for preview in previews {
        if previous.is_some_and(|last| last >= preview.texture) {
            return Err(bad(format!(
                "Texture preview {} does not follow the previous texture index",
                preview.texture
            )));
        }
        previous = Some(preview.texture);
        if preview.width == 0 || preview.height == 0 {
            return Err(bad(format!(
                "Texture preview {} declares an empty source image",
                preview.texture
            )));
        }
        if preview.pixels.len() != PREVIEW_BYTES {
            return Err(bad(format!(
                "Texture preview {} carries {} pixel bytes, expected {PREVIEW_BYTES}",
                preview.texture,
                preview.pixels.len()
            )));
        }
        let words = &mut columns[TEXTURE_PREVIEW_U32];
        words.u32(preview.texture);
        words.u32(preview.image);
        words.u32(preview.width);
        words.u32(preview.height);
        words.u32(preview.source.kind());
        words.u32(preview.source.buffer_view());
        for offset in PREVIEW_LEVEL_OFFSETS {
            words.u32(offset);
        }
        columns[TEXTURE_PREVIEW_SHA].sha(&preview.sha256)?;
        columns[TEXTURE_PREVIEW_PIXELS].raw(&preview.pixels);
    }
    debug_assert_eq!(
        columns[TEXTURE_PREVIEW_U32].bytes.len(),
        previews.len() * PREVIEW_WORDS * 4
    );
    Ok(())
}
