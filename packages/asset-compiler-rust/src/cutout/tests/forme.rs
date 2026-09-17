//! Ce que la mesure voit. Les images sont construites ici, texel par texel : une feuille est un
//! disque au bord adouci, une vitre est un voile uniforme, et entre les deux il y a un dégradé qui
//! couvre toute la surface — la forme même qu'aucune découpe n'a.
use super::*;

/// Un disque de rayon `plein` entièrement présent, absent au-delà de `vide`, adouci entre les deux.
fn feuille(plein: f32, vide: f32) -> image::RgbaImage {
    image::RgbaImage::from_fn(64, 64, |x, y| {
        let (dx, dy) = (x as f32 - 31.5, y as f32 - 31.5);
        let rayon = (dx * dx + dy * dy).sqrt();
        let part = ((vide - rayon) / (vide - plein)).clamp(0.0, 1.0);
        image::Rgba([40, 120, 40, (part * 255.0).round() as u8])
    })
}

fn uniforme(alpha: u8) -> image::RgbaImage {
    image::RgbaImage::from_pixel(64, 64, image::Rgba([200, 200, 220, alpha]))
}

// Comportement : une feuille au bord adouci sur trois pixels est proposée en découpe — presque tout
// son alpha est à 0 ou à 1, et ses intermédiaires ne vivent que le long du contour.
#[test]
fn une_feuille_au_bord_adouci_est_proposee_en_decoupe() {
    let shape = measure(&feuille(18.0, 21.0));
    assert!(shape.between < 0.25, "part intermédiaire {}", shape.between);
    assert!(
        shape.at_contour > 0.99,
        "collés au contour {}",
        shape.at_contour
    );
    assert!(shape.looks_like_cutout());
}

// Comportement : une vitre — un voile uniforme à mi-chemin — n'est jamais proposée en découpe. Elle
// n'a pas de contour du tout, donc pas un seul de ses intermédiaires n'est collé à un bord.
#[test]
fn une_vitre_uniforme_reste_en_melange() {
    let shape = measure(&uniforme(77));
    assert_eq!(shape.between, 1.0);
    assert_eq!(shape.at_contour, 0.0);
    assert!(!shape.looks_like_cutout());
}

// Comportement : un dégradé qui traverse toute l'image a bien un contour, mais ses intermédiaires
// en sont loin. C'est le cas limite que la seule part d'intermédiaires ne saurait pas séparer d'une
// feuille très adoucie, et que leur emplacement tranche.
#[test]
fn un_degrade_plein_cadre_reste_en_melange() {
    let image = image::RgbaImage::from_fn(64, 64, |x, _| {
        image::Rgba([180, 180, 180, (x * 255 / 63) as u8])
    });
    let shape = measure(&image);
    assert!(shape.between > 0.9, "part intermédiaire {}", shape.between);
    // Les deux tiers de ses intermédiaires sont loin du contour : une feuille n'en a aucun.
    assert!(
        shape.at_contour < 0.4,
        "collés au contour {}",
        shape.at_contour
    );
    assert!(!shape.looks_like_cutout());
}

// Comportement : une texture sans vide n'a rien à découper, même sans le moindre intermédiaire. Un
// alpha tout à un est une surface opaque, et masquer n'y retirerait pas un pixel.
#[test]
fn une_texture_sans_vide_na_rien_a_decouper() {
    let shape = measure(&uniforme(255));
    assert_eq!(shape.present, 1.0);
    assert!(!shape.looks_like_cutout());
}

// Comportement : un grillage — un alpha déjà binaire, sans aucun intermédiaire — est proposé en
// découpe. C'est la forme que la référence attend, et la mesure ne la refuse pas faute de bord.
#[test]
fn un_alpha_deja_binaire_est_propose_en_decoupe() {
    let image = image::RgbaImage::from_fn(64, 64, |x, y| {
        let plein = (x / 4) % 2 == 0 || (y / 4) % 2 == 0;
        image::Rgba([90, 90, 90, if plein { 255 } else { 0 }])
    });
    let shape = measure(&image);
    assert_eq!(shape.between, 0.0);
    assert!(shape.looks_like_cutout());
}

// Comportement : la mesure lit la pleine résolution, donc la largeur du bord se compte en pixels de
// la source. Le même disque dans une image deux fois plus grande garde un bord de trois pixels et
// reste une découpe ; ce que le test fixe, c'est que la bande ne suit pas l'échelle de l'image.
#[test]
fn la_bande_se_compte_en_pixels_de_la_source() {
    let large = image::RgbaImage::from_fn(128, 128, |x, y| {
        let (dx, dy) = (x as f32 - 63.5, y as f32 - 63.5);
        let rayon = (dx * dx + dy * dy).sqrt();
        let part = ((45.0 - rayon) / 3.0).clamp(0.0, 1.0);
        image::Rgba([40, 120, 40, (part * 255.0).round() as u8])
    });
    assert!(measure(&large).looks_like_cutout());
}
