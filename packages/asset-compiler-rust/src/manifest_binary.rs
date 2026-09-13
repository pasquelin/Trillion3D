//! Binary sidecar of the cluster manifest.
//!
//! A cache describes tens of thousands of clusters with a dozen numbers each. Written as JSON the
//! browser has to tokenize tens of megabytes before the first frame; written as typed-array columns
//! it is a single `fetch` and a handful of views. `split` cuts a finished manifest in two: the
//! small JSON a reader parses, and the columns it maps.
//!
//! Layout, little-endian, mirrored byte for byte by `packages/sdk-core/manifestBinary.ts`:
//!
//!   u32 magic 'WGMB' · u32 version · u32 columnCount · u32 reserved
//!   columnCount × (u32 byteOffset, u32 byteLength)
//!   column payloads, each starting on an 8-byte boundary
use serde_json::{Map,Value,json};
use crate::{CompilerError,Result};

pub const MANIFEST_BINARY_VERSION:u32=1;
/// 'W','G','M','B' read as a little-endian u32.
pub const MANIFEST_BINARY_MAGIC:u32=0x424d_4757;
const HEADER_WORDS:usize=4;

const PAGE_BOUNDS:usize=0;const PAGE_SPHERE:usize=1;const PAGE_PARENT_SPHERE:usize=2;const PAGE_ERROR:usize=3;
const PAGE_INT:usize=4;const PAGE_U32:usize=5;const PAGE_SHA:usize=6;
const GEOMETRY_SHA:usize=7;const GEOMETRY_U32:usize=8;const CULLING_NODES:usize=9;
const GROUP_LEVEL:usize=10;const GROUP_ERROR:usize=11;const GROUP_SPHERE:usize=12;
const GROUP_CHILD_COUNT:usize=13;const GROUP_CHILD:usize=14;const GROUP_OUTPUT_COUNT:usize=15;
const GROUP_OUTPUT:usize=16;const STRUCTURE_ROOT:usize=17;const BUNDLE_U32:usize=18;const BUNDLE_SHA:usize=19;
const COLUMNS:usize=20;

const FLAG_ROLE:u32=1;const FLAG_COARSE:u32=2;const FLAG_GEOMETRY:u32=4;const FLAG_CLUSTER_ERROR:u32=8;
const FLAG_PARENT_ERROR:u32=16;const FLAG_PARENT_ERROR_FINITE:u32=32;const FLAG_PARENT_SPHERE:u32=64;
const FLAG_PARENT_SPHERE_SET:u32=128;const FLAG_GROUP:u32=256;const FLAG_SOURCE:u32=512;

fn bad(message:impl Into<String>)->CompilerError{CompilerError::new("INVALID_MANIFEST",message)}

#[derive(Default)]
struct Column {bytes:Vec<u8>}
impl Column {
 fn f64(&mut self,value:f64){self.bytes.extend_from_slice(&value.to_le_bytes());}
 fn i32(&mut self,value:i32){self.bytes.extend_from_slice(&value.to_le_bytes());}
 fn u32(&mut self,value:u32){self.bytes.extend_from_slice(&value.to_le_bytes());}
 /// A digest is stored as its 64 ASCII hexadecimal characters: one decode for the whole column,
 /// then one slice per entry, costs the reader far less than re-encoding 32 raw bytes each time.
 fn sha(&mut self,value:&str)->Result<()>{
  if value.len()!=64||!value.bytes().all(|b|b.is_ascii_digit()||(b'a'..=b'f').contains(&b)){return Err(bad(format!("Object digest is not 64 lowercase hexadecimal characters: {value}")))}
  self.bytes.extend_from_slice(value.as_bytes());Ok(())
 }
 fn zeros(&mut self,count:usize){self.bytes.resize(self.bytes.len()+count,0);}
}

