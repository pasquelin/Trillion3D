use super::curves::{linear_to_srgb, transfer_table};
use super::*;

/// Pas et borne de la recherche binaire d'échelle d'alpha. Seize pas séparent deux alphas d'octet.
const ALPHA_SCALE_STEPS: usize = 16;
const MAX_ALPHA_SCALE: f32 = 16.0;
/// En dessous de cet alpha la couleur prémultipliée ne porte plus d'information à restituer.
const MIN_ALPHA: f32 = 1e-6;

/// Les octets d'une entrée : les niveaux RGBA8 sRGB à alpha droit, du plus fin porté au 1×1, et le
/// rang de ce premier niveau dans la chaîne de mips de la source. `transfer` est la fonction de
/// transfert que le pilote a lue dans le fichier : c'est elle qui dit comment ramener les octets
/// reçus en linéaire, et la supposer sRGB décodait une seconde fois une texture qui l'était déjà.
/// `cutoff`, quand il est donné, est le seuil de découpe dont la couverture doit être préservée.
pub(super) fn pyramid(
    source: &image::RgbaImage,
    transfer: Transfer,
    cutoff: Option<f32>,
) -> (u32, Vec<u8>) {
    let (width, height) = (source.width(), source.height());
    let (first, last) = (
        preview_first_level(width, height),
        preview_last_level(width, height),
    );
    let mut size = preview_level_size(width, height, first);
    let mut levels = vec![box_reduce(source, transfer, size)];
    for level in first + 1..=last {
        let next = preview_level_size(width, height, level);
        levels.push(halve(levels.last().expect("niveau précédent"), size, next));
        size = next;
    }
    // Le seuil et la couverture à préserver vont ensemble : sans seuil, aucun niveau n'est corrigé.
    let preserved = cutoff.map(|threshold| (threshold, source_coverage(source, threshold)));
    let mut out = Vec::with_capacity(preview_pixel_bytes(width, height));
    for texels in &levels {
        let scale = match preserved {
            Some((threshold, target)) => alpha_scale(texels, threshold, target),
            None => 1.0,
        };
        encode_level(texels, scale, &mut out);
    }
    (first, out)
}

/// Moyenne de boîte de l'image pleine résolution vers le niveau le plus fin porté, en linéaire
/// prémultiplié. Chaque case couvre au moins un texel source ; quand la cible a les dimensions de
/// la source, chaque case vaut exactement un texel et le niveau est la source, sans perte.
fn box_reduce(source: &image::RgbaImage, transfer: Transfer, target: (u32, u32)) -> Vec<[f32; 4]> {
    let table = transfer_table(transfer);
    let (width, height) = (source.width() as u64, source.height() as u64);
    let raw = source.as_raw();
    let (columns, rows) = (u64::from(target.0), u64::from(target.1));
    let mut out = vec![[0f32; 4]; (columns * rows) as usize];
    for row in 0..rows {
        let y0 = row * height / rows;
        let y1 = ((row + 1) * height / rows).max(y0 + 1).min(height);
        for column in 0..columns {
            let x0 = column * width / columns;
            let x1 = ((column + 1) * width / columns).max(x0 + 1).min(width);
            let mut sum = [0f64; 4];
            let mut count = 0f64;
            for y in y0..y1 {
                for x in x0..x1 {
                    let at = ((y * width + x) * 4) as usize;
                    let alpha = f32::from(raw[at + 3]) / 255.0;
                    for channel in 0..3 {
                        sum[channel] += f64::from(table[raw[at + channel] as usize] * alpha);
                    }
                    sum[3] += f64::from(alpha);
                    count += 1.0;
                }
            }
            let texel = &mut out[(row * columns + column) as usize];
            for channel in 0..4 {
                texel[channel] = (sum[channel] / count) as f32;
            }
        }
    }
    out
}

/// Niveau suivant : moyenne 2×2 du précédent, toujours en linéaire prémultiplié. Un côté impair
/// laisse sa dernière rangée de côté, comme la division entière qui donne les dimensions ; un côté
/// déjà à un texel se répète, si bien que la moyenne y rend ce texel inchangé.
fn halve(previous: &[[f32; 4]], size: (u32, u32), next: (u32, u32)) -> Vec<[f32; 4]> {
    let (width, height) = (size.0 as usize, size.1 as usize);
    let (columns, rows) = (next.0 as usize, next.1 as usize);
    let mut out = vec![[0f32; 4]; columns * rows];
    for row in 0..rows {
        for column in 0..columns {
            let mut sum = [0f32; 4];
            for dy in 0..2 {
                let y = (row * 2 + dy).min(height - 1);
                for dx in 0..2 {
                    let x = (column * 2 + dx).min(width - 1);
                    let texel = previous[y * width + x];
                    for channel in 0..4 {
                        sum[channel] += texel[channel];
                    }
                }
            }
            let texel = &mut out[row * columns + column];
            for channel in 0..4 {
                texel[channel] = sum[channel] * 0.25;
            }
        }
    }
    out
}

/// Fraction des texels pleine résolution dont l'alpha atteint le seuil : la couverture à préserver.
fn source_coverage(source: &image::RgbaImage, cutoff: f32) -> f32 {
    let raw = source.as_raw();
    let mut covered = 0u64;
    for at in (3..raw.len()).step_by(4) {
        if f32::from(raw[at]) / 255.0 >= cutoff {
            covered += 1;
        }
    }
    covered as f32 / (source.width() as f32 * source.height() as f32)
}

/// Échelle d'alpha qui rapproche le plus la couverture d'un niveau de celle de la pleine résolution.
/// La couverture croît avec l'échelle, donc une recherche binaire suffit ; à égalité l'échelle
/// neutre l'emporte, ce qui laisse un niveau déjà juste exactement tel qu'il est. Elle se compte
/// sur l'alpha des texels du niveau, jamais sur une copie de cette colonne.
fn alpha_scale(texels: &[[f32; 4]], cutoff: f32, target: f32) -> f32 {
    let coverage = |scale: f32| {
        texels
            .iter()
            .filter(|texel| (texel[3] * scale).min(1.0) >= cutoff)
            .count() as f32
            / texels.len() as f32
    };
    let (mut best, mut best_error) = (1.0f32, (coverage(1.0) - target).abs());
    let (mut low, mut high) = (0.0f32, MAX_ALPHA_SCALE);
    for _ in 0..ALPHA_SCALE_STEPS {
        let middle = 0.5 * (low + high);
        let covered = coverage(middle);
        let error = (covered - target).abs();
        if error < best_error {
            best_error = error;
            best = middle;
        }
        if covered < target {
            low = middle;
        } else {
            high = middle;
        }
    }
    best
}

/// Dé-prémultiplication au tout dernier pas, linéaire vers sRGB, alpha droit remis à l'échelle.
fn encode_level(texels: &[[f32; 4]], scale: f32, out: &mut Vec<u8>) {
    for texel in texels {
        let alpha = texel[3];
        let inverse = if alpha > MIN_ALPHA { 1.0 / alpha } else { 0.0 };
        for premultiplied in texel.iter().take(3) {
            out.push(linear_to_srgb((premultiplied * inverse).clamp(0.0, 1.0)));
        }
        out.push(((alpha * scale).clamp(0.0, 1.0) * 255.0).round() as u8);
    }
}
