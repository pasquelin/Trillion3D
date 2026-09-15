//! La dorée du pilote GIF : une image indexée rend ses couleurs telles quelles, que sa table soit
//! globale ou locale, l'index déclaré transparent devient un alpha nul, et un fichier qui porte
//! plus d'une image est refusé en le nommant. C'est ce refus qui compte le plus ici : choisir
//! d'office laquelle des images d'une animation est *la* texture serait arbitraire.
use super::super::image as registry;
use super::{fixture, rgba8};
use std::path::PathBuf;

const MAX_ALLOC: u64 = 4 * 1024 * 1024;

/// L'image de référence, ligne du haut d'abord. Le format étant indexé, ses couleurs sortent de la
/// table sans arrondi : ce sont exactement les octets écrits dans la table.
const REFERENCE: [[u8; 3]; 8] = [
    [255, 0, 0],
    [0, 255, 0],
    [0, 0, 255],
    [255, 255, 255],
    [0, 0, 0],
    [247, 206, 8],
    [16, 49, 239],
    [132, 239, 66],
];
/// L'alpha du fichier à index transparent : le dernier pixel porte l'index déclaré transparent par
/// l'extension de contrôle graphique, et lui seul.
const ALPHA_TRANSPARENT: [u8; 8] = [255, 255, 255, 255, 255, 255, 255, 0];
const OPAQUE: [u8; 8] = [255; 8];

/// Où s'arrête la première image d'`anime.gif` : treize octets d'entête et de descripteur d'écran,
/// vingt-quatre de table de couleurs globale, puis les dix-neuf du premier bloc d'image.
const PREMIERE_IMAGE_FIN: usize = 13 + 24 + 19;

fn expected(alpha: &[u8; 8]) -> Vec<u8> {
    REFERENCE
        .iter()
        .zip(alpha)
        .flat_map(|(colour, alpha)| [colour[0], colour[1], colour[2], *alpha])
        .collect()
}

/// L'image que le registre rend pour cette fixture, dimensions vérifiées au passage.
fn rendu(name: &str) -> image::RgbaImage {
    let bytes = fixture("gif", name);
    let pilote = registry::by_head(&bytes).expect("un pilote revendique ces octets");
    assert_eq!(pilote.name(), "gif", "{name}");
    let rendu = rgba8(
        registry::decode(&bytes, MAX_ALLOC).unwrap_or_else(|erreur| panic!("{name}: {erreur}")),
    );
    assert_eq!((rendu.width(), rendu.height()), (4, 2), "{name}");
    rendu
}

// Dorée du pilote GIF : la table de couleurs globale et la table locale portent la même image et
// rendent les mêmes octets — d'où vient la table ne change pas un pixel. L'index transparent, lui,
// ne change que l'alpha : la couleur que la table lui donne reste là, elle n'est ni effacée ni
// remplie de blanc, et rien n'est prémultiplié.
#[test]
fn les_deux_tables_de_couleurs_rendent_les_memes_pixels() {
    for name in ["palette-globale.gif", "palette-locale.gif"] {
        assert_eq!(
            rendu(name).as_raw(),
            &expected(&OPAQUE),
            "{name} : les pixels divergent de la référence"
        );
    }
    assert_eq!(
        rendu("transparence.gif").as_raw(),
        &expected(&ALPHA_TRANSPARENT),
        "l'index transparent ne touche que l'alpha, jamais la couleur de la table"
    );
}

// Contrat du pilote : ce qu'il reconnaît, ce qu'il refuse, et sous quel nom il le rapporte. Un GIF
// refusé laisse le moteur retomber sur son blanc ; il n'interrompt aucune compilation et ne panique
// jamais. Une animation est écartée avant tout décodage, par la raison du pilote `webp` : un refus
// d'animation est un refus d'animation, quel que soit le format qui la porte.
#[test]
fn un_gif_hors_politique_ressort_en_raison_de_rapport_jamais_en_panique() {
    for extension in ["gif", "GIF", "Gif"] {
        let chemin = PathBuf::from(format!("albedo.{extension}"));
        let pilote = registry::by_extension(&chemin).expect("revendiqué");
        assert_eq!(pilote.name(), "gif", "{extension}");
        assert_eq!(pilote.mime(), "image/gif");
    }
    for (name, raison) in [
        ("anime.gif", "image-animation-unsupported"),
        // Tronqué : la signature reste celle d'un GIF, donc le pilote est bien choisi, et le
        // parcours des blocs s'arrête faute d'octets — sans conclure à une animation.
        ("tronque.gif", "image-decode-failed"),
    ] {
        let bytes = fixture("gif", name);
        assert_eq!(
            registry::by_head(&bytes).map(|pilote| pilote.name()),
            Some("gif"),
            "{name}"
        );
        assert_eq!(
            registry::decode(&bytes, MAX_ALLOC).err(),
            Some(raison),
            "{name}"
        );
    }
    // Les deux versions du format portent la même structure : la 87a n'a pas d'extensions, et le
    // parcours des blocs doit la traverser aussi bien que la 89a.
    let mut ancienne = fixture("gif", "palette-globale.gif");
    ancienne[..6].copy_from_slice(b"GIF87a");
    assert_eq!(rendu_octets(&ancienne), expected(&OPAQUE));
    // `anime.gif` coupé à la fin de sa première image : plus de bloc suivant, et plus d'octet de
    // fin non plus. Le parcours ne conclut donc pas à l'animation, et le décodeur lit l'image
    // entière qui reste — une image sans octet de fin est une image, pas une animation.
    let anime = fixture("gif", "anime.gif");
    assert_eq!(
        rendu_octets(&anime[..PREMIERE_IMAGE_FIN]),
        expected(&OPAQUE)
    );
    // Quatre octets plus loin, le second séparateur d'image est là et son descripteur est coupé :
    // cela suffit à prouver la seconde image, et c'est de l'animation que le fichier est refusé.
    assert_eq!(
        registry::decode(&anime[..PREMIERE_IMAGE_FIN + 4], MAX_ALLOC).err(),
        Some("image-animation-unsupported")
    );
    // La signature est la seule marque du format : sans elle, ces octets ressortent en format
    // inconnu plutôt qu'en GIF illisible.
    for head in [b"GIF89".as_slice(), b"GIF90a\x04\x00\x02\x00"] {
        assert!(registry::by_head(head).is_none());
        assert_eq!(
            registry::decode(head, MAX_ALLOC).err(),
            Some("image-format-unknown")
        );
    }
}

/// Les octets rendus par le registre pour des octets tenus en mémoire, sans passer par un fichier.
fn rendu_octets(bytes: &[u8]) -> Vec<u8> {
    rgba8(registry::decode(bytes, MAX_ALLOC).expect("décodé"))
        .as_raw()
        .clone()
}