fn object<'a>(value:&'a Value,what:&str)->Result<&'a Map<String,Value>>{value.as_object().ok_or_else(||bad(format!("{what} is not an object")))}
fn array<'a>(value:&'a Value,what:&str)->Result<&'a Vec<Value>>{value.as_array().ok_or_else(||bad(format!("{what} is not an array")))}
fn number(value:Option<&Value>,what:&str)->Result<f64>{value.and_then(Value::as_f64).ok_or_else(||bad(format!("{what} is not a number")))}
fn integer(value:Option<&Value>,what:&str)->Result<i64>{value.and_then(Value::as_i64).ok_or_else(||bad(format!("{what} is not an integer")))}
fn text<'a>(value:Option<&'a Value>,what:&str)->Result<&'a str>{value.and_then(Value::as_str).ok_or_else(||bad(format!("{what} is not a string")))}
fn vector(value:Option<&Value>,length:usize,what:&str)->Result<Vec<f64>>{
 let items=array(value.ok_or_else(||bad(format!("{what} is absent")))?,what)?;
 if items.len()!=length{return Err(bad(format!("{what} has {} numbers, expected {length}",items.len())))}
 items.iter().enumerate().map(|(i,item)|number(Some(item),&format!("{what}[{i}]"))).collect()
}
fn templated(template:&str,url:&str,sha:&str)->Result<()>{
 if template.replace("{sha}",sha)!=url{return Err(bad(format!("Object url {url} does not follow the template {template}")))}
 Ok(())
}
fn as_i32(value:i64,what:&str)->Result<i32>{i32::try_from(value).map_err(|_|bad(format!("{what} does not fit a 32-bit integer: {value}")))}
fn as_u32(value:i64,what:&str)->Result<u32>{u32::try_from(value).map_err(|_|bad(format!("{what} does not fit an unsigned 32-bit integer: {value}")))}

/// Object naming templates of a cache. `{sha}` stands for the 64 hexadecimal digest characters.
pub struct Templates<'a>{pub binary:&'a str,pub page:&'a str,pub geometry:&'a str,pub bundle:&'a str}

