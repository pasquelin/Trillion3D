use super::*;

pub(super) fn bad(message: impl Into<String>) -> CompilerError {
    CompilerError::new("INVALID_MANIFEST", message)
}

#[derive(Default)]
pub(crate) struct Column {
    pub(crate) bytes: Vec<u8>,
}
impl Column {
    /// Une colonne dont la taille finale est connue n'est jamais réallouée pendant l'écriture.
    pub(crate) fn reserve(&mut self, bytes: usize) {
        self.bytes.reserve(bytes);
    }
    pub(crate) fn f64(&mut self, value: f64) {
        self.bytes.extend_from_slice(&value.to_le_bytes());
    }
    pub(super) fn i32(&mut self, value: i32) {
        self.bytes.extend_from_slice(&value.to_le_bytes());
    }
    pub(super) fn u32(&mut self, value: u32) {
        self.bytes.extend_from_slice(&value.to_le_bytes());
    }
    /// A digest is stored as its 64 ASCII hexadecimal characters: one decode for the whole column,
    /// then one slice per entry, costs the reader far less than re-encoding 32 raw bytes each time.
    pub(super) fn sha(&mut self, value: &str) -> Result<()> {
        if value.len() != 64
            || !value
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        {
            return Err(bad(format!(
                "Object digest is not 64 lowercase hexadecimal characters: {value}"
            )));
        }
        self.bytes.extend_from_slice(value.as_bytes());
        Ok(())
    }
    pub(super) fn zeros(&mut self, count: usize) {
        self.bytes.resize(self.bytes.len() + count, 0);
    }
}

pub(super) fn object<'a>(value: &'a Value, what: &str) -> Result<&'a Map<String, Value>> {
    value
        .as_object()
        .ok_or_else(|| bad(format!("{what} is not an object")))
}
pub(super) fn array<'a>(value: &'a Value, what: &str) -> Result<&'a Vec<Value>> {
    value
        .as_array()
        .ok_or_else(|| bad(format!("{what} is not an array")))
}
pub(super) fn number(value: Option<&Value>, what: &str) -> Result<f64> {
    value
        .and_then(Value::as_f64)
        .ok_or_else(|| bad(format!("{what} is not a number")))
}
pub(super) fn integer(value: Option<&Value>, what: &str) -> Result<i64> {
    value
        .and_then(Value::as_i64)
        .ok_or_else(|| bad(format!("{what} is not an integer")))
}
pub(super) fn text<'a>(value: Option<&'a Value>, what: &str) -> Result<&'a str> {
    value
        .and_then(Value::as_str)
        .ok_or_else(|| bad(format!("{what} is not a string")))
}
/// Les `length` nombres d'un tableau, écrits droit dans la colonne : pas de `Vec` intermédiaire
/// par sphère ni par paire de bornes, et les mêmes octets qu'une écriture valeur par valeur.
pub(crate) fn vector_into(
    value: Option<&Value>,
    length: usize,
    what: &str,
    column: &mut Column,
) -> Result<()> {
    let items = array(value.ok_or_else(|| bad(format!("{what} is absent")))?, what)?;
    if items.len() != length {
        return Err(bad(format!(
            "{what} has {} numbers, expected {length}",
            items.len()
        )));
    }
    for (i, item) in items.iter().enumerate() {
        // Le nom de l'entrée fautive n'est construit que lorsqu'il y en a une : l'ancien chemin
        // formatait une chaîne par nombre valide, sphère après sphère, page après page.
        let Some(value) = item.as_f64() else {
            return Err(bad(format!("{what}[{i}] is not a number")));
        };
        column.f64(value);
    }
    Ok(())
}
pub(super) fn templated(template: &str, url: &str, sha: &str) -> Result<()> {
    if template.replace("{sha}", sha) != url {
        return Err(bad(format!(
            "Object url {url} does not follow the template {template}"
        )));
    }
    Ok(())
}
pub(super) fn as_i32(value: i64, what: &str) -> Result<i32> {
    i32::try_from(value).map_err(|_| bad(format!("{what} does not fit a 32-bit integer: {value}")))
}
pub(super) fn as_u32(value: i64, what: &str) -> Result<u32> {
    u32::try_from(value).map_err(|_| {
        bad(format!(
            "{what} does not fit an unsigned 32-bit integer: {value}"
        ))
    })
}
