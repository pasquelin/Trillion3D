//! The reader of an IES photometric file (IESNA LM-63, the 1986, 1991, 1995 and 2002 editions
//! alike: the edition line only tells the header from a file that starts straight at its keywords).
//!
//! What it reads, in order: the optional edition line; the keyword lines up to `TILT=NONE` (a file
//! with another tilt is refused); the numbers of the lamp and the grid; the vertical angles, the
//! horizontal angles, then the candela of every vertical angle of every horizontal angle, each
//! multiplied by the file's candela multiplier; and an optional `END`. The text is read as the
//! format's own readers read it: a number is the longest decimal prefix of a token (a token that
//! starts with none is 0), a line is at most 255 bytes, the bytes up to a space are a token.
use super::Photometry;

/// The longest line the reader keeps; a longer one is read as several.
const LINE_BYTES: usize = 255;

/// The bytes of a file, read line by line and token by token.
struct Text<'a> {
    bytes: &'a [u8],
    at: usize,
}

impl<'a> Text<'a> {
    /// The text of `file` up to its first NUL byte, which ends it.
    fn new(file: &'a [u8]) -> Self {
        let end = file.iter().position(|&b| b == 0).unwrap_or(file.len());
        Self {
            bytes: &file[..end],
            at: 0,
        }
    }

    fn done(&self) -> bool {
        self.at >= self.bytes.len()
    }

    /// Steps over the bytes that are no more than a space: spaces, tabs, line ends, controls.
    fn skip_space(&mut self) {
        while self.bytes.get(self.at).is_some_and(|&b| b <= b' ') {
            self.at += 1;
        }
    }

    /// The next line, or, with `token`, the next run of bytes up to a space; the space or the line
    /// end that closes it is consumed and not returned. Leading spaces are stepped over first.
    fn next(&mut self, token: bool) -> &'a [u8] {
        self.skip_space();
        let start = self.at;
        let mut length = 0;
        while length < LINE_BYTES {
            let Some(&b) = self.bytes.get(self.at) else {
                break;
            };
            if b == b'\r' && self.bytes.get(self.at + 1) == Some(&b'\n') {
                self.at += 2;
                return &self.bytes[start..start + length];
            }
            if b == b'\n' || (token && b <= b' ') {
                self.at += 1;
                return &self.bytes[start..start + length];
            }
            self.at += 1;
            length += 1;
        }
        &self.bytes[start..start + length]
    }

    fn float(&mut self) -> f32 {
        decimal(self.next(true))
    }

    fn integer(&mut self) -> i32 {
        whole(self.next(true))
    }
}

/// The longest prefix of `token` that is a decimal number: a sign, digits with an optional point,
/// an exponent when digits follow it. A token with none is 0.
fn number_prefix(token: &[u8]) -> &[u8] {
    let digits = |from: usize| token[from..].iter().take_while(|b| b.is_ascii_digit()).count();
    let mut end = usize::from(matches!(token.first(), Some(b'+' | b'-')));
    let whole = digits(end);
    end += whole;
    let mut fraction = 0;
    if token.get(end) == Some(&b'.') {
        fraction = digits(end + 1);
        end += 1 + fraction;
    }
    if whole + fraction == 0 {
        return &token[..0];
    }
    if matches!(token.get(end), Some(b'e' | b'E')) {
        let sign = usize::from(matches!(token.get(end + 1), Some(b'+' | b'-')));
        let exponent = digits(end + 1 + sign);
        if exponent > 0 {
            end += 1 + sign + exponent;
        }
    }
    &token[..end]
}

/// The decimal number a token starts with, as a single-precision float; 0 for none.
fn decimal(token: &[u8]) -> f32 {
    std::str::from_utf8(number_prefix(token))
        .ok()
        .and_then(|text| text.parse::<f64>().ok())
        .map_or(0.0, |value| value as f32)
}

