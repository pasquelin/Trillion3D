//! The tests' reading of the records the cook wrote (`records.rs`, `dag_records.rs`): the table
//! and the DAG decoded back from their bytes, as a reader views them, into one document whose keys
//! name each field, so a test reads what a load reads.
use super::records::{DAG_MAGIC, TABLE_MAGIC};
use super::*;

/// A cursor over little-endian records and the pool after them.
struct Reader<'a> {
    bytes: &'a [u8],
    at: usize,
    pool: usize,
}
impl Reader<'_> {
    fn word(&mut self) -> u32 {
        self.at += 4;
        u32::from_le_bytes(self.bytes[self.at - 4..self.at].try_into().unwrap())
    }
    fn index(&mut self) -> Value {
        match self.word() {
            u32::MAX => Value::Null,
            n => json!(n),
        }
    }
    fn float(&mut self) -> Value {
        self.at += 8;
        let value = f64::from_le_bytes(self.bytes[self.at - 8..self.at].try_into().unwrap());
        if value.is_nan() {
            Value::Null
        } else {
            json!(value)
        }
    }
    fn floats(&mut self, count: usize) -> Value {
        let values: Vec<Value> = (0..count).map(|_| self.float()).collect();
        if values.iter().all(Value::is_null) {
            Value::Null
        } else {
            json!(values)
        }
    }
    fn digest(&mut self) -> String {
        self.at += 32;
        self.bytes[self.at - 32..self.at]
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect()
    }
    /// A pooled list: its first word and length, read in the pool.
    fn pooled(&mut self) -> Value {
        let (first, count) = (self.word() as usize, self.word() as usize);
        let at = self.pool + first * 4;
        let mut list = Reader {
            bytes: self.bytes,
            at,
            pool: 0,
        };
        json!((0..count).map(|_| list.index()).collect::<Vec<_>>())
    }
}

/// The table's bundles, pages, cells and objects, as `encode_table` lays them.
fn table(bytes: &[u8]) -> Value {
    assert_eq!(&bytes[..4], TABLE_MAGIC);
    let mut r = Reader {
        bytes,
        at: 4,
        pool: 0,
    };
    let [version, budget, pinned, pinned_bytes, bundles, pages, cells, objects, _pool] =
        [(); 9].map(|_| r.word() as usize);
    let length = r.word() as u64 | (r.word() as u64) << 32;
    let sha256 = r.digest();
    r.pool = 80 + bundles * 56 + pages * 24 + cells * 16 + objects * 24;
    let bundles: Vec<Value> = (0..bundles)
        .map(|_| {
            let offset = r.word() as u64 | (r.word() as u64) << 32;
            json!({"offset":offset,"bytes":r.word(),"count":r.word(),"dependencies":r.pooled(),
                "sha256":r.digest()})
        })
        .collect();
    let pages: Vec<Value> = (0..pages)
        .map(|_| {
            json!({"bundle":r.word(),"offset":r.word(),"level":r.word(),"bytes":r.word(),
                "lodError":r.float()})
        })
        .collect();
    let cells: Vec<(usize, usize, Value)> = (0..cells)
        .map(|_| (r.word() as usize, r.word() as usize, r.pooled()))
        .collect();
    let objects: Vec<Value> = (0..objects)
        .map(|_| {
            json!({"node":r.word(),"primitive":r.word(),"roots":r.pooled(),
                "dependencies":r.pooled()})
        })
        .collect();
    let cells: Vec<Value> = (cells.into_iter())
        .map(|(first, count, nodes)| json!({"objects":objects[first..first + count],"nodes":nodes}))
        .collect();
    json!({"version":version,"budgetBytes":budget,"pinned":pinned,"pinnedTopBytes":pinned_bytes,
        "payload":{"bytes":length,"sha256":sha256},"bundles":bundles,"pages":pages,"cells":cells})
}

/// The DAG's clusters and groups, as `encode_dag` lays them.
fn dag(bytes: &[u8]) -> (Value, Value) {
    assert_eq!(&bytes[..4], DAG_MAGIC);
    let mut r = Reader {
        bytes,
        at: 4,
        pool: 0,
    };
    let [version, clusters, groups, _pool, _zero] = [(); 5].map(|_| r.word() as usize);
    assert_eq!(version, WORLD_ROOTS_VERSION as usize);
    r.pool = 24 + clusters * 176 + groups * 64;
    let clusters: Vec<Value> = (0..clusters)
        .map(|slot| {
            let mut c = json!({"cluster":slot,"level":r.word(),"triangles":r.word(),
                "primitive":r.index(),"bundle":r.index(),"offset":r.index(),"origin":r.index(),
                "lodError":r.float(),"parentError":r.float(),"sphere":r.floats(4),
                "parentSphere":r.floats(4),"min":r.floats(3),"max":r.floats(3)});
            let facts = [(); 5].map(|_| r.word());
            r.at += 4;
            if facts[0] > 0 {
                c["page"] = json!({"pageBytes":facts[0],"vertexCount":facts[1],
                    "indexCount":facts[2],"flags":facts[3],"uncompressedBytes":facts[4]});
            }
            c
        })
        .collect();
    let groups: Vec<Value> = (0..groups)
        .map(|_| {
            let group = json!({"level":r.word(),"children":r.pooled(),"outputs":r.pooled()});
            r.word();
            let mut group = group;
            group["error"] = r.float();
            group["sphere"] = r.floats(4);
            group
        })
        .collect();
    (json!(clusters), json!(groups))
}

/// What a load reads of `cooked`: its table, with the DAG's `clusters` and `groups`.
pub(super) fn decoded(cooked: &Cooked) -> Value {
    let mut out = table(&cooked.table);
    let (clusters, groups) = dag(&cooked.dag);
    out["clusters"] = clusters;
    out["groups"] = groups;
    out
}
