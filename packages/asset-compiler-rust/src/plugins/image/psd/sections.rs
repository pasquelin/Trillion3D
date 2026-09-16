//! Les trois sections à longueur préfixée qui séparent l'entête d'un PSD de ses données composites,
//! et ce qu'elles **déclarent** : données de mode de couleur, ressources d'image, calques et masques.
//!
//! Elles ne sont pas recomposées — le pilote ne rend que le composite aplati que le fichier porte
//! déjà —, mais elles ne sont plus sautées en aveugle non plus. La spécification publiée par Adobe
//! pour les lecteurs tiers place au début de la section des calques un **compte de calques** sur
//! deux octets signés, et dit de son signe : négatif, sa valeur absolue est le nombre de calques et
//! le premier canal alpha du composite porte la transparence du document. C'est la seule
//! déclaration qui sépare une transparence d'un canal alpha enregistré — une sélection —, et sans
//! elle un quatrième plan pris pour de l'alpha troue la texture.
//!
//! La section des ressources d'image est lue de la même façon, pour une seule de ses entrées : la
//! ressource 1039, qui porte le profil colorimétrique du document. La sortie du contrat est du sRGB
//! et ce lot ne convertit aucune couleur : un autre profil est compté, jamais appliqué.
use super::{Header, DATA_TRUNCATED};
use crate::plugins::image::icc;

/// La largeur du champ de longueur de la section des calques, et de celui du bloc d'informations de
/// calques qu'elle ouvre : quatre octets en PSD, huit en PSB.
const WIDE: usize = 8;
const NARROW: usize = 4;
/// Le compte de calques lui-même, deux octets signés.
const COUNT_BYTES: usize = 2;
/// La signature que chaque bloc de la section des ressources d'image porte en tête.
const RESOURCE: &[u8] = b"8BIM";
/// L'identifiant de la ressource qui porte le profil colorimétrique du document.
const ICC_PROFILE: u16 = 1039;
/// Ce qu'un bloc de ressource porte avant son nom : sa signature et son identifiant.
const RESOURCE_HEAD: usize = 6;

/// Ce que les sections déclarent, et que l'entête seul ne dit pas.
pub(super) struct Declared {
    /// Le composite porte la transparence du document dans son premier plan d'alpha. Faux quand
    /// rien ne le déclare : le plan qui suit les canaux de couleur est alors une sélection.
    pub(super) transparency: bool,
    /// Le nombre de calques du fichier. Seul le composite sort du pilote : au-delà de zéro, c'est
    /// une raison de rapport, jamais un silence.
    pub(super) layers: u32,
    /// La raison à compter pour le profil colorimétrique du document, quand il n'est pas celui de
    /// la sortie.
    pub(super) profile: Option<&'static str>,
}

/// Saute les trois sections et rend ce qu'elles déclarent avec les octets qui les suivent. Une
/// longueur qui sort du fichier est une troncature nommée, jamais une lecture à côté.
pub(super) fn walk<'a>(
    header: &Header,
    after_header: &'a [u8],
) -> std::result::Result<(Declared, &'a [u8]), &'static str> {
    // Les deux premières longueurs tiennent sur quatre octets dans les deux versions du format ;
    // seule celle de la section des calques double de largeur en PSB.
    let mut rest = skip(after_header, NARROW)?;
    let profile = profile(rest);
    rest = skip(rest, NARROW)?;
    let wide = if header.psb { WIDE } else { NARROW };
    let mut declared = layers(rest, wide);
    declared.profile = profile;
    Ok((declared, skip(rest, wide)?))
}

/// La raison à compter pour la ressource 1039, cherchée bloc par bloc dans la section des
/// ressources d'image. Un bloc est la signature `8BIM`, l'identifiant sur deux octets, un nom Pascal
/// complété jusqu'à une longueur paire, la longueur des données, puis les données elles-mêmes,
/// complétées de la même façon. Une section absente ou incohérente ne déclare rien.
fn profile(bytes: &[u8]) -> Option<&'static str> {
    let mut rest = field(bytes, NARROW).and_then(|length| bytes.get(NARROW..NARROW + length))?;
    while let Some(head) = rest.get(..RESOURCE_HEAD) {
        if !head.starts_with(RESOURCE) {
            return None;
        }
        let id = u16::from_be_bytes([head[4], head[5]]);
        let name = usize::from(*rest.get(RESOURCE_HEAD)?) + 1;
        let at = RESOURCE_HEAD + name.next_multiple_of(2);
        let length = field(rest.get(at..)?, NARROW)?;
        let data = rest.get(at + NARROW..at + NARROW + length)?;
        if id == ICC_PROFILE {
            return icc::note(data);
        }
        rest = rest.get(at + NARROW + length.next_multiple_of(2)..)?;
    }
    None
}

/// Le compte de calques, lu au début de la section des calques quand elle en porte un. Une section
/// vide, ou trop courte pour son bloc d'informations de calques, ne déclare rien : c'est le cas d'un
/// document sans calque, dont un plan supplémentaire ne peut être qu'une sélection.
fn layers(bytes: &[u8], wide: usize) -> Declared {
    let count = count(bytes, wide);
    Declared {
        transparency: count.is_some_and(|count| count < 0),
        layers: count.map_or(0, |count| count.unsigned_abs().into()),
        profile: None,
    }
}

/// Le compte lui-même, quand la section le porte. Le bloc d'informations de calques ouvre la
/// section par sa propre longueur : sous deux octets, il n'y a pas de compte à lire.
fn count(bytes: &[u8], wide: usize) -> Option<i16> {
    let section = field(bytes, wide).and_then(|length| bytes.get(wide..wide + length))?;
    let info = field(section, wide)?;
    let count = section
        .get(wide..wide + COUNT_BYTES)
        .filter(|_| info >= COUNT_BYTES)?;
    Some(i16::from_be_bytes([count[0], count[1]]))
}

/// La longueur que porte un champ de `width` octets en tête de ces octets, gros-boutien comme tout
/// le format. Un champ absent ou une longueur qui ne tient pas dans un `usize` rendent `None`.
fn field(bytes: &[u8], width: usize) -> Option<usize> {
    let field = bytes.get(..width)?;
    let length = field
        .iter()
        .fold(0u64, |value, byte| value << 8 | u64::from(*byte));
    usize::try_from(length).ok()
}

/// Une section à longueur préfixée, sautée par sa longueur.
fn skip(bytes: &[u8], width: usize) -> std::result::Result<&[u8], &'static str> {
    let end = field(bytes, width)
        .and_then(|length| width.checked_add(length))
        .ok_or(DATA_TRUNCATED)?;
    bytes.get(end..).ok_or(DATA_TRUNCATED)
}
