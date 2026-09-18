use super::curves::{linear_to_srgb, srgb_table};
use super::*;

/// Ce que la couche d'atlas fait des octets, et donc ce que la réduction doit faire des mêmes :
/// l'atlas couleur est `rgba8unorm-srgb`, ses trois premiers canaux passent par la courbe sRGB ;
/// l'atlas de données est `rgba8unorm`, tout y est linéaire. L'alpha ne passe par aucune courbe
/// dans les deux cas — c'est ainsi que WebGPU définit ces formats.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub enum AtlasKind {
    Color,
    Data,
}
impl AtlasKind {
    pub fn word(self) -> u32 {
        match self {
            Self::Color => 0,
            Self::Data => 1,
        }
    }
    pub fn name(self) -> &'static str {
        match self {
            Self::Color => "srgb",
            Self::Data => "linear",
        }
    }
}

/// La chaîne de mips ENTIÈRE d'une source, niveau 0 compris : `levels[k]` est le niveau `k` en
/// RGBA8, aux dimensions de `preview_level_size`.
///
/// La règle est celle que le moteur appliquait sur la carte graphique en régénérant la chaîne
/// après la pleine résolution (`packages/sdk-browser/textureMips.ts`), reproduite ici pour que
/// cuire les niveaux au lieu de les régénérer ne change pas l'image : chaque niveau se calcule à
/// partir du niveau PRÉCÉDENT déjà quantifié en octets, jamais depuis un flottant conservé ; les
/// couleurs sont la moyenne des quatre texels, décodés puis réencodés par la courbe de l'atlas ;
/// l'alpha est la MÉDIANE des quatre, la moyenne des deux valeurs du milieu, qui conserve la
/// couverture d'un seuil de découpe d'un niveau au suivant ; un côté impair répète son dernier
/// texel, comme `min(p + 1, hi)` dans le nuanceur. Ni prémultiplication ni courbe déclarée par le
/// fichier : l'atlas ne les connaît pas, et la pyramide suit l'affichage, pas le fichier.
pub(super) fn chain(source: &image::RgbaImage, kind: AtlasKind) -> Vec<Vec<u8>> {
    let (width, height) = (source.width(), source.height());
    let last = preview_last_level(width, height);
    let mut levels = Vec::with_capacity(last as usize + 1);
    levels.push(source.as_raw().clone());
    let mut size = (width, height);
    for level in 1..=last {
        let next = preview_level_size(width, height, level);
        let previous = levels.last().expect("niveau précédent");
        levels.push(halve(previous, size, next, kind));
        size = next;
    }
    levels
}

/// La queue que le sidecar porte : les niveaux à partir de `preview_first_level`, bout à bout.
pub(super) fn tail(levels: &[Vec<u8>], first: u32) -> Vec<u8> {
    levels[first as usize..].concat()
}

/// La table qui ramène un octet du niveau précédent à la valeur que la carte moyenne : la courbe
/// sRGB pour les couleurs d'un atlas couleur, la division par 255 partout ailleurs.
fn decode_table(kind: AtlasKind) -> &'static [f32; 256] {
    match kind {
        AtlasKind::Color => srgb_table(),
        AtlasKind::Data => super::curves::linear_table(),
    }
}

fn encode(value: f32, kind: AtlasKind) -> u8 {
    match kind {
        AtlasKind::Color => linear_to_srgb(value),
        AtlasKind::Data => (value.clamp(0.0, 1.0) * 255.0).round() as u8,
    }
}

/// Le niveau suivant depuis les octets du précédent. `(u + v) / 2` est la médiane de quatre
/// valeurs : `u` la deuxième et `v` la troisième une fois triées, six comparaisons sans tri.
fn halve(previous: &[u8], size: (u32, u32), next: (u32, u32), kind: AtlasKind) -> Vec<u8> {
    let table = decode_table(kind);
    let (width, height) = (size.0 as usize, size.1 as usize);
    let (columns, rows) = (next.0 as usize, next.1 as usize);
    let mut out = Vec::with_capacity(columns * rows * 4);
    for row in 0..rows {
        let y0 = (row * 2).min(height - 1);
        let y1 = (row * 2 + 1).min(height - 1);
        for column in 0..columns {
            let x0 = (column * 2).min(width - 1);
            let x1 = (column * 2 + 1).min(width - 1);
            let at = |x: usize, y: usize| (y * width + x) * 4;
            let texels = [at(x0, y0), at(x1, y0), at(x0, y1), at(x1, y1)];
            for channel in 0..3 {
                let mean = texels
                    .iter()
                    .map(|&t| table[previous[t + channel] as usize])
                    .sum::<f32>()
                    * 0.25;
                out.push(encode(mean, kind));
            }
            let a: [f32; 4] = std::array::from_fn(|i| f32::from(previous[texels[i] + 3]) / 255.0);
            let u = a[0].max(a[1]).min(a[2].max(a[3]));
            let v = a[0].min(a[1]).max(a[2].min(a[3]));
            out.push(((u + v) * 0.5 * 255.0).round() as u8);
        }
    }
    out
}
