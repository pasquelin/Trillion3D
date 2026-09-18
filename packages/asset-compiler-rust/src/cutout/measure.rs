//! La forme de l'alpha d'une texture : ce qui sépare une découpe d'une vraie transparence.
//!
//! Une VITRE laisse passer la lumière partout : son alpha est à mi-chemin sur toute la surface.
//! Une DÉCOUPE — feuille, grillage, branche — est présente ou absente en chaque point : son alpha
//! est à 0 ou à 1 presque partout, et le dégradé n'existe que le long du contour, sur quelques
//! pixels. Deux nombres suffisent à les distinguer : la part de texels intermédiaires, et la part
//! de ces intermédiaires qui sont collés au contour.
//!
//! Ce module ne rend qu'une PROPOSITION. La décision appartient au fichier de réponses, parce
//! qu'aucune mesure ne sépare à coup sûr une vitre sale d'une feuille très adoucie — et parce que
//! la référence, elle non plus, ne reclasse jamais un matériau d'elle-même.
use super::*;

/// Alpha en deçà duquel un texel est absent, et au-delà duquel il est présent, en octets. Les
/// encodeurs laissent traîner une ou deux valeurs autour des extrêmes ; ces marges les absorbent
/// sans rien concéder sur le reste de l'échelle.
const ABSENT: u8 = 8;
const PRESENT: u8 = 247;
/// Le contour dont on mesure la distance : le seuil auquel un matériau reclassé découpe, en octet.
/// Il se dérive de ce seuil et n'est pas réécrit : sinon la mesure dirait « collé au contour » d'un
/// bord où le matériau ne découpe pas.
const CONTOUR: u8 = (CUTOUT_ALPHA * 255.0 + 0.5) as u8;
/// Distance au contour, en pixels, en deçà de laquelle un texel intermédiaire est « collé au bord ».
/// Le feuillage mesuré adoucit son bord sur deux à huit pixels ; la bande retient ce pire cas.
const BAND: u8 = 8;
/// Ce qu'une découpe doit tenir pour être proposée : assez de vide pour qu'il y ait quelque chose à
/// découper, peu d'intermédiaires, et ces intermédiaires massivement collés au contour.
const MIN_ABSENT: f32 = 0.01;
const MAX_BETWEEN: f32 = 0.25;
const MIN_AT_CONTOUR: f32 = 0.70;

/// Ce que la mesure a vu, en parts du nombre de texels — sauf `at_contour`, qui est une part des
/// seuls intermédiaires : c'est leur emplacement qui distingue les deux formes, pas leur nombre.
#[derive(Default, Clone)]
pub(crate) struct AlphaShape {
    pub texels: u64,
    pub absent: f32,
    pub present: f32,
    pub between: f32,
    pub at_contour: f32,
}

impl AlphaShape {
    /// La proposition, et rien de plus : ce que la page HTML pré-positionne et que l'humain garde
    /// ou corrige.
    pub fn looks_like_cutout(&self) -> bool {
        self.texels > 0
            && self.absent >= MIN_ABSENT
            && self.between <= MAX_BETWEEN
            && self.at_contour >= MIN_AT_CONTOUR
    }
    /// Les nombres tels que la feuille et la page les montrent, arrondis au dixième de pour-cent :
    /// ce sont des parts lues à l'œil, pas des grandeurs dont un consommateur dérive un calcul. La
    /// proposition n'en fait pas partie — c'est un verdict, et la feuille le porte à part.
    pub fn report(&self) -> Value {
        let percent = |share: f32| (f64::from(share) * 1000.0).round() / 10.0;
        json!({"texels":self.texels,"absentPercent":percent(self.absent),
            "presentPercent":percent(self.present),"betweenPercent":percent(self.between),
            "atContourPercent":percent(self.at_contour),"band":BAND})
    }
}

/// Mesure l'alpha d'une image décodée. Le coût est de trois parcours : le contour, deux passes de
/// distance, puis le comptage.
pub(crate) fn measure(image: &image::RgbaImage) -> AlphaShape {
    let raw = image.as_raw();
    let texels = (raw.len() / 4) as u64;
    if texels == 0 {
        return AlphaShape {
            texels: 0,
            absent: 0.0,
            present: 0.0,
            between: 0.0,
            at_contour: 0.0,
        };
    }
    let distance = contour_distance(image);
    let (mut absent, mut present, mut between, mut at_contour) = (0u64, 0u64, 0u64, 0u64);
    for (at, texel) in raw.as_chunks::<4>().0.iter().enumerate() {
        match texel[3] {
            alpha if alpha <= ABSENT => absent += 1,
            alpha if alpha >= PRESENT => present += 1,
            _ => {
                between += 1;
                if distance[at] <= BAND {
                    at_contour += 1;
                }
            }
        }
    }
    let share = |count: u64| count as f32 / texels as f32;
    AlphaShape {
        texels,
        absent: share(absent),
        present: share(present),
        between: share(between),
        // Sans aucun intermédiaire, la question ne se pose pas : l'alpha est déjà binaire.
        at_contour: if between == 0 {
            1.0
        } else {
            at_contour as f32 / between as f32
        },
    }
}

/// La distance de chaque texel au contour du seuil, en pixels, par deux passes de chanfrein. Un
/// texel du contour est un texel dont un voisin de bord est de l'autre côté du seuil ; la distance
/// se propage ensuite en norme 1, qui ne sous-estime jamais la vraie distance.
fn contour_distance(image: &image::RgbaImage) -> Vec<u8> {
    let (width, height) = (image.width() as usize, image.height() as usize);
    let raw = image.as_raw();
    let solid = |at: usize| raw[at * 4 + 3] >= CONTOUR;
    let mut distance = vec![u8::MAX; width * height];
    for y in 0..height {
        for x in 0..width {
            let at = y * width + x;
            let here = solid(at);
            let edge = (x > 0 && solid(at - 1) != here)
                || (x + 1 < width && solid(at + 1) != here)
                || (y > 0 && solid(at - width) != here)
                || (y + 1 < height && solid(at + width) != here);
            if edge {
                distance[at] = 0;
            }
        }
    }
    for y in 0..height {
        for x in 0..width {
            let at = y * width + x;
            let mut best = distance[at];
            if y > 0 {
                best = best.min(distance[at - width].saturating_add(1));
            }
            if x > 0 {
                best = best.min(distance[at - 1].saturating_add(1));
            }
            distance[at] = best;
        }
    }
    for y in (0..height).rev() {
        for x in (0..width).rev() {
            let at = y * width + x;
            let mut best = distance[at];
            if y + 1 < height {
                best = best.min(distance[at + width].saturating_add(1));
            }
            if x + 1 < width {
                best = best.min(distance[at + 1].saturating_add(1));
            }
            distance[at] = best;
        }
    }
    distance
}
