//! Typed field access shared by the VRML geometry and scene readers.
use super::{
    document::{Node, Value},
    *,
};
impl Node {
    pub fn numbers(&self, name: &str) -> Result<Vec<f64>> {
        fn append(value: &Value, out: &mut Vec<f64>) -> Result<()> {
            match value {
                Value::Numbers(n) => out.extend(n),
                Value::List(values) => {
                    for v in values {
                        append(v, out)?;
                    }
                }
                _ => return Err(source::invalid("vrml", "expected numeric field")),
            }
            Ok(())
        }
        let mut out = Vec::new();
        if let Some(value) = self.fields.get(name) {
            append(value, &mut out)?;
        }
        Ok(out)
    }
    pub fn number_array<const N: usize>(&self, name: &str, default: [f64; N]) -> Result<[f64; N]> {
        if !self.fields.contains_key(name) {
            return Ok(default);
        }
        self.numbers(name)?
            .try_into()
            .map_err(|_| source::invalid("vrml", format!("wrong {name} component count")))
    }
    pub fn boolean(&self, name: &str, default: bool) -> Result<bool> {
        match self.fields.get(name) {
            None => Ok(default),
            Some(Value::Bool(v)) => Ok(*v),
            _ => Err(source::invalid("vrml", "expected boolean")),
        }
    }
    pub fn child(&self, name: &str) -> Result<Option<usize>> {
        match self.fields.get(name) {
            None | Some(Value::Null) => Ok(None),
            Some(Value::Node(n)) => Ok(Some(*n)),
            _ => Err(source::invalid("vrml", "expected node field")),
        }
    }
    pub fn fields(&self, allowed: &[&str]) -> Result<()> {
        for field in self.fields.keys() {
            if !allowed.contains(&field.as_str()) {
                return Err(source::unsupported(
                    "vrml",
                    format!("{}.{}", self.kind, field),
                ));
            }
        }
        Ok(())
    }
}
