//! Les morceaux d'un PNG, parcourus d'un bout à l'autre selon la structure que la spécification
//! W3C / ISO-IEC 15948 fixe : après les huit octets de signature, chaque morceau porte sa longueur
//! sur quatre octets, son type sur quatre, ses données, puis son CRC sur quatre.
//!
//! Ce module ne décode aucun pixel : il rend le type et les données de chaque morceau, pour que le
//! pilote lise ce que le fichier **déclare** — une animation, un profil colorimétrique — là où le
//! décodeur de pixels, lui, ne regarde que l'image par défaut. La longueur est jugée contre ce qui
//! reste du fichier : un fichier coupé arrête le parcours, il ne lit jamais à côté.

/// Les huit octets de signature, que le parcours saute avant le premier morceau.
const SIGNATURE: usize = 8;
/// L'entête d'un morceau : quatre octets de longueur, quatre de type.
const CHUNK_HEADER: usize = 8;
/// Le CRC-32 qui ferme un morceau. Il n'est pas vérifié ici : c'est l'affaire du décodeur de
/// pixels, qui refuse le fichier entier quand il ne retombe pas.
const CRC: usize = 4;

/// Le curseur qui avance d'un morceau au suivant.
pub(super) struct Chunks<'a> {
    rest: &'a [u8],
}

/// Les morceaux de ce fichier, du premier — toujours l'IHDR — au dernier qui tient entier.
pub(super) fn of(bytes: &[u8]) -> Chunks<'_> {
    Chunks {
        rest: bytes.get(SIGNATURE..).unwrap_or_default(),
    }
}

impl<'a> Iterator for Chunks<'a> {
    /// Le type du morceau sur quatre octets, et ses données.
    type Item = (&'a [u8], &'a [u8]);

    fn next(&mut self) -> Option<Self::Item> {
        let head = self.rest.get(..CHUNK_HEADER)?;
        let length =
            usize::try_from(u32::from_be_bytes([head[0], head[1], head[2], head[3]])).ok()?;
        let end = CHUNK_HEADER.checked_add(length)?;
        let data = self.rest.get(CHUNK_HEADER..end)?;
        let kind = &self.rest[4..CHUNK_HEADER];
        self.rest = self.rest.get(end + CRC..).unwrap_or_default();
        Some((kind, data))
    }
}
