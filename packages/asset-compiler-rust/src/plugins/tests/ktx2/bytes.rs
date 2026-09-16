//! Les KTX 2.0 minuscules de la dorée, écrits ici octet par octet depuis la spécification publique
//! de Khronos. Aucun encodeur n'est appelé : l'identifiant, les neuf champs de l'entête, l'index des
//! trois sections et l'index des niveaux sont posés à la main, et chaque bloc porte des valeurs dont
//! on connaît le décodage exact. C'est la seule façon d'affirmer « sans perte » sans croire le
//! décodeur sur parole.
//!
//! Ces conteneurs ne portent ni descripteur de format, ni clés, ni donnée globale de
//! supercompression : le pilote ne les lit pas quand le `vkFormat` nomme le codec, et les fichiers
//! de `fixtures/ktx2/` couvrent le cas où il les lit.

/// Décalages absolus des champs que la dorée modifie après coup, identifiant compris.
pub(super) const FORMAT: usize = 12;
pub(super) const TYPE_SIZE: usize = 16;
pub(super) const WIDTH: usize = 20;
pub(super) const HEIGHT: usize = 24;
pub(super) const DEPTH: usize = 28;
pub(super) const LAYERS: usize = 32;
pub(super) const FACES: usize = 36;
pub(super) const LEVELS: usize = 40;
pub(super) const SUPERCOMPRESSION: usize = 44;
/// Fin de l'entête fixe, index des trois sections compris ; puis le début de l'index des niveaux.
pub(super) const HEADER_END: usize = 80;
/// Une entrée de l'index des niveaux : décalage, longueur, longueur une fois décompressée.
const LEVEL_ENTRY: usize = 24;

/// Les douze octets d'identifiant : « KTX 20 » entre guillemets français, CR, LF, SUB, LF.
const MAGIC: [u8; 12] = [
    0xab, b'K', b'T', b'X', b' ', b'2', b'0', 0xbb, 0x0d, 0x0a, 0x1a, 0x0a,
];

fn put(into: &mut Vec<u8>, value: u32) {
    into.extend_from_slice(&value.to_le_bytes());
}

fn put64(into: &mut Vec<u8>, value: u64) {
    into.extend_from_slice(&value.to_le_bytes());
}

/// Un conteneur d'un seul niveau, sans supercompression : le cas que presque toute la dorée veut,
/// et celui que les refus modifient ensuite champ par champ.
pub(super) fn container(format: u32, width: u32, height: u32, level: &[u8]) -> Vec<u8> {
    chain(format, width, height, level, 1)
}

/// Le même, dont l'entête annonce `levels` niveaux alors qu'un seul est écrit : les entrées
/// supplémentaires pointent au-delà de la fin du fichier, donc la chaîne annoncée ment.
pub(super) fn chain(format: u32, width: u32, height: u32, level: &[u8], levels: u32) -> Vec<u8> {
    described(format, width, height, level, levels, None, &[])
}

/// Le même conteneur, avec le descripteur de format et les clés que le pilote lit pour savoir ce
/// que le fichier déclare autour de ses pixels. `dfd` donne le `transferFunction` et les `flags` du
/// bloc de base ; `keys` donne les entrées de la section clé-valeur, dans l'ordre.
pub(super) fn described(
    format: u32,
    width: u32,
    height: u32,
    level: &[u8],
    levels: u32,
    dfd: Option<(u8, u8)>,
    keys: &[(&str, &str)],
) -> Vec<u8> {
    let count = levels.max(1) as usize;
    let descriptor = dfd.map(|(transfer, flags)| block(transfer, flags));
    let pairs = key_values(keys);
    let index = HEADER_END + count * LEVEL_ENTRY;
    let dfd_at = descriptor.as_ref().map_or(0, |_| index);
    let dfd_len = descriptor.as_ref().map_or(0, Vec::len);
    let kvd_at = if pairs.is_empty() { 0 } else { index + dfd_len };
    let data = index + dfd_len + pairs.len();
    let mut out = Vec::with_capacity(data + level.len());
    out.extend_from_slice(&MAGIC);
    for value in [format, 1, width, height, 0, 0, 1, levels, 0] {
        put(&mut out, value);
    }
    for value in [
        dfd_at as u32,
        dfd_len as u32,
        kvd_at as u32,
        pairs.len() as u32,
    ] {
        put(&mut out, value);
    }
    for _ in 0..2 {
        put64(&mut out, 0);
    }
    for value in [data as u64, level.len() as u64, level.len() as u64] {
        put64(&mut out, value);
    }
    for extra in 1..count {
        for value in [(data + level.len() + extra * 16) as u64, 16, 16] {
            put64(&mut out, value);
        }
    }
    out.extend_from_slice(&descriptor.unwrap_or_default());
    out.extend_from_slice(&pairs);
    out.extend_from_slice(level);
    out
}