/// Splits a finished manifest into the small JSON and the columns. The returned descriptor carries
/// an empty `sha256`: only the caller, holding the finished bytes, can hash them.
pub fn split(manifest:&Value,templates:&Templates)->Result<(Value,Vec<u8>)>{
 let root=object(manifest,"manifest")?;
 let primitives=array(root.get("primitives").ok_or_else(||bad("manifest.primitives is absent"))?,"manifest.primitives")?;
 let mut columns:Vec<Column>=(0..COLUMNS).map(|_|Column::default()).collect();
 let mut slim_primitives=Vec::with_capacity(primitives.len());
 for primitive in primitives{
  let entry=object(primitive,"primitive")?;
  let pages=array(entry.get("pages").ok_or_else(||bad("primitive.pages is absent"))?,"primitive.pages")?;
  for page in pages{
   let item=object(page,"page")?;
   let min=vector(item.get("min"),3,"page.min")?;let max=vector(item.get("max"),3,"page.max")?;
   for value in min.iter().chain(max.iter()){columns[PAGE_BOUNDS].f64(*value);}
   let mut flags=0u32;
   match item.get("role"){
    None=>{},
    Some(Value::String(role))=>{flags|=FLAG_ROLE;if role=="coarse"{flags|=FLAG_COARSE;}},
    Some(other)=>return Err(bad(format!("page.role is not a string: {other}"))),
   }
   let cluster_error=matches!(item.get("lodError"),Some(value) if value.is_number())&&item.get("sphere").is_some();
   if cluster_error{
    flags|=FLAG_CLUSTER_ERROR;
    columns[PAGE_ERROR].f64(number(item.get("lodError"),"page.lodError")?);
    for value in vector(item.get("sphere"),4,"page.sphere")?{columns[PAGE_SPHERE].f64(value);}
   }else{columns[PAGE_ERROR].f64(0.);columns[PAGE_SPHERE].zeros(32);}
   match item.get("parentError"){
    None=>{columns[PAGE_ERROR].f64(0.);},
    Some(Value::Null)=>{flags|=FLAG_PARENT_ERROR;columns[PAGE_ERROR].f64(0.);},
    Some(value)=>{flags|=FLAG_PARENT_ERROR|FLAG_PARENT_ERROR_FINITE;columns[PAGE_ERROR].f64(number(Some(value),"page.parentError")?);},
   }
   match item.get("parentSphere"){
    None=>{columns[PAGE_PARENT_SPHERE].zeros(32);},
    Some(Value::Null)=>{flags|=FLAG_PARENT_SPHERE;columns[PAGE_PARENT_SPHERE].zeros(32);},
    Some(_)=>{flags|=FLAG_PARENT_SPHERE|FLAG_PARENT_SPHERE_SET;for value in vector(item.get("parentSphere"),4,"page.parentSphere")?{columns[PAGE_PARENT_SPHERE].f64(value);}},
   }
   columns[PAGE_INT].i32(as_i32(integer(item.get("id"),"page.id")?,"page.id")?);
   columns[PAGE_INT].i32(match item.get("level"){None=>-1,Some(value)=>as_i32(integer(Some(value),"page.level")?,"page.level")?});
   for (key,flag) in [("group",FLAG_GROUP),("source",FLAG_SOURCE)]{
    match item.get(key){
     None=>columns[PAGE_INT].i32(-1),
     Some(Value::Null)=>{flags|=flag;columns[PAGE_INT].i32(-1);},
     Some(value)=>{flags|=flag;columns[PAGE_INT].i32(as_i32(integer(Some(value),&format!("page.{key}"))?,&format!("page.{key}"))?);},
    }
   }
   let stream=match item.get("stream"){None=>-1,Some(value)=>as_i32(integer(Some(value),"page.stream")?,"page.stream")?};
   columns[PAGE_INT].i32(stream);
   columns[PAGE_INT].i32(if stream<0{-1}else{as_i32(integer(item.get("streamOffset"),"page.streamOffset")?,"page.streamOffset")?});
   columns[PAGE_INT].i32(as_i32(integer(item.get("count"),"page.count")?,"page.count")?);
   columns[PAGE_INT].i32(match item.get("start"){None=>-1,Some(value)=>as_i32(integer(Some(value),"page.start")?,"page.start")?});
   columns[PAGE_U32].u32(as_u32(integer(item.get("bytes"),"page.bytes")?,"page.bytes")?);
   let sha=text(item.get("sha256"),"page.sha256")?;
   templated(templates.page,text(item.get("url"),"page.url")?,sha)?;
   columns[PAGE_SHA].sha(sha)?;
   match item.get("geometry"){
    None|Some(Value::Null)=>{columns[GEOMETRY_SHA].zeros(64);columns[GEOMETRY_U32].zeros(20);},
    Some(value)=>{
     flags|=FLAG_GEOMETRY;
     let geometry=object(value,"page.geometry")?;
     let digest=text(geometry.get("sha256"),"page.geometry.sha256")?;
     templated(templates.geometry,text(geometry.get("url"),"page.geometry.url")?,digest)?;
     if integer(geometry.get("formatVersion"),"page.geometry.formatVersion")?!=2{return Err(bad("page.geometry.formatVersion is not 2"))}
     if text(geometry.get("codec"),"page.geometry.codec")?!="meshopt"{return Err(bad("page.geometry.codec is not meshopt"))}
     columns[GEOMETRY_SHA].sha(digest)?;
     for key in ["bytes","vertexCount","indexCount","flags","uncompressedBytes"]{
      columns[GEOMETRY_U32].u32(as_u32(integer(geometry.get(key),&format!("page.geometry.{key}"))?,&format!("page.geometry.{key}"))?);
     }
    },
   }
   columns[PAGE_U32].u32(flags);
  }
  let mut slim=entry.clone();
  slim.remove("pages");slim.remove("culling");slim.remove("structure");slim.remove("streams");
  let mut binary=Map::new();
  binary.insert("pages".into(),json!(pages.len()));
  match entry.get("culling"){
   None=>{},
   Some(Value::Null)=>{binary.insert("culling".into(),Value::Null);},
   Some(value)=>{
    let culling=object(value,"primitive.culling")?;
    let stride=integer(culling.get("stride"),"primitive.culling.stride")? as usize;
    let count=integer(culling.get("count"),"primitive.culling.count")? as usize;
    let nodes=array(culling.get("nodes").ok_or_else(||bad("primitive.culling.nodes is absent"))?,"primitive.culling.nodes")?;
    if stride!=crate::CULLING_STRIDE{return Err(bad(format!("primitive.culling.stride is {stride}, expected {}",crate::CULLING_STRIDE)))}
    if nodes.len()!=count*stride{return Err(bad("primitive.culling.nodes does not match its count"))}
    for (i,node) in nodes.iter().enumerate(){columns[CULLING_NODES].f64(number(Some(node),&format!("primitive.culling.nodes[{i}]"))?);}
    binary.insert("culling".into(),json!({"stride":stride,"count":count}));
   },
  }
  match entry.get("structure"){
   None=>{},
   Some(Value::Null)=>{binary.insert("structure".into(),Value::Null);},
   Some(value)=>{
    let structure=object(value,"primitive.structure")?;
    let groups=array(structure.get("groups").ok_or_else(||bad("primitive.structure.groups is absent"))?,"primitive.structure.groups")?;
    for group in groups{
     let item=object(group,"structure group")?;
     columns[GROUP_LEVEL].i32(as_i32(integer(item.get("level"),"group.level")?,"group.level")?);
     columns[GROUP_ERROR].f64(number(item.get("error"),"group.error")?);
     for value in vector(item.get("sphere"),4,"group.sphere")?{columns[GROUP_SPHERE].f64(value);}
     for (key,count_column,flat_column) in [("children",GROUP_CHILD_COUNT,GROUP_CHILD),("outputs",GROUP_OUTPUT_COUNT,GROUP_OUTPUT)]{
      let members=array(item.get(key).ok_or_else(||bad(format!("group.{key} is absent")))?,&format!("group.{key}"))?;
      columns[count_column].i32(as_i32(members.len() as i64,&format!("group.{key} length"))?);
      for member in members{columns[flat_column].i32(as_i32(integer(Some(member),&format!("group.{key} member"))?,"group member")?);}
     }
    }
    let roots=array(structure.get("roots").ok_or_else(||bad("primitive.structure.roots is absent"))?,"primitive.structure.roots")?;
    for root in roots{columns[STRUCTURE_ROOT].i32(as_i32(integer(Some(root),"structure root")?,"structure root")?);}
    binary.insert("structure".into(),json!({"version":integer(structure.get("version"),"primitive.structure.version")?,"groups":groups.len(),"roots":roots.len()}));
   },
  }
  match entry.get("streams"){
   None=>{},
   Some(Value::Null)=>{binary.insert("streams".into(),Value::Null);},
   Some(value)=>{
    let streams=object(value,"primitive.streams")?;
    let bundles=array(streams.get("pages").ok_or_else(||bad("primitive.streams.pages is absent"))?,"primitive.streams.pages")?;
    for bundle in bundles{
     let item=object(bundle,"stream bundle")?;
     let digest=text(item.get("sha256"),"bundle.sha256")?;
     templated(templates.bundle,text(item.get("url"),"bundle.url")?,digest)?;
     columns[BUNDLE_SHA].sha(digest)?;
     columns[BUNDLE_U32].u32(as_u32(integer(item.get("bytes"),"bundle.bytes")?,"bundle.bytes")?);
     columns[BUNDLE_U32].u32(as_u32(integer(item.get("count"),"bundle.count")?,"bundle.count")?);
    }
    binary.insert("streams".into(),json!({"version":integer(streams.get("version"),"primitive.streams.version")?,
     "pinned":integer(streams.get("pinned"),"primitive.streams.pinned")?,
     "bundleBytes":integer(streams.get("bundleBytes"),"primitive.streams.bundleBytes")?,
     "pages":bundles.len()}));
   },
  }
  slim.insert("binary".into(),Value::Object(binary));
  slim_primitives.push(Value::Object(slim));
 }
 let header_bytes=(HEADER_WORDS+COLUMNS*2)*4;
 let mut offsets=[0u32;COLUMNS];let mut offset=(header_bytes+7)&!7;
 for index in 0..COLUMNS{
  offsets[index]=u32::try_from(offset).map_err(|_|bad("Manifest binary exceeds four gigabytes"))?;
  offset=(offset+columns[index].bytes.len()+7)&!7;
 }
 let mut bytes=vec![0u8;offset];
 bytes[0..4].copy_from_slice(&MANIFEST_BINARY_MAGIC.to_le_bytes());
 bytes[4..8].copy_from_slice(&MANIFEST_BINARY_VERSION.to_le_bytes());
 bytes[8..12].copy_from_slice(&(COLUMNS as u32).to_le_bytes());
 for index in 0..COLUMNS{
  let at=(HEADER_WORDS+index*2)*4;
  bytes[at..at+4].copy_from_slice(&offsets[index].to_le_bytes());
  bytes[at+4..at+8].copy_from_slice(&(columns[index].bytes.len() as u32).to_le_bytes());
  let start=offsets[index] as usize;
  bytes[start..start+columns[index].bytes.len()].copy_from_slice(&columns[index].bytes);
 }
 let mut slim=root.clone();
 slim.insert("primitives".into(),Value::Array(slim_primitives));
 slim.insert("binary".into(),json!({"version":MANIFEST_BINARY_VERSION,"url":templates.binary,"sha256":"","bytes":bytes.len(),
  "pageUrl":templates.page,"geometryUrl":templates.geometry,"bundleUrl":templates.bundle}));
 Ok((Value::Object(slim),bytes))
}

