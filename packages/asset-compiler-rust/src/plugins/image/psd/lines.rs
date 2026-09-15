//! Une ligne de plan après l'autre, dans l'une ou l'autre écriture du composite : la surface brute,
//! ou les lignes compressées par plages selon PackBits, tel que la spécification du format les
//! décrit. Ce module ne sait rien des canaux ni des couleurs — il rend des octets de ligne.
use super::{Header, COMPRESSION_UNSUPPORTED, DATA_TRUNCATED};

/// Les deux écritures du sous-ensemble : la surface brute, et les lignes compressées par plages.
const RAW: u16 = 0;
const RLE: u16 = 1;
/// La largeur d'une entrée de la table des longueurs de ligne, PSD puis PSB.
const COUNT_PSD: usize = 2;
const COUNT_PSB: usize = 4;
/// L'octet de contrôle que PackBits réserve : il ne décrit aucun paquet et ne fait rien avancer.
const NO_OP: i8 = -128;

/// Le curseur qui avance d'une ligne de plan à la suivante, dans l'une ou l'autre écriture.
pub(super) struct Lines<'a> {
    /// La table des longueurs compressées, une entrée par ligne et par canal, dans l'ordre des
    /// plans. Vide quand les lignes sont brutes.
    counts: &'a [u8],
    data: &'a [u8],
    at: usize,
    width: usize,
    count_bytes: usize,
}

impl<'a> Lines<'a> {
    /// La table d'abord, quand il y en a une : sa taille se déduit de l'entête, et un fichier qui
    /// ne la porte pas entière est tronqué avant qu'un seul pixel ne soit alloué.
    pub(super) fn new(
        header: &Header,
        compression: u16,
        body: &'a [u8],
    ) -> std::result::Result<Self, &'static str> {
        let count_bytes = if header.psb { COUNT_PSB } else { COUNT_PSD };
        let mut lines = Self {
            counts: &[],
            data: body,
            at: 0,
            width: header.width as usize,
            count_bytes,
        };
        match compression {
            RAW => Ok(lines),
            RLE => {
                let table = (header.channels * header.height as usize)
                    .checked_mul(count_bytes)
                    .ok_or(DATA_TRUNCATED)?;
                lines.counts = body.get(..table).ok_or(DATA_TRUNCATED)?;
                lines.data = &body[table..];
                Ok(lines)
            }
            _ => Err(COMPRESSION_UNSUPPORTED),
        }
    }

    /// La ligne numéro `index` — canal fois hauteur, plus la ligne —, développée dans `into`.
    pub(super) fn read(
        &mut self,
        index: usize,
        into: &mut [u8],
    ) -> std::result::Result<(), &'static str> {
        if self.counts.is_empty() {
            let end = self.at.checked_add(self.width).ok_or(DATA_TRUNCATED)?;
            into.copy_from_slice(self.data.get(self.at..end).ok_or(DATA_TRUNCATED)?);
            self.at = end;
            return Ok(());
        }
        let count = self.count(index)?;
        let end = self.at.checked_add(count).ok_or(DATA_TRUNCATED)?;
        let packed = self.data.get(self.at..end).ok_or(DATA_TRUNCATED)?;
        self.at = end;
        unpack(packed, into)
    }

    /// La longueur compressée que la table donne à cette ligne.
    fn count(&self, index: usize) -> std::result::Result<usize, &'static str> {
        let field = self
            .counts
            .get(index * self.count_bytes..)
            .and_then(|rest| rest.get(..self.count_bytes))
            .ok_or(DATA_TRUNCATED)?;
        match field {
            [high, low] => Ok(usize::from(u16::from_be_bytes([*high, *low]))),
            [a, b, c, d] => {
                usize::try_from(u32::from_be_bytes([*a, *b, *c, *d])).map_err(|_| DATA_TRUNCATED)
            }
            _ => Err(DATA_TRUNCATED),
        }
    }
}

/// Une ligne PackBits, telle que la spécification la décrit : un octet de contrôle signé, puis un
/// paquet brut de `n + 1` octets quand il est positif, ou la répétition de l'octet suivant
/// `1 - n` fois quand il est négatif. Dans les deux cas la longueur vaut `|n| + 1`. La ligne doit
/// rendre exactement sa largeur : une plage qui la dépasse, comme des octets qui manquent, est un
/// refus nommé — jamais une ligne à moitié.
fn unpack(packed: &[u8], into: &mut [u8]) -> std::result::Result<(), &'static str> {
    let mut at = 0;
    let mut written = 0;
    while written < into.len() {
        let control = *packed.get(at).ok_or(DATA_TRUNCATED)? as i8;
        at += 1;
        if control == NO_OP {
            continue;
        }
        let run = usize::from(control.unsigned_abs()) + 1;
        let target = into
            .get_mut(written..)
            .and_then(|rest| rest.get_mut(..run))
            .ok_or(DATA_TRUNCATED)?;
        if control < 0 {
            target.fill(*packed.get(at).ok_or(DATA_TRUNCATED)?);
            at += 1;
        } else {
            let source = packed
                .get(at..)
                .and_then(|rest| rest.get(..run))
                .ok_or(DATA_TRUNCATED)?;
            target.copy_from_slice(source);
            at += run;
        }
        written += run;
    }
    Ok(())
}