/// Le descripteur de format, réduit à son bloc de base sans échantillon : sa taille totale, puis le
/// bloc lui-même — identifiant du fournisseur et type, version et taille du bloc, modèle de
/// couleur, primaires, fonction de transfert, drapeaux, géométrie du bloc de texels et poids des
/// plans. Seuls les deux octets du milieu intéressent le pilote.
fn block(transfer: u8, flags: u8) -> Vec<u8> {
    let mut out = Vec::new();
    put(&mut out, 28);
    put(&mut out, 0);
    put(&mut out, 24 << 16 | 2);
    // Modèle RVB avec alpha, primaires BT.709, puis la fonction de transfert et les drapeaux.
    out.extend_from_slice(&[1, 1, transfer, flags]);
    out.extend_from_slice(&[0; 12]);
    out
}

/// La section clé-valeur : chaque entrée porte sa longueur sur quatre octets, puis sa clé terminée
/// par un zéro, puis sa valeur terminée par un zéro, le tout complété jusqu'au multiple de quatre.
fn key_values(keys: &[(&str, &str)]) -> Vec<u8> {
    let mut out = Vec::new();
    for (key, value) in keys {
        let mut entry = Vec::from(key.as_bytes());
        entry.push(0);
        entry.extend_from_slice(value.as_bytes());
        entry.push(0);
        put(&mut out, entry.len() as u32);
        out.extend_from_slice(&entry);
        while out.len() % 4 != 0 {
            out.push(0);
        }
    }
    out
}

/// Le même fichier, un mot de trente-deux bits remplacé. Les refus s'écrivent ainsi : un conteneur
/// valide, puis exactement le champ que le cas met en défaut.
pub(super) fn patched(mut file: Vec<u8>, at: usize, value: u32) -> Vec<u8> {
    file[at..at + 4].copy_from_slice(&value.to_le_bytes());
    file
}

/// Le même fichier, un mot de soixante-quatre bits de l'index des niveaux remplacé.
pub(super) fn patched64(mut file: Vec<u8>, at: usize, value: u64) -> Vec<u8> {
    file[at..at + 8].copy_from_slice(&value.to_le_bytes());
    file
}

/// Un bloc BC1 de 4 × 4 : deux bornes en 565 puis seize indices de deux bits. Quand `first` est
/// inférieur à `second`, la spécification passe le bloc en trois couleurs, et l'indice 3 y désigne
/// un texel noir transparent — c'est ce qui sépare `BC1_RGB` de `BC1_RGBA`.
pub(super) fn bc1(first: u16, second: u16, indices: [u8; 16]) -> Vec<u8> {
    let mut block = Vec::from(first.to_le_bytes());
    block.extend_from_slice(&second.to_le_bytes());
    for row in indices.chunks(4) {
        block.push(row[0] | row[1] << 2 | row[2] << 4 | row[3] << 6);
    }
    block
}

/// Un bloc ASTC 4 × 4 « void extent » : la spécification le réserve à une couleur unique, et ses
/// quatre canaux y sont écrits en clair sur seize bits chacun. Aucune interpolation n'entre donc
/// dans la référence — le bloc vaut exactement la couleur qu'on y met.
pub(super) fn astc_void_extent(color: [u8; 4]) -> Vec<u8> {
    let mut block = vec![0xfc, 0xfd, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff];
    for channel in color {
        block.extend_from_slice(&[channel, channel]);
    }
    block
}

/// Un bloc EAC d'un canal, écrit depuis la spécification d'OpenGL ES 3.0 : le mot de base sur huit
/// bits, puis le multiplicateur et la table de modificateurs sur quatre bits chacun, puis seize
/// indices de trois bits — le texel 0 dans les bits de poids fort des quarante-huit qui restent.
/// Les texels s'y suivent colonne par colonne : le texel `n` est à la colonne `n / 4`, ligne `n % 4`.
pub(super) fn eac(base: u8, multiplier: u8, table: u8, indices: [u8; 16]) -> Vec<u8> {
    let mut field = 0u64;
    for (texel, index) in indices.into_iter().enumerate() {
        field |= u64::from(index & 7) << (45 - 3 * texel);
    }
    let mut block = vec![base, multiplier << 4 | (table & 0xf)];
    block.extend_from_slice(&field.to_be_bytes()[2..]);
    block
}
