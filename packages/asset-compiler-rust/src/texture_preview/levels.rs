use super::*;

/// Géométrie de la pyramide progressive d'une texture, partagée par le calcul, l'écriture du
/// sidecar et le lecteur TypeScript (`packages/sdk-core/texturePreviewLevels.ts`).
///
/// Un niveau `k` est exactement le niveau de mip `k` de la source : la division entière de ses deux
/// côtés par `2^k`, jamais moins d'un texel. Le moteur peut donc écrire le niveau `k` reçu dans le
/// niveau de mip `k` de sa couche d'atlas sans rien recalculer, et l'échantillonner tel quel.
/// Dimensions du niveau `level` d'une image `width`×`height`.
pub fn preview_level_size(width: u32, height: u32, level: u32) -> (u32, u32) {
    let shift = level.min(31);
    ((width >> shift).max(1), (height >> shift).max(1))
}

/// Niveau le plus fin que le sidecar porte : le premier dont aucun côté ne dépasse `PREVIEW_BASE`.
/// Au-dessus de lui il n'y a que la pleine résolution, que le moteur charge déjà comme image source.
pub fn preview_first_level(width: u32, height: u32) -> u32 {
    let mut level = 0;
    while level < 31 {
        let (w, h) = preview_level_size(width, height, level);
        if w <= PREVIEW_BASE && h <= PREVIEW_BASE {
            break;
        }
        level += 1;
    }
    level
}

/// Dernier niveau porté : celui où les deux côtés valent un texel.
pub fn preview_last_level(width: u32, height: u32) -> u32 {
    31 - width.max(height).max(1).leading_zeros()
}

/// Niveaux portés par une entrée, du plus fin au 1×1 compris. Vaut au plus `PREVIEW_MAX_LEVELS`.
pub fn preview_level_count(width: u32, height: u32) -> u32 {
    preview_last_level(width, height) - preview_first_level(width, height) + 1
}

/// Octets RGBA8 de tous les niveaux portés, bout à bout dans l'ordre du plus fin au plus grossier.
pub fn preview_pixel_bytes(width: u32, height: u32) -> usize {
    let mut bytes = 0usize;
    for level in preview_first_level(width, height)..=preview_last_level(width, height) {
        let (w, h) = preview_level_size(width, height, level);
        bytes += (w as usize) * (h as usize) * 4;
    }
    bytes
}