/// The whole number a token starts with, held in the range of an `i32`; 0 for none.
fn whole(token: &[u8]) -> i32 {
    let sign = usize::from(matches!(token.first(), Some(b'+' | b'-')));
    let digits = token[sign..]
        .iter()
        .take_while(|b| b.is_ascii_digit())
        .fold(0i64, |sum, &b| {
            (sum * 10 + i64::from(b - b'0')).min(i64::from(i32::MAX) + 1)
        });
    let value = if token.first() == Some(&b'-') {
        -digits
    } else {
        digits
    };
    value.clamp(i64::from(i32::MIN), i64::from(i32::MAX)) as i32
}

/// The three editions that open a file with a line of their own.
const EDITION_LINES: [&[u8]; 3] = [b"IESNA:LM-63-1995", b"IESNA91", b"IESNA:LM-63-2002"];

/// The photometry of `file`, or why it is not read.
pub(super) fn parse(file: &[u8]) -> Result<Photometry, &'static str> {
    let mut text = Text::new(file);
    let first = text.next(false);
    if !EDITION_LINES
        .iter()
        .any(|edition| first.eq_ignore_ascii_case(edition))
    {
        text.at = 0;
    }
    header(&mut text)?;
    let lamp_count = text.integer();
    if lamp_count < 1 {
        return Err("the lamp count is not positive");
    }
    let _luminous_flux = text.float();
    let candela_multiplier = text.float();
    if candela_multiplier < 0.0 {
        return Err("the candela multiplier is negative");
    }
    let vertical_count = text.integer();
    let horizontal_count = text.integer();
    if vertical_count < 0 || horizontal_count < 0 {
        return Err("an angle count is negative");
    }
    // 1 is type C, 2 type B and 3 type A; any other number leaves the file read as type C.
    let type_a = text.integer() == 3;
    // The units, the luminous opening, the ballast, the future-use word and the input watts:
    // read to be stepped over, nothing of the picture depends on them.
    let _units = text.integer();
    for _ in 0..3 {
        text.float();
    }
    for _ in 0..3 {
        text.float();
    }
    let (vertical, horizontal) = (vertical_count as usize, horizontal_count as usize);
    // A grid needs at least a byte a number and one to part it from the next: a count beyond what
    // the file can hold is refused before anything is allocated for it.
    let numbers = vertical
        .checked_add(horizontal)
        .and_then(|angles| angles.checked_add(vertical.checked_mul(horizontal)?));
    if vertical == 0 || horizontal == 0 || numbers.is_none_or(|n| n > file.len()) {
        return Err("the angle grid is empty or larger than the file");
    }
    let v_angles = ascending(&mut text, vertical, "the vertical angles are not ascending")?;
    let h_angles = ascending(&mut text, horizontal, "the horizontal angles are not ascending")?;
    let candela: Vec<f32> = (0..vertical * horizontal)
        .map(|_| text.float() * candela_multiplier)
        .collect();
    text.skip_space();
    if !text.done() {
        if text.next(true) == b"END" {
            text.skip_space();
        }
        if !text.done() {
            return Err("there is text after the candela values");
        }
    }
    let max_candela = candela.iter().fold(0.0f32, |most, &c| if most >= c { most } else { c });
    Ok(Photometry {
        v_angles,
        h_angles,
        candela,
        type_a,
        max_candela,
    })
}

/// Steps over the keyword lines to `TILT=NONE`. A file that names another tilt is refused; one with
/// no tilt line at all reaches the lamp count at its end and is refused there.
fn header(text: &mut Text) -> Result<(), &'static str> {
    while !text.done() {
        let line = text.next(false);
        if line == b"TILT=NONE" {
            break;
        }
        if line.starts_with(b"TILT=") {
            return Err("only a file with TILT=NONE is read");
        }
    }
    Ok(())
}

/// `count` numbers, none below the one before.
fn ascending(text: &mut Text, count: usize, why: &'static str) -> Result<Vec<f32>, &'static str> {
    let mut least = f32::MIN;
    (0..count)
        .map(|_| {
            let value = text.float();
            if value < least {
                return Err(why);
            }
            least = value;
            Ok(value)
        })
        .collect()
}