#[cfg(test)]
mod tests {
 use super::*;
 fn sha(c:char)->String{std::iter::repeat_n(c,64).collect()}
 fn exact_page()->Value{
  let mut page=json!({"id":0,"bytes":48,"count":12,"start":0,"min":[0.,0.,0.],"max":[1.,1.,1.],"role":"exact","level":0});
  page["url"]=json!(format!("../../objects/{}.bin",sha('a')));page["sha256"]=json!(sha('a'));
  page["lodError"]=json!(0.0);page["sphere"]=json!([0.5,0.5,0.5,0.9]);
  page["parentError"]=json!(0.25);page["parentSphere"]=json!([1.,2.,3.,4.]);
  page["group"]=json!(0);page["source"]=Value::Null;page["stream"]=json!(0);page["streamOffset"]=json!(0);
  let mut geometry=json!({"bytes":32,"formatVersion":2,"codec":"meshopt","vertexCount":8,"indexCount":12,"flags":1,"uncompressedBytes":128});
  geometry["url"]=json!(format!("../../objects/{}.bin",sha('b')));geometry["sha256"]=json!(sha('b'));
  page["geometry"]=geometry;page
 }
 fn coarse_page()->Value{
  let mut page=json!({"id":1,"bytes":48,"count":12,"start":0,"min":[0.,0.,0.],"max":[1.,1.,1.],"role":"coarse","level":1});
  page["url"]=json!(format!("../../objects/{}.bin",sha('d')));page["sha256"]=json!(sha('d'));
  page["lodError"]=json!(0.25);page["sphere"]=json!([0.5,0.5,0.5,0.9]);
  page["parentError"]=Value::Null;page["parentSphere"]=Value::Null;
  page["group"]=Value::Null;page["source"]=json!(0);page["stream"]=json!(0);page["streamOffset"]=json!(48);page
 }
 fn sample()->Value{
  let mut bundle=json!({"bytes":96,"count":2});
  bundle["url"]=json!(format!("../../objects/{}.bin",sha('c')));bundle["sha256"]=json!(sha('c'));
  let mut primitive=json!({"mesh":0,"primitive":0,"pass":"exact-clusters","hierarchy":Value::Null});
  primitive["culling"]=json!({"stride":crate::CULLING_STRIDE,"count":1,"nodes":vec![0.5;crate::CULLING_STRIDE]});
  primitive["structure"]=json!({"version":1,"roots":[1],"groups":[{"level":1,"error":0.25,"sphere":[1.,2.,3.,4.],"children":[0],"outputs":[1]}]});
  primitive["streams"]=json!({"version":1,"pinned":1,"bundleBytes":131072,"pages":[bundle]});
  primitive["pages"]=json!([exact_page(),coarse_page()]);
  json!({"schema":2,"formatVersion":2,"status":"ready","primitives":[primitive]})
 }
 #[test]
 fn columns_declare_their_own_offsets_and_lengths(){
  let templates=Templates{binary:"clusters.bin",page:"../../objects/{sha}.bin",geometry:"../../objects/{sha}.bin",bundle:"../../objects/{sha}.bin"};
  let (slim,bytes)=split(&sample(),&templates).expect("split");
  assert_eq!(u32::from_le_bytes(bytes[0..4].try_into().unwrap()),MANIFEST_BINARY_MAGIC);
  assert_eq!(u32::from_le_bytes(bytes[4..8].try_into().unwrap()),MANIFEST_BINARY_VERSION);
  assert_eq!(u32::from_le_bytes(bytes[8..12].try_into().unwrap()),COLUMNS as u32);
  let read=|index:usize|{let at=(HEADER_WORDS+index*2)*4;(u32::from_le_bytes(bytes[at..at+4].try_into().unwrap()) as usize,u32::from_le_bytes(bytes[at+4..at+8].try_into().unwrap()) as usize)};
  let mut previous=(HEADER_WORDS+COLUMNS*2)*4;
  for index in 0..COLUMNS{
   let (offset,length)=read(index);
   assert_eq!(offset%8,0,"column {index} is not eight-byte aligned");
   assert!(offset>=previous&&offset+length<=bytes.len(),"column {index} is out of bounds");
   previous=offset+length;
  }
  // Two pages, six bounds each, eight bytes a number.
  assert_eq!(read(PAGE_BOUNDS).1,2*6*8);
  assert_eq!(read(PAGE_SHA).1,2*64);
  assert_eq!(read(CULLING_NODES).1,crate::CULLING_STRIDE*8);
  assert_eq!(read(GROUP_CHILD).1,4);
  assert_eq!(read(BUNDLE_SHA).1,64);
  // The small JSON keeps the counts and loses the arrays.
  let primitive=slim["primitives"][0].as_object().unwrap();
  assert!(primitive.get("pages").is_none()&&primitive.get("culling").is_none());
  assert_eq!(primitive["binary"]["pages"],json!(2));
  assert_eq!(primitive["binary"]["structure"]["groups"],json!(1));
  assert_eq!(primitive["binary"]["streams"]["pages"],json!(1));
  assert_eq!(slim["binary"]["bytes"],json!(bytes.len()));
 }
 #[test]
 fn a_url_that_leaves_the_template_is_refused(){
  let mut manifest=sample();
  manifest["primitives"][0]["pages"][0]["url"]=json!("pages/0.bin");
  let templates=Templates{binary:"clusters.bin",page:"../../objects/{sha}.bin",geometry:"../../objects/{sha}.bin",bundle:"../../objects/{sha}.bin"};
  assert_eq!(split(&manifest,&templates).unwrap_err().code,"INVALID_MANIFEST");
 }
}
