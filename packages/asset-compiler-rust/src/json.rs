//! Format-free JSON helpers shared by the compiler's reports and its binary.
use serde_json::Value;

/// Copies every field of `fields`, an object, into `target`, an object.
pub fn merge(target: &mut Value, fields: Value) {
    if let (Some(target), Value::Object(fields)) = (target.as_object_mut(), fields) {
        target.extend(fields);
    }
}
