//! Les deux formats EAC non signés d'un KTX 2.0 — R11 et RG11 —, développés ici en onze bits, puis
//! ramenés aux huit du contrat par un arrondi au plus proche.
//!
//! Pourquoi ne pas s'en remettre à `texture2ddecoder`, qui développe tous les autres blocs ? Parce
//! que son chemin EAC rend directement des octets, par `val >> 3` : les trois bits de poids faible
//! des onze disparaissent par troncature, et une valeur sur huit ressort d'un cran trop bas. Il lit
//! de plus le champ d'indices par `u64::from_le_bytes` là où son propre chemin d'alpha ETC2, qui
//! suit le même ordre d'écriture, lit `from_be_bytes` : les seize texels d'un bloc en sortent
//! mélangés. Les deux défauts tombent avec ce décodeur, écrit depuis la spécification publique
//! d'OpenGL ES 3.0 (« ETC2/EAC Compressed Texture Image Formats »).
//!
//! Le reste du pilote n'en sait rien : ces deux fonctions ont la signature que `image::blocks`
//! attend d'un décodeur de blocs, et s'inscrivent dans la même table de codecs que les autres.

/// Les seize jeux de huit modificateurs de la spécification, désignés par les quatre bits de poids
/// faible du second octet du bloc.
const MODIFIERS: [[i8; 8]; 16] = [
    [-3, -6, -9, -15, 2, 5, 8, 14],
    [-3, -7, -10, -13, 2, 6, 9, 12],
    [-2, -5, -8, -13, 1, 4, 7, 12],
    [-2, -4, -6, -13, 1, 3, 5, 12],
    [-3, -6, -8, -12, 2, 5, 7, 11],
    [-3, -7, -9, -11, 2, 6, 8, 10],
    [-4, -7, -8, -11, 3, 6, 7, 10],
    [-3, -5, -8, -11, 2, 4, 7, 10],
    [-2, -6, -8, -10, 1, 5, 7, 9],
    [-2, -5, -8, -10, 1, 4, 7, 9],
    [-2, -4, -8, -10, 1, 3, 7, 9],
    [-2, -5, -7, -10, 1, 4, 6, 9],
    [-3, -4, -7, -10, 2, 3, 6, 9],
    [-1, -2, -3, -10, 0, 1, 2, 9],
    [-4, -6, -8, -9, 3, 5, 7, 8],
    [-3, -5, -7, -9, 2, 4, 6, 8],
];

/// Les octets d'un bloc d'un canal, et le côté d'un bloc en texels.
const BLOCK: usize = 8;
const SIDE: usize = 4;
/// Le champ d'indices occupe les quarante-huit bits de poids faible du bloc, trois par texel, le
/// premier texel dans les bits de poids fort : son décalage est donc 45.
const TOP: u32 = 45;
const INDEX_BITS: u32 = 3;
/// La plus grande valeur d'un canal sur onze bits.
const MAX: i32 = 2047;
/// Où va un canal dans le mot de trente-deux bits d'un pixel, dont les octets sont B, G, R, A.
const RED: usize = 2;
const GREEN: usize = 1;
/// Le niveau ne porte pas tous les blocs que ses dimensions annoncent.
const SHORT: &str = "eac-level-short";

/// `VK_FORMAT_EAC_R11_UNORM_BLOCK` : un seul canal, rendu en rouge.
pub(super) fn r11(
    level: &[u8],
    width: usize,
    height: usize,
    image: &mut [u32],
) -> Result<(), &'static str> {
    planes(level, width, height, image, &[RED])
}

/// `VK_FORMAT_EAC_R11G11_UNORM_BLOCK` : deux canaux consécutifs, rouge puis vert.
pub(super) fn rg11(
    level: &[u8],
    width: usize,
    height: usize,
    image: &mut [u32],
) -> Result<(), &'static str> {
    planes(level, width, height, image, &[RED, GREEN])
}

/// Les blocs du niveau, rangée par rangée, chacun développé dans l'image. Un bloc déborde du bord
/// quand la largeur ou la hauteur n'est pas un multiple de quatre : les texels hors image sont
/// simplement laissés de côté, comme la spécification le prescrit.
fn planes(
    level: &[u8],
    width: usize,
    height: usize,
    image: &mut [u32],
    targets: &[usize],
) -> Result<(), &'static str> {
    let stride = BLOCK * targets.len();
    let (columns, rows) = (width.div_ceil(SIDE), height.div_ceil(SIDE));
    if level.len() < columns * rows * stride || image.len() < width * height {
        return Err(SHORT);
    }
    for row in 0..rows {
        for column in 0..columns {
            let at = (row * columns + column) * stride;
            // L'alpha d'un format EAC est opaque : ni R11 ni RG11 n'en portent.
            let mut texels = [[0, 0, 0, u8::MAX]; SIDE * SIDE];
            for (plane, target) in targets.iter().enumerate() {
                let block = &level[at + plane * BLOCK..at + (plane + 1) * BLOCK];
                channel(block, &mut texels, *target);
            }
            for (index, texel) in texels.iter().enumerate() {
                let (x, y) = (column * SIDE + index % SIDE, row * SIDE + index / SIDE);
                if x < width && y < height {
                    image[y * width + x] = u32::from_le_bytes(*texel);
                }
            }
        }
    }
    Ok(())
}

/// Un canal d'un bloc : le mot de base, le multiplicateur, la table de modificateurs, puis les seize
/// indices de trois bits. Les texels d'un bloc EAC se suivent colonne par colonne — le texel `n` est
/// à la colonne `n / 4`, ligne `n % 4` —, et `texels` les range en ordre de lecture.
fn channel(block: &[u8], texels: &mut [[u8; 4]; SIDE * SIDE], target: usize) {
    let base = i32::from(block[0]) * 8 + 4;
    let declared = i32::from(block[1] >> 4);
    // Un multiplicateur nul ne veut pas dire « pas de modificateur » : la spécification le lit
    // comme un, ce qui donne le pas le plus fin que le format sait écrire.
    let multiplier = if declared == 0 { 1 } else { declared * 8 };
    let table = MODIFIERS[usize::from(block[1] & 0xf)];
    let indices = u64::from_be_bytes(block[..BLOCK].try_into().unwrap_or([0; BLOCK]));
    for texel in 0..SIDE * SIDE {
        let index = (indices >> (TOP - INDEX_BITS * texel as u32)) & 7;
        let value = (base + multiplier * i32::from(table[index as usize])).clamp(0, MAX);
        let (x, y) = (texel / SIDE, texel % SIDE);
        texels[y * SIDE + x][target] = eight_bits(value);
    }
}

/// Onze bits ramenés à huit par l'arrondi au plus proche que la conversion de plage demande :
/// `v * 255 / 2047`, le demi ajouté avant la division entière. La troncature `v >> 3`, elle,
/// abaissait une valeur sur huit d'un cran — et 2047, la valeur pleine, n'y tombait juste que par
/// hasard.
fn eight_bits(value: i32) -> u8 {
    ((value as u32 * 255 + 1023) / 2047) as u8
}
