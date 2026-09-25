use super::*;
use crate::texture_preview::Layout;

/// Progressive levels section: one fixed-length entry per decoded color texture, and
/// its own byte range in pixel column.
///
/// Entry names texture and `source.gltf` image it covers, source
/// dimensions, origin kind — 0 for `uri`, 1 for buffer view whose index follows —
/// then rank of first carried level, count, pixel start and length, atlas
/// chain it holds — 0 color, 1 data, 2 color weighted by coverage (`AtlasKind`) — and count of levels baked into files under
/// `textures/<sha>/`, from 0 to `baked - 1`.
/// `uri` itself not copied: read from `images[image]` named by entry,and
/// duplicating it would create two truths. Levels not described one by one: their
/// dimensions re-deduced from source dimensions, so reader recomputes
/// declared geometry instead of trusting it. Entries strictly increasing by texture index
/// then atlas, ranges contiguous without gaps, re-checked by reader. The block
/// columns carry the same tails compressed, entry after entry with no offset
/// written: an entry whose layout word says lossless has no bytes there, the
/// others' lengths follow from the dimensions, and the reader re-derives them.
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
        for layout in preview.layouts {
            words.u32(Layout::word(layout));
        }
        offset = offset
            .checked_add(length)
            .ok_or_else(|| bad("Texture preview pixels exceed four gigabytes"))?;
        columns[TEXTURE_PREVIEW_SHA].sha(&preview.sha256)?;
        columns[TEXTURE_PREVIEW_PIXELS].raw(&preview.pixels);
        for ((column, blocks), layout) in TEXTURE_PREVIEW_BLOCKS
            .iter()
            .zip(&preview.blocks)
            .zip(preview.layouts)
        {
            let block_bytes = match layout {
                Some(_) => preview_block_bytes(preview.width, preview.height),
                None => 0,
            };
            if blocks.len() != block_bytes {
                return Err(bad(format!(
                    "Texture preview {} carries {} block bytes, expected {block_bytes}",
                    preview.texture,
                    blocks.len()
                )));
            }
            columns[*column].raw(blocks);
        }
    }
    debug_assert_eq!(
        columns[TEXTURE_PREVIEW_U32].bytes.len(),
        previews.len() * PREVIEW_WORDS * 4
    );
    debug_assert_eq!(columns[TEXTURE_PREVIEW_PIXELS].bytes.len(), offset as usize);
    Ok(())
}
