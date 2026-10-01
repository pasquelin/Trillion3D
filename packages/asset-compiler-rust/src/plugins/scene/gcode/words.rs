use super::*;

/// Compact words and bracket/semicolon comments; unknown syntax never becomes motion.
pub(super) fn parse(line: &str) -> Result<Vec<(char, f64)>> {
    let mut clean = String::new();
    let mut comment = false;
    for character in line.chars() {
        match character {
            '(' if !comment => comment = true,
            ')' if comment => comment = false,
            ';' if !comment => break,
            '(' | ')' => return Err(source::invalid("gcode", "malformed comment")),
            _ if !comment => clean.push(character),
            _ => {}
        }
    }
    if comment {
        return Err(source::invalid("gcode", "unterminated comment"));
    }
    let bytes = clean.as_bytes();
    let mut cursor = 0;
    let mut out = Vec::new();
    while cursor < bytes.len() {
        if bytes[cursor].is_ascii_whitespace() {
            cursor += 1;
            continue;
        }
        let key = bytes[cursor].to_ascii_uppercase();
        cursor += 1;
        if !key.is_ascii_alphabetic() {
            return Err(source::invalid("gcode", "expected a word"));
        }
        while cursor < bytes.len() && bytes[cursor].is_ascii_whitespace() {
            cursor += 1;
        }
        let start = cursor;
        while cursor < bytes.len()
            && (bytes[cursor].is_ascii_digit() || b"+-.".contains(&bytes[cursor]))
        {
            cursor += 1;
        }
        let value = clean[start..cursor]
            .parse::<f64>()
            .ok()
            .filter(|v| v.is_finite())
            .ok_or_else(|| source::invalid("gcode", "invalid numeric word"))?;
        if out.iter().any(|(previous, _)| *previous == key as char) {
            return Err(source::unsupported("gcode", "duplicate word in one block"));
        }
        out.push((key as char, value));
    }
    Ok(out)
}

/// Parameters have command-specific meanings: a temperature block must never move XYZ.
pub(super) fn validate(words: &[(char, f64)]) -> Result<()> {
    let m = words
        .iter()
        .find(|(key, _)| *key == 'M')
        .map(|(_, value)| *value);
    let process =
        m.is_some_and(|value| matches!(value, 104.0 | 109.0 | 140.0 | 190.0 | 106.0 | 107.0));
    if m.is_some() && words.iter().any(|(key, _)| !matches!(key, 'M' | 'N' | 'S')) {
        return Err(source::unsupported(
            "gcode",
            "mixed motion/parameter word in M block",
        ));
    }
    for &(key, value) in words {
        if (key == 'S' && (!process || value < 0.0)) || (key == 'F' && value <= 0.0) {
            return Err(source::invalid("gcode", "invalid process/feed parameter"));
        }
        if key == 'N' && (value < 0.0 || value.fract() != 0.0) {
            return Err(source::invalid(
                "gcode",
                "line number must be a nonnegative integer",
            ));
        }
    }
    Ok(())
}
