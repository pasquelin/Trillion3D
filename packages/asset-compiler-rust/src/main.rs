use web_geometry_compiler::{compile,parse_compiler_args};use std::sync::{Arc,atomic::AtomicBool};
fn run()->std::result::Result<(),String>{let args:Vec<String>=std::env::args().skip(1).collect();let options=parse_compiler_args(&args,Arc::new(AtomicBool::new(false)))?;match compile(&options,|event|eprintln!("{}",event)){Ok(result)=>{println!("{}",result);Ok(())},Err(error)=>Err(serde_json::json!({"status":"error","code":error.code,"message":error.message}).to_string())}}
fn main(){if let Err(error)=run(){eprintln!("{error}");std::process::exit(2)}}
