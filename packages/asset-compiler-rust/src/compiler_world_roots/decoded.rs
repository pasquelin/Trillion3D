//! The tests' reading of the records the cook wrote (`records.rs`, `dag_records.rs`): the table
//! and the DAG decoded back from their bytes, as a reader views them, into one document whose keys
//! name each field, so a test reads what a load reads. Every record's stride is named here once.
use super::records::{DAG_MAGIC, TABLE_MAGIC};
use super::*;

/// The table's header, bundle, page and HLOD cell strides (`encode_table`).
const TABLE_STRIDES: [usize; 4] = [64, 56, 24, 64];
/// The DAG's header, cluster, group and culling-node strides (`encode_dag`).
const DAG_STRIDES: [usize; 4] = [24, 184, 64, 120];

/// The byte after `counts` records of `strides` past its header: where the pool begins.
fn pool_at(strides: &[usize], counts: &[usize]) -> usize {
    strides[0]
        + (strides[1..].iter().zip(counts))
            .map(|(s, n)| s * n)
            .sum::<usize>()
}

/// The pool of `pool` words fills `bytes` exactly after its records at `at`.
fn filled(bytes: &[u8], at: usize, pool: usize) {
    assert_eq!(
        bytes.len(),
        at + pool * 4,
        "records, then the pool, fill the file"
    );
}

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
    fn f64(&mut self) -> f64 {
        self.at += 8;
        f64::from_le_bytes(self.bytes[self.at - 8..self.at].try_into().unwrap())
    }
    fn float(&mut self) -> Value {
        let value = self.f64();
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
        crate::hex_of(&self.bytes[self.at - 32..self.at])
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

/// The table's bundles, pages and HLOD cells, as `encode_table` lays them, with its pool's length
/// in words.
pub(crate) fn table(bytes: &[u8]) -> Value {
    assert_eq!(&bytes[..4], TABLE_MAGIC);
    let mut r = Reader {
        bytes,
        at: 4,
        pool: 0,
    };
    let [version, bundles, pages, hlod, pool] = [(); 5].map(|_| r.word() as usize);
    let length = r.word() as u64 | (r.word() as u64) << 32;
    let sha256 = r.digest();
    r.pool = pool_at(&TABLE_STRIDES, &[bundles, pages, hlod]);
    filled(bytes, r.pool, pool);
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
    let hlod: Vec<Value> = (0..hlod)
        .map(|_| {
            let (bundles, parent, word) = (r.pooled(), r.index(), r.word());
            // The level in the low 16 bits, the actor's flags in the high 16 (`encode_table`).
            json!({"bundles":bundles,"parent":parent,"level":word & 0xffff,"actor":word >> 16,
                "bounds":r.floats(6)})
        })
        .collect();
    json!({"version":version,"payload":{"bytes":length,"sha256":sha256},"bundles":bundles,
        "pages":pages,"hlod":hlod,"poolWords":pool})
}

/// The DAG's clusters, groups and culling nodes (each its fifteen `f64`, `CullingNode::flat`), as
/// `encode_dag` lays them, with its pool's length in words.
fn dag(bytes: &[u8]) -> Value {
    assert_eq!(&bytes[..4], DAG_MAGIC);
    let mut r = Reader {
        bytes,
        at: 4,
        pool: 0,
    };
    let [version, clusters, groups, pool, nodes] = [(); 5].map(|_| r.word() as usize);
    assert_eq!(version, WORLD_ROOTS_VERSION as usize);
    r.pool = pool_at(&DAG_STRIDES, &[clusters, groups, nodes]);
    filled(bytes, r.pool, pool);
    let clusters: Vec<Value> = (0..clusters)
        .map(|slot| {
            let mut c = json!({"cluster":slot,"level":r.word(),"triangles":r.word(),
                "material":r.index(),"bundle":r.index(),"offset":r.index(),"hlod":r.word(),
                "pad":[r.word(), r.word()],"lodError":r.float(),"parentError":r.float(),"sphere":r.floats(4),
                "parentSphere":r.floats(4),"min":r.floats(3),"max":r.floats(3)});
            let facts = [(); 5].map(|_| r.word());
            let error = f32::from_le_bytes(r.bytes[r.at..r.at + 4].try_into().expect("an f32"));
            r.at += 4;
            if facts[0] > 0 {
                c["page"] = json!({"pageBytes":facts[0],"vertexCount":facts[1],
                    "indexCount":facts[2],"flags":facts[3],"uncompressedBytes":facts[4],
                    "quantizationError":error});
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
    let culling: Vec<Vec<f64>> = (0..nodes)
        .map(|_| (0..15).map(|_| r.f64()).collect())
        .collect();
    json!({"clusters":clusters,"groups":groups,"culling":culling,"poolWords":pool})
}

/// What a load reads of `cooked`: its table, with the DAG's `clusters`, `groups`, `culling` nodes
/// and `dagPoolWords`.
pub(super) fn decoded(cooked: &Cooked) -> Value {
    let mut out = table(&cooked.table);
    let mut dag = dag(&cooked.dag);
    for key in ["clusters", "groups", "culling"] {
        out[key] = dag[key].take();
    }
    out["dagPoolWords"] = dag["poolWords"].take();
    out
}
