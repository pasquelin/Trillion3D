//! Typed views of the codec's versioned native presentation/product namespace.
use super::*;
#[derive(Deserialize)]
pub(super) struct Attributes {
    pub source_uuid: String,
    pub material_index: i32,
    pub layer_index: i32,
    pub material_source: u8,
}
#[derive(Deserialize)]
struct Object {
    #[serde(flatten)]
    attributes: Attributes,
}
#[derive(Deserialize)]
pub(super) struct Layer {
    pub archive_index: i32,
    pub material_index: i32,
}
#[derive(Deserialize)]
pub(super) struct Occurrence {
    pub source_uuid: String,
    pub transform: Transform,
    pub transform_units: String,
}
pub(super) struct Metadata {
    pub objects: BTreeMap<String, Attributes>,
    pub layers: BTreeMap<i32, Layer>,
    pub occurrences: BTreeMap<String, Occurrence>,
    pub materials: BTreeMap<i32, materials::Material>,
}
impl Metadata {
    pub(super) fn read(ir: &CadIr, request: &SceneRequest<'_>) -> Result<Self> {
        let namespace = ir
            .native
            .namespace("rhino")
            .ok_or_else(|| source::invalid("3dm", "missing decoded namespace"))?;
        if namespace.version != 2 {
            return Err(source::unsupported(
                "3dm",
                format!("native presentation version {}", namespace.version),
            ));
        }
        for name in ["lights", "external_references"] {
            if namespace
                .arenas
                .get(name)
                .is_some_and(|values| !values.is_empty())
            {
                return Err(source::unsupported("3dm", name));
            }
        }
        let count: usize = [
            "materials",
            "layers",
            "object_presentation",
            "product_occurrences",
        ]
        .iter()
        .map(|name| namespace.arenas.get(*name).map_or(0, Vec::len))
        .sum();
        source::admit(count.saturating_mul(2048), request.ram_budget / 8, "3dm")?;
        let err = |e| source::invalid("3dm", e);
        let mut objects = BTreeMap::new();
        for (index, object) in namespace
            .arena_iter_as::<Object>("object_presentation")
            .enumerate()
        {
            decode::check(request, index)?;
            let attributes = object.map_err(err)?.attributes;
            if objects
                .insert(attributes.source_uuid.clone(), attributes)
                .is_some()
            {
                return Err(source::invalid("3dm", "duplicate object identity"));
            }
        }
        let mut materials = BTreeMap::new();
        for material in namespace.arena_iter_as::<materials::Material>("materials") {
            let material = material.map_err(err)?;
            let index = material
                .archive_index
                .ok_or_else(|| source::unsupported("3dm", "material without archive index"))?;
            if materials.insert(index, material).is_some() {
                return Err(source::invalid("3dm", "duplicate material index"));
            }
        }
        let mut layers = BTreeMap::new();
        for layer in namespace.arena_iter_as::<Layer>("layers") {
            let layer = layer.map_err(err)?;
            if layers.insert(layer.archive_index, layer).is_some() {
                return Err(source::invalid("3dm", "duplicate layer index"));
            }
        }
        let mut occurrences = BTreeMap::new();
        for occurrence in namespace.arena_iter_as::<Occurrence>("product_occurrences") {
            let occurrence = occurrence.map_err(err)?;
            if occurrence.transform_units != "millimeter" {
                return Err(source::unsupported("3dm", "instance units"));
            }
            if occurrences
                .insert(occurrence.source_uuid.clone(), occurrence)
                .is_some()
            {
                return Err(source::invalid("3dm", "duplicate instance identity"));
            }
        }
        Ok(Self {
            objects,
            layers,
            occurrences,
            materials,
        })
    }
    pub(super) fn placement(&self, association: &SourceObjectAssociation) -> Result<Transform> {
        let mut transform = Transform::identity();
        for id in &association.instance_path {
            let occurrence = self.occurrences.get(id).ok_or_else(|| {
                source::invalid("3dm", "instance identity absent from product table")
            })?;
            transform = transform.compose(occurrence.transform);
        }
        Ok(transform)
    }
    pub(super) fn material_index(&self, association: &SourceObjectAssociation) -> Result<i32> {
        let mut ids =
            std::iter::once(&association.object_id).chain(association.instance_path.iter().rev());
        for id in &mut ids {
            let attrs = self
                .objects
                .get(id)
                .ok_or_else(|| source::invalid("3dm", "missing object presentation"))?;
            match attrs.material_source {
                0 => {
                    return Ok(self
                        .layers
                        .get(&attrs.layer_index)
                        .map_or(-1, |l| l.material_index))
                }
                1 => return Ok(attrs.material_index),
                3 => continue,
                _ => return Err(source::unsupported("3dm", "material source")),
            }
        }
        Ok(-1)
    }
}
