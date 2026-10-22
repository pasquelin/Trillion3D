use crate::*;

mod options;
pub(crate) use options::validate_compile_options;

pub(crate) fn invalid(message: impl Into<String>) -> CompilerError {
    GLTF.bad(message)
}
/// The typed readers of a JSON document — the one family, whatever the document —, each refusal
/// named under the document's error code.
pub(crate) struct Fields(pub(crate) &'static str);
/// The readers of the source glTF.
pub(crate) const GLTF: Fields = Fields("INVALID_GLTF");
/// The readers of a job's options.
pub(crate) const OPTIONS: Fields = Fields("INVALID_OPTIONS");
impl Fields {
    pub(crate) fn bad(&self, message: impl Into<String>) -> CompilerError {
        CompilerError::new(self.0, message)
    }
    pub(crate) fn object<'a>(
        &self,
        value: &'a Value,
        what: &str,
    ) -> Result<&'a serde_json::Map<String, Value>> {
        value
            .as_object()
            .ok_or_else(|| self.bad(format!("{what} is not an object")))
    }
    pub(crate) fn array<'a>(&self, value: &'a Value, what: &str) -> Result<&'a Vec<Value>> {
        value
            .as_array()
            .ok_or_else(|| self.bad(format!("{what} is not an array")))
    }
    pub(crate) fn number(&self, value: Option<&Value>, what: &str) -> Result<f64> {
        finite(value).ok_or_else(|| self.bad(format!("{what} is not a finite number")))
    }
    /// `value` as a finite number from `low` to `high`, `takes` saying so in the refusal.
    pub(crate) fn bounded(
        &self,
        value: &Value,
        what: &str,
        (low, high): (f64, f64),
        takes: &str,
    ) -> Result<f64> {
        (value.as_f64())
            .filter(|&n| n.is_finite() && (low..=high).contains(&n))
            .ok_or_else(|| self.bad(format!("{what} must be {takes}, got {value}")))
    }
    /// `value` as a whole number from `low` to `high`, `takes` saying so in the refusal.
    pub(crate) fn whole(
        &self,
        value: &Value,
        what: &str,
        (low, high): (i64, i64),
        takes: &str,
    ) -> Result<i64> {
        (value.as_i64())
            .filter(|n| (low..=high).contains(n))
            .ok_or_else(|| self.bad(format!("{what} must be {takes}, got {value}")))
    }
    /// `N` finite numbers, exactly.
    pub(crate) fn numbers<const N: usize>(
        &self,
        value: Option<&Value>,
        what: &str,
    ) -> Result<[f64; N]> {
        let refused = || self.bad(format!("{what} is not {N} finite numbers"));
        let items = value
            .and_then(Value::as_array)
            .filter(|items| items.len() == N);
        let items = items.ok_or_else(refused)?;
        let mut numbers = [0.0; N];
        for (number, item) in numbers.iter_mut().zip(items) {
            *number = finite(Some(item)).ok_or_else(refused)?;
        }
        Ok(numbers)
    }
    pub(crate) fn integer(&self, value: Option<&Value>, what: &str) -> Result<i64> {
        value
            .and_then(Value::as_i64)
            .ok_or_else(|| self.bad(format!("{what} is not an integer")))
    }
    pub(crate) fn index(&self, value: Option<&Value>, what: &str) -> Result<usize> {
        let raw = value
            .and_then(Value::as_u64)
            .ok_or_else(|| self.bad(format!("{what} must be an unsigned integer")))?;
        usize::try_from(raw).map_err(|_| self.bad(format!("{what} is too large")))
    }
    pub(crate) fn text<'a>(&self, value: Option<&'a Value>, what: &str) -> Result<&'a str> {
        value
            .and_then(Value::as_str)
            .ok_or_else(|| self.bad(format!("{what} is not a string")))
    }
    pub(crate) fn boolean(&self, value: Option<&Value>, what: &str) -> Result<bool> {
        value
            .and_then(Value::as_bool)
            .ok_or_else(|| self.bad(format!("{what} is not a boolean")))
    }
    /// `value` as an object holding only `fields`: one it does not know is refused by name.
    pub(crate) fn known<'a>(
        &self,
        value: &'a Value,
        fields: &[&str],
        what: &str,
    ) -> Result<&'a serde_json::Map<String, Value>> {
        let map = self.object(value, what)?;
        match map.keys().find(|key| !fields.contains(&key.as_str())) {
            Some(key) => Err(self.bad(format!("{what} has no field {key}: {}", fields.join(", ")))),
            None => Ok(map),
        }
    }
    /// What `read` reads of `value`, `None` when it is absent or null.
    pub(crate) fn optional<'a, T>(
        &self,
        value: Option<&'a Value>,
        what: &str,
        read: impl FnOnce(&Self, Option<&'a Value>, &str) -> Result<T>,
    ) -> Result<Option<T>> {
        match value {
            None | Some(Value::Null) => Ok(None),
            present => read(self, present, what).map(Some),
        }
    }
}
impl CompilerError {
    /// The same refusal, naming the source glTF mesh and primitive it was raised in: page ids
    /// restart at 0 in every primitive, so a page named alone is ambiguous in a cook of several.
    /// A cancellation is no refusal of that primitive and keeps its message.
    pub(crate) fn within(mut self, mesh: usize, primitive: usize) -> Self {
        if self.code != crate::CANCELLED {
            self.message = format!("Mesh {mesh} primitive {primitive}: {}", self.message);
        }
        self
    }
}
pub(crate) fn required_index(v: Option<&Value>, field: &str) -> Result<usize> {
    GLTF.index(v, field)
}
/// `required_index`, refused unless below `len`: "`field` index is out of bounds".
pub(crate) fn bounded(v: &Value, field: &str, len: usize) -> Result<usize> {
    let index = required_index(Some(v), field)?;
    if index < len {
        Ok(index)
    } else {
        Err(invalid(format!("{field} index is out of bounds")))
    }
}
pub(crate) fn optional_index(v: Option<&Value>, field: &str, default: usize) -> Result<usize> {
    v.map_or(Ok(default), |value| GLTF.index(Some(value), field))
}
/// The attributes of the glTF primitive `p`: refused without them, or without `POSITION`.
pub(crate) fn attributes(p: &Value) -> Result<&serde_json::Map<String, Value>> {
    let attributes = p.get("attributes").and_then(Value::as_object);
    let attributes = attributes.ok_or_else(|| invalid("primitive.attributes is required"))?;
    if !attributes.contains_key("POSITION") {
        return Err(invalid("primitive.attributes.POSITION is required"));
    }
    Ok(attributes)
}
/// The accessor of the glTF primitive `p`'s `POSITION` among `g`'s.
pub(crate) fn position_accessor<'a>(g: &'a Value, p: &Value) -> Result<&'a Value> {
    let position = attributes(p)?.get("POSITION");
    let id = required_index(position, "primitive.attributes.POSITION")?;
    item(values(g, "accessors")?, id, "accessor")
}
/// A JSON number as the compiler reads one: finite, `None` when absent, not a number or not finite.
pub(crate) fn finite(value: Option<&Value>) -> Option<f64> {
    value.and_then(Value::as_f64).filter(|v| v.is_finite())
}
/// `finite`, `default` when absent, not a number or not finite.
pub(crate) fn number_or(value: Option<&Value>, default: f64) -> f64 {
    finite(value).unwrap_or(default)
}
pub(crate) fn values<'a>(g: &'a Value, field: &str) -> Result<&'a Vec<Value>> {
    g.get(field)
        .and_then(Value::as_array)
        .ok_or_else(|| invalid(format!("{field} array is required")))
}
pub(crate) fn item<'a>(items: &'a [Value], id: usize, field: &str) -> Result<&'a Value> {
    items
        .get(id)
        .ok_or_else(|| invalid(format!("{field} index {id} is out of bounds")))
}
/// The promise a cache makes its reader (`primitiveUsesClusterErrors`, sdk-core): every primitive
/// is drawn from pages, and each page carries its own screen-error band — a finite error of at least
/// zero, measured through a sphere of four finite numbers whose radius is at least zero. A primitive
/// that breaks it is refused here, before a file is written: the compiler fails, it never
/// publishes a cache the runtime would refuse.
pub(crate) fn validate_cluster_errors(primitives: &[Value]) -> Result<()> {
    let band = |page: &Value| {
        let error = finite(page.get("lodError")).is_some_and(|e| e >= 0.0);
        let sphere = page.get("sphere").and_then(Value::as_array);
        error
            && sphere.is_some_and(|s| {
                s.len() == 4
                    && s.iter().all(|v| finite(Some(v)).is_some())
                    && finite(s.get(3)).is_some_and(|r| r >= 0.0)
            })
    };
    for primitive in primitives {
        let pages = primitive.get("pages").and_then(Value::as_array);
        if pages.is_some_and(|pages| !pages.is_empty() && pages.iter().all(band)) {
            continue;
        }
        let (mesh, index) = (&primitive["mesh"], &primitive["primitive"]);
        return Err(CompilerError::new(
            "INCOMPLETE_CLUSTER_DAG",
            format!("Mesh {mesh} primitive {index}: a page carries no cluster error band; the runtime draws none"),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A primitive of `pages`, each `lodError` and `sphere` as given.
    fn primitive(pages: Value) -> Value {
        json!({"mesh": 1, "primitive": 2, "pages": pages})
    }

    // Behaviour: a primitive with no page, or a page without a sound error band, fails the compile
    // by name; one whose every page carries its band passes.
    #[test]
    fn a_primitive_without_an_error_band_on_every_page_is_refused() {
        let sound = json!({"lodError": 0.0, "sphere": [0.0, 0.0, 0.0, 1.0]});
        assert!(validate_cluster_errors(&[primitive(json!([sound.clone()]))]).is_ok());
        for pages in [
            json!([]),
            Value::Null,
            json!([sound.clone(), {"sphere": [0.0, 0.0, 0.0, 1.0]}]),
            json!([{"lodError": -1.0, "sphere": [0.0, 0.0, 0.0, 1.0]}]),
            json!([{"lodError": 0.5, "sphere": [0.0, 0.0, 0.0]}]),
            json!([{"lodError": 0.5, "sphere": [0.0, 0.0, 0.0, -1.0]}]),
            json!([{"lodError": 0.5, "sphere": [0.0, null, 0.0, 1.0]}]),
        ] {
            let refused =
                validate_cluster_errors(&[primitive(pages.clone())]).expect_err("refused");
            assert_eq!(refused.code, "INCOMPLETE_CLUSTER_DAG", "{pages}");
            assert!(refused.message.contains("Mesh 1 primitive 2"), "{pages}");
        }
    }
}
