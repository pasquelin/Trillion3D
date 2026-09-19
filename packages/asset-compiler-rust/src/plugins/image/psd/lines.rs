//! One plane line after another, in one or the other writing of the composite: the raw
//! surface, or the lines run-length compressed as PackBits, as the format specification
//! describes them. This module knows nothing of channels or colours — it returns line bytes.
use super::{Header, COMPRESSION_UNSUPPORTED, DATA_TRUNCATED};

/// The two writings of the subset: the raw surface, and the run-length compressed lines.
const RAW: u16 = 0;
const RLE: u16 = 1;
/// Width of an entry of the line-length table, PSD then PSB.
const COUNT_PSD: usize = 2;
const COUNT_PSB: usize = 4;
/// Control byte that PackBits reserves: it describes no packet and does not advance.
const NO_OP: i8 = -128;

/// Cursor that advances from one plane line to the next, in one or the other writing.
pub(super) struct Lines<'a> {
    /// Table of compressed lengths, one entry per line and per channel, in plane order.
    /// Empty when the lines are raw.
    counts: &'a [u8],
    data: &'a [u8],
    at: usize,
    width: usize,
    count_bytes: usize,
}

impl<'a> Lines<'a> {
    /// The table first, when there is one: its size is deduced from the header, and a file
    /// that does not carry it whole is truncated before a single pixel is allocated.
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

    /// Line number `index` — channel times height, plus the line —, expanded into `into`.
    pub(super) fn read(
        &mut self,
        index: usize,
        into: &mut [u8],
    ) -> std::result::Result<(), &'static str> {
        if self.counts.is_empty() {
            into.copy_from_slice(self.take(self.width)?);
            return Ok(());
        }
        let count = self.count(index)?;
        let packed = self.take(count)?;
        unpack(packed, into)
    }

    /// The next `n` bytes of the body, the cursor moved past them; a body that does not
    /// carry them whole is truncated.
    fn take(&mut self, n: usize) -> std::result::Result<&'a [u8], &'static str> {
        let end = self.at.checked_add(n).ok_or(DATA_TRUNCATED)?;
        let bytes = self.data.get(self.at..end).ok_or(DATA_TRUNCATED)?;
        self.at = end;
        Ok(bytes)
    }

    /// Compressed length that the table gives this line.
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

/// A PackBits line, as the specification describes it: a signed control byte, then a raw
/// packet of `n + 1` bytes when it is positive, or the repetition of the next byte `1 - n`
/// times when it is negative. In both cases the length is `|n| + 1`. The line must yield
/// exactly its width: a run that overflows it, like missing bytes, is a named refusal —
/// never a half line.
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
