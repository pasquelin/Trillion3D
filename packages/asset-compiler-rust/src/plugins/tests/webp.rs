//! La dorée du pilote WebP : le seul flux que la politique admet — `VP8L`, sans perte — rend les
//! pixels du fichier, simple conteneur comme conteneur étendu, et tout le reste est refusé en le
//! nommant. C'est la seconde moitié du contrat qui compte ici : un flux avec perte n'est jamais
//! décodé, parce qu'accepter la perte de la source serait accepter la perte tout court.
use super::super::image as registry;
use super::fixture;
use std::path::PathBuf;

const MAX_ALLOC: u64 = 4 * 1024 * 1024;
/// Les fixtures font 256 × 256 en RGBA8, soit 262 144 octets : ce plafond ne les laisse pas passer.
const MAX_ALLOC_TROP_PETIT: u64 = 64 * 1024;

/// Cinq texels de `sans-perte.webp` — quatre coins puis le centre —, vérifiés par un décodeur
/// indépendant (Pillow 12.2.0) avant d'être écrits ici. Les alphas 0 et 255 s'y côtoient : un canal
/// alpha rempli d'office ou prémultiplié se verrait au premier coup d'œil.
const TEXELS: [(u32, u32, [u8; 4]); 5] = [
    (0, 0, [0, 0, 30, 0]),
    (255, 0, [255, 0, 220, 255]),
    (0, 255, [0, 255, 220, 255]),
    (255, 255, [255, 255, 30, 0]),
    (128, 128, [128, 128, 30, 0]),
];

/// L'image que le registre rend pour cette fixture.
fn rendu(name: &str) -> image::RgbaImage {
    let bytes = fixture("webp", name);
    let pilote = registry::by_head(&bytes).expect("un pilote revendique ces octets");
    assert_eq!(pilote.name(), "webp", "{name}");
    let registry::DecodedImage::Rgba8(rendu) =
        registry::decode(&bytes, MAX_ALLOC).unwrap_or_else(|erreur| panic!("{name}: {erreur}"));
    assert_eq!((rendu.width(), rendu.height()), (256, 256), "{name}");
    rendu
}

// Dorée du pilote WebP : un flux sans perte rend ses pixels tels quels, et le conteneur étendu — ses
// chunks de métadonnées franchis — rend exactement les mêmes octets. Sans perte veut dire : pas un
// octet de différence, d'une écriture du format à l'autre.
#[test]
fn les_deux_ecritures_du_sans_perte_rendent_les_memes_octets() {
    let simple = rendu("sans-perte.webp");
    for (x, y, attendu) in TEXELS {
        assert_eq!(simple.get_pixel(x, y).0, attendu, "texel ({x}, {y})");
    }
    assert_eq!(
        rendu("etendu-sans-perte.webp").as_raw(),
        simple.as_raw(),
        "le conteneur étendu porte le même VP8L : ses ICCP et son entête ne touchent aucun pixel"
    );
}

// Contrat du pilote : ce qu'il reconnaît, ce qu'il refuse, et sous quel nom il le rapporte. Un WebP
// refusé laisse le moteur retomber sur son blanc ; il n'interrompt aucune compilation et ne panique
// jamais. La politique d'import n'admet WebP que sans perte : le flux `VP8 ` est donc écarté avant
// tout décodage, et une animation aussi — l'aplatir sur une image choisie d'office serait arbitraire.
#[test]
fn un_webp_hors_politique_ressort_en_raison_de_rapport_jamais_en_panique() {
    for extension in ["webp", "WebP", "WEBP"] {
        let chemin = PathBuf::from(format!("albedo.{extension}"));
        let pilote = registry::by_extension(&chemin).expect("revendiqué");
        assert_eq!(pilote.name(), "webp", "{extension}");
        assert_eq!(pilote.mime(), "image/webp");
    }
    for (name, raison) in [
        // Conteneur étendu, `ALPH` puis le flux avec perte : le pilote parcourt les chunks, il ne
        // se contente pas de regarder le premier.
        ("avec-perte.webp", "image-lossy-unsupported"),
        ("anime.webp", "image-animation-unsupported"),
        // Tronqué : l'entête reste un entête WebP, donc le pilote est choisi, et c'est la taille
        // annoncée par `RIFF` — plus grande que le fichier — qui arrête la lecture.
        ("tronque.webp", "image-decode-failed"),
    ] {
        let bytes = fixture("webp", name);
        assert_eq!(
            registry::by_head(&bytes).map(|pilote| pilote.name()),
            Some("webp"),
            "{name}"
        );
        assert_eq!(
            registry::decode(&bytes, MAX_ALLOC).err(),
            Some(raison),
            "{name}"
        );
    }
    // Le flux avec perte sans conteneur étendu — le premier chunk du fichier — suit le même chemin.
    let mut nu = fixture("webp", "sans-perte.webp");
    nu[12..16].copy_from_slice(b"VP8 ");
    assert_eq!(
        registry::decode(&nu, MAX_ALLOC).err(),
        Some("image-lossy-unsupported")
    );
    // Un conteneur entier mais sans flux d'image : douze octets d'entête et rien derrière.
    assert_eq!(
        registry::decode(b"RIFF\x04\x00\x00\x00WEBP", MAX_ALLOC).err(),
        Some("image-decode-failed")
    );
    // Le plafond d'allocation est une limite, pas une suggestion : au-dessus, c'est un refus.
    assert_eq!(
        registry::decode(&fixture("webp", "sans-perte.webp"), MAX_ALLOC_TROP_PETIT).err(),
        Some("image-decode-failed")
    );
    // RIFF sert à d'autres formats : sans le type de formulaire `WEBP`, le pilote ne revendique
    // rien, et ces octets ressortent en format inconnu plutôt qu'en WebP illisible.
    for head in [
        b"RIFF\x24\x00\x00\x00WAVEfmt ".as_slice(),
        b"RIFF\x24\x00\x00",
    ] {
        assert!(registry::by_head(head).is_none());
        assert_eq!(
            registry::decode(head, MAX_ALLOC).err(),
            Some("image-format-unknown")
        );
    }
}
