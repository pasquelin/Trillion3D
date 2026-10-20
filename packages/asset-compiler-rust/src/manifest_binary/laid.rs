//! Where each column of a sidecar page lies, and the page's bytes laid from that placement.
use super::*;

impl Encoded {
    /// The columns of the primitives of `range` and of `previews`, as `page` lays them when
    /// written: for a page whose small JSON was already measured.
    pub fn bytes(
        &self,
        range: std::ops::Range<usize>,
        previews: &[TexturePreview],
    ) -> Result<Vec<u8>> {
        Ok(self.write(&self.laid(range, previews)?))
    }

    /// Where each column of the page over `range` and `previews` lies, `previews` encoded.
    pub(super) fn laid(
        &self,
        range: std::ops::Range<usize>,
        previews: &[TexturePreview],
    ) -> Result<Laid> {
        let mut own: Vec<Column> = (0..COLUMNS).map(|_| Column::default()).collect();
        preview::encode_previews(previews, &mut own)?;
        let (start, end) = (self.starts[range.start], self.starts[range.end]);
        let lengths: [usize; COLUMNS] =
            std::array::from_fn(|c| end[c] - start[c] + own[c].bytes.len());
        let header_bytes = (MANIFEST_BINARY_HEADER_WORDS + COLUMNS * 2) * 4;
        let mut offsets = [0usize; COLUMNS];
        let mut total = header_bytes.next_multiple_of(8);
        for index in 0..COLUMNS {
            offsets[index] = total;
            total = (total + lengths[index]).next_multiple_of(8);
        }
        u32::try_from(total).map_err(|_| MANIFEST.bad("Manifest binary exceeds four gigabytes"))?;
        Ok(Laid {
            own,
            start,
            end,
            lengths,
            offsets,
            total,
        })
    }

    /// The sidecar's bytes as `laid` places them.
    pub(super) fn write(&self, laid: &Laid) -> Vec<u8> {
        let mut bytes = vec![0u8; laid.total];
        bytes[0..4].copy_from_slice(&MANIFEST_BINARY_MAGIC.to_le_bytes());
        bytes[4..8].copy_from_slice(&MANIFEST_BINARY_VERSION.to_le_bytes());
        bytes[8..12].copy_from_slice(&(COLUMNS as u32).to_le_bytes());
        for index in 0..COLUMNS {
            let (offset, length) = (laid.offsets[index], laid.lengths[index]);
            let at = (MANIFEST_BINARY_HEADER_WORDS + index * 2) * 4;
            bytes[at..at + 4].copy_from_slice(&(offset as u32).to_le_bytes());
            bytes[at + 4..at + 8].copy_from_slice(&(length as u32).to_le_bytes());
            // A column's bytes: the range's primitives', then the previews' — never both in one.
            let own = &self.columns[index].bytes[laid.start[index]..laid.end[index]];
            let mut start = offset;
            for part in [own, &laid.own[index].bytes[..]] {
                bytes[start..start + part.len()].copy_from_slice(part);
                start += part.len();
            }
        }
        bytes
    }
}

/// A page's columns placed (`Encoded::laid`): the previews' encoded, where the range's start and
/// end in each shared column, each column's length and offset, and the sidecar's bytes.
pub(super) struct Laid {
    pub(super) own: Vec<Column>,
    pub(super) start: [usize; COLUMNS],
    pub(super) end: [usize; COLUMNS],
    pub(super) lengths: [usize; COLUMNS],
    pub(super) offsets: [usize; COLUMNS],
    pub(super) total: usize,
}
