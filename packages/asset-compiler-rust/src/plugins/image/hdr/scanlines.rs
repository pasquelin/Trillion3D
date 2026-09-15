//! Les lignes de pixels d'un Radiance HDR, dans les trois écritures que la spécification définit,
//! et la conversion RGBE → flottant linéaire.
//!
//! Une ligne est soit brute — quatre octets par pixel —, soit compressée par plages. La compression
//! « ancienne » de « Real Pixels » répète le pixel précédent par un marqueur `1,1,1,n` ; la
//! « nouvelle », apparue avec Radiance 2.0 et annoncée par l'entête `2, 2, largeur`, compresse les
//! quatre composantes séparément, chacune en paquets bruts (compte ≤ 128) et en plages (compte
//! > 128). Les deux écrivent exactement les mêmes pixels : c'est la même ligne dite autrement.

/// Les octets annoncés ne sont pas tous là, une plage déborde de sa ligne, ou un paquet n'avance
/// pas. Pour l'hôte, c'est le symptôme d'un fichier coupé, et la texture retombe sur son blanc.
const TRUNCATED: &str = "hdr-data-truncated";
/// Largeurs dans lesquelles la nouvelle compression peut s'écrire : en dehors, un entête `2,2,…`
/// est un pixel ordinaire dont la mantisse rouge vaut 2, pas une annonce de compression.
const NEW_RLE_WIDTHS: std::ops::RangeInclusive<usize> = 8..=0x7fff;
/// Au-delà de ce compte, un paquet de la nouvelle compression est une plage, et sa longueur est la
/// différence ; en deçà ou à égalité, c'est un paquet brut de `compte` octets.
const RUN_MARK: u8 = 128;
/// Le marqueur de plage de l'ancienne compression : les trois mantisses à un.
const OLD_RUN_MARKER: [u8; 3] = [1, 1, 1];
/// Décalage de l'exposant RGBE : la mantisse est une fraction sur huit bits et l'exposant est
/// biaisé de 128, d'où `valeur = mantisse × 2^(e - 128 - 8)`.
const EXPONENT_BIAS: i32 = 136;
/// Décalage et biais de l'exposant d'un flottant double, pour écrire `2^k` sans passer par une
/// fonction de puissance : à ces exposants-là, le résultat doit être exact.
const F64_MANTISSA_BITS: u32 = 52;
const F64_EXPONENT_BIAS: i32 = 1023;

/// Les `height` lignes de `width` pixels, en RGBA flottant, ligne du haut d'abord. L'alpha est
/// opaque partout : le format ne porte pas de canal de transparence, et en inventer un serait
/// mentir — d'où le tampon rempli de 1 dont seuls les trois premiers canaux sont réécrits.
pub(super) fn decode(
    body: &[u8],
    width: u32,
    height: u32,
) -> std::result::Result<Vec<f32>, &'static str> {
    let width = width as usize;
    let mut out = vec![1.0_f32; width * height as usize * 4];
    let mut row = vec![[0_u8; 4]; width];
    let mut rest = body;
    for y in 0..height as usize {
        rest = scanline(rest, &mut row)?;
        for (x, rgbe) in row.iter().enumerate() {
            let at = (y * width + x) * 4;
            out[at..at + 3].copy_from_slice(&to_linear(*rgbe));
        }
    }
    Ok(out)
}

/// Une ligne, dans l'écriture que ses quatre premiers octets annoncent.
fn scanline<'a>(
    body: &'a [u8],
    row: &mut [[u8; 4]],
) -> std::result::Result<&'a [u8], &'static str> {
    let head: [u8; 4] = body
        .get(..4)
        .and_then(|head| head.try_into().ok())
        .ok_or(TRUNCATED)?;
    let announced = usize::from(u16::from_be_bytes([head[2], head[3]]));
    if head[0] == 2 && head[1] == 2 && announced == row.len() && NEW_RLE_WIDTHS.contains(&row.len())
    {
        return new_rle(&body[4..], row);
    }
    old_rle(body, row)
}

/// La nouvelle compression : les quatre composantes l'une après l'autre, chacune en paquets bruts
/// et en plages, jusqu'à ce que la ligne soit pleine. Un paquet vide n'avancerait pas, un paquet
/// qui déborde de la ligne ment sur sa longueur : les deux sont des refus.
fn new_rle<'a>(
    mut body: &'a [u8],
    row: &mut [[u8; 4]],
) -> std::result::Result<&'a [u8], &'static str> {
    for component in 0..4 {
        let mut at = 0;
        while at < row.len() {
            let (count, tail) = body.split_first().ok_or(TRUNCATED)?;
            body = tail;
            let is_run = *count > RUN_MARK;
            let run = usize::from(if is_run { *count - RUN_MARK } else { *count });
            if run == 0 {
                return Err(TRUNCATED);
            }
            let span = row.get_mut(at..at + run).ok_or(TRUNCATED)?;
            if is_run {
                let (value, tail) = body.split_first().ok_or(TRUNCATED)?;
                body = tail;
                for pixel in span {
                    pixel[component] = *value;
                }
            } else {
                let values = body.get(..run).ok_or(TRUNCATED)?;
                body = &body[run..];
                for (pixel, value) in span.iter_mut().zip(values) {
                    pixel[component] = *value;
                }
            }
            at += run;
        }
    }
    Ok(body)
}

/// L'ancienne compression, qui est aussi le cas brut : des pixels tels quels, et un marqueur
/// `1,1,1,n` qui répète le précédent. Des marqueurs consécutifs se multiplient par 256, ce qui
/// permet des plages plus longues que 255 ; le premier pixel d'une ligne ne peut pas en être un.
fn old_rle<'a>(
    mut body: &'a [u8],
    row: &mut [[u8; 4]],
) -> std::result::Result<&'a [u8], &'static str> {
    let mut at = 0;
    let mut multiplier = 1_usize;
    let mut previous = [0_u8; 4];
    while at < row.len() {
        let pixel: [u8; 4] = body
            .get(..4)
            .and_then(|head| head.try_into().ok())
            .ok_or(TRUNCATED)?;
        body = &body[4..];
        if pixel[..3] != OLD_RUN_MARKER {
            multiplier = 1;
            previous = pixel;
            row[at] = pixel;
            at += 1;
            continue;
        }
        if at == 0 {
            return Err(TRUNCATED);
        }
        let run = usize::from(pixel[3])
            .checked_mul(multiplier)
            .ok_or(TRUNCATED)?;
        multiplier = multiplier.saturating_mul(256);
        for slot in row.get_mut(at..at + run).ok_or(TRUNCATED)? {
            *slot = previous;
        }
        at += run;
    }
    Ok(body)
}

/// Un pixel RGBE vers trois flottants linéaires. L'exposant nul est le zéro du format, pas une
/// petite valeur. L'échelle `2^(e - 136)` est construite bit à bit en double précision — son
/// exposant tient entre -135 et 119, donc toujours normal — puis le produit n'est arrondi qu'une
/// fois, au passage en simple précision : la valeur rendue est celle que le fichier décrit.
fn to_linear(pixel: [u8; 4]) -> [f32; 3] {
    if pixel[3] == 0 {
        return [0.0; 3];
    }
    let exponent = i32::from(pixel[3]) - EXPONENT_BIAS + F64_EXPONENT_BIAS;
    let scale = f64::from_bits((exponent as u64) << F64_MANTISSA_BITS);
    [
        (f64::from(pixel[0]) * scale) as f32,
        (f64::from(pixel[1]) * scale) as f32,
        (f64::from(pixel[2]) * scale) as f32,
    ]
}
