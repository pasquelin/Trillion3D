//! IFC4 STEP: lazy third-party syntax decoder, bounded native surface conversion.
//! IFC-Lite core 20.2.0 is MPL-2.0; no third-party geometry fallback or deduplication.
use super::{mesh_source as source, SceneRequest};
use crate::{
    import::{SceneTables, Vertices},
    Result,
};
use ifc_lite_core::{AttributeValue as Value, DecodedEntity, EntityDecoder, EntityScanner};
use serde_json::json;
use std::collections::{BTreeMap, BTreeSet};
mod extrusion;
mod model;
mod placement;
mod styles;
mod surface;
#[cfg(test)]
mod tests;
pub(super) static IFC: source::FilePlugin = source::FilePlugin {
    name: "ifc",
    version: "ifc4-tessellated-extruded-1-core20.2.0",
    extensions: &["ifc"],
    magic: b"ISO-10303-21;",
    read,
};
struct Entity {
    kind: String,
    data: DecodedEntity,
}
type Entities = BTreeMap<u32, Entity>;
fn invalid(message: impl std::fmt::Display) -> crate::CompilerError {
    source::invalid("ifc", message)
}
fn entity(all: &Entities, id: u32) -> Result<&Entity> {
    all.get(&id)
        .ok_or_else(|| invalid(format!("missing entity #{id}")))
}
fn reference(data: &DecodedEntity, index: usize) -> Result<u32> {
    data.get_ref(index)
        .ok_or_else(|| invalid(format!("#{} missing reference {index}", data.id)))
}
fn list(data: &DecodedEntity, index: usize) -> Result<&[Value]> {
    data.get_list(index)
        .ok_or_else(|| invalid(format!("#{} missing list {index}", data.id)))
}
fn number(value: &Value) -> Result<f64> {
    value
        .as_float()
        .filter(|v| v.is_finite())
        .ok_or_else(|| invalid("expected finite number"))
}
fn tuple<const N: usize>(value: &Value) -> Result<[f64; N]> {
    let list = value
        .as_list()
        .ok_or_else(|| invalid("expected coordinate list"))?;
    if list.len() != N {
        return Err(invalid("coordinate dimension mismatch"));
    }
    let mut out = [0.; N];
    for (o, v) in out.iter_mut().zip(list) {
        *o = number(v)?;
    }
    Ok(out)
}
fn read(bytes: &[u8], request: &SceneRequest<'_>, scene: &mut SceneTables) -> Result<()> {
    source::admit(
        bytes.len().saturating_mul(48),
        request.ram_budget / 2,
        "ifc",
    )?;
    let text = std::str::from_utf8(bytes).map_err(invalid)?;
    if !text.starts_with("ISO-10303-21;")
        || !text.trim_end().ends_with("END-ISO-10303-21;")
        || !text.contains("FILE_SCHEMA(('IFC4")
    {
        return Err(source::unsupported(
            "ifc",
            "expected complete IFC4 STEP document",
        ));
    }
    let mut scanner = EntityScanner::new(bytes);
    let decoder = EntityDecoder::new(bytes);
    let mut all = Entities::new();
    while let Some((id, kind, start, end)) = scanner.next_entity() {
        if super::cancel::stopped(request.cancelled, all.len()) {
            return Err(super::cancel::refusal());
        }
        let data = decoder.decode_at_uncached(start, end).map_err(invalid)?;
        if all
            .insert(
                id,
                Entity {
                    kind: kind.to_ascii_uppercase(),
                    data,
                },
            )
            .is_some()
        {
            return Err(invalid("duplicate STEP entity ID"));
        }
    }
    fn refs(value: &Value, all: &Entities) -> Result<()> {
        match value {
            Value::EntityRef(id) => {
                entity(all, *id)?;
            }
            Value::List(values) => {
                for value in values {
                    refs(value, all)?;
                }
            }
            _ => {}
        }
        Ok(())
    }
    for e in all.values() {
        for value in e.data.attributes.iter() {
            refs(value, &all)?;
        }
    }
    model::read(&all, request, scene)
}
