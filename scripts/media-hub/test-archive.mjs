import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {execFileSync} from 'node:child_process';import {createRequire} from 'node:module';
const {extractArchive}=createRequire(import.meta.url)('./archive-extract.cjs');
// Builds zips with Python's zipfile so the reader is checked against a real zip writer
const makeZip=(file,files,opts='')=>execFileSync('python3',['-I','-c',`import zipfile,sys,json
z=zipfile.ZipFile(sys.argv[1],'w',zipfile.ZIP_DEFLATED${opts})
for n,(size,method) in json.loads(sys.argv[2]).items():
  info=zipfile.ZipInfo(n);info.compress_type=zipfile.ZIP_STORED if method=='stored' else zipfile.ZIP_DEFLATED
  with z.open(info,'w',force_zip64=True) as f: f.write(bytes((i*7+len(n))%251 for i in range(size)))
z.close()`,file,JSON.stringify(files)]);
const dir=()=>fs.mkdtempSync(path.join(os.tmpdir(),'seanime-archive-test-'));

test('a season zip unpacks into its folder with every file checked',async()=>{
 const d=dir();try{const zip=path.join(d,'Show 1080p.zip');
  makeZip(zip,{'Show/Show - 01.mkv':[300000,'deflate'],'Show/Show - 02.mkv':[200000,'stored'],'Show/notes.txt':[0,'deflate'],'__MACOSX/._x':[10,'stored']});
  let progress=0;const videos=await extractArchive(zip,d,n=>{progress=n});
  assert.deepEqual(videos.map(v=>path.relative(d,v)).sort(),['Show/Show - 01.mkv','Show/Show - 02.mkv']);
  assert.equal(fs.statSync(path.join(d,'Show/Show - 01.mkv')).size,300000);assert.equal(progress,500000);
  assert.ok(!fs.existsSync(path.join(d,'__MACOSX')));assert.ok(!fs.readdirSync(path.join(d,'Show')).some(f=>f.endsWith('.part')));
 }finally{fs.rmSync(d,{recursive:true,force:true})}
});

test('a damaged zip is reported and nothing half-written is left as an episode',async()=>{
 const d=dir();try{const zip=path.join(d,'s.zip');makeZip(zip,{'Show - 01.mkv':[400000,'stored']});
  const b=fs.readFileSync(zip);b[200000]^=0xff;fs.writeFileSync(zip,b);
  await assert.rejects(extractArchive(zip,d),/did not check out/);assert.ok(!fs.existsSync(path.join(d,'Show - 01.mkv')));
 }finally{fs.rmSync(d,{recursive:true,force:true})}
});

test('unsafe names and archives without episodes are refused',async()=>{
 const d=dir();try{const zip=path.join(d,'a.zip');makeZip(zip,{'../evil.mkv':[10,'stored']});await assert.rejects(extractArchive(zip,path.join(d,'in')),/unsafe/);assert.ok(!fs.existsSync(path.join(d,'evil.mkv')));
  const zip2=path.join(d,'b.zip');makeZip(zip2,{'readme.txt':[10,'stored']});await assert.rejects(extractArchive(zip2,d),/No episodes/);
 }finally{fs.rmSync(d,{recursive:true,force:true})}
});

test('7z archives unpack through 7-Zip when it is installed',{skip:!fs.existsSync('/usr/bin/7z')},async()=>{
 const d=dir();try{fs.mkdirSync(path.join(d,'src'));fs.writeFileSync(path.join(d,'src','Ep 01.mp4'),Buffer.alloc(50000,3));execFileSync('7z',['a','-bd',path.join(d,'s.7z'),'./src/*'],{cwd:d,stdio:'ignore'});
  const out=path.join(d,'out');fs.mkdirSync(out);const videos=await extractArchive(path.join(d,'s.7z'),out);assert.deepEqual(videos.map(v=>path.basename(v)),['Ep 01.mp4']);
 }finally{fs.rmSync(d,{recursive:true,force:true})}
});
