import {readFile,writeFile} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
const directory=dirname(fileURLToPath(import.meta.url)),project=resolve(directory,'../..');
const work=resolve(process.env.BENCH_WORK_DIR||join(resolve(project,'../..'),'work'));
const cli=resolve(process.env.TGCLOUD_CLI_ROOT||join(work,'telegram-lab-runtime/node_modules/@tgcloud/cli/src'));
process.chdir(project);
const {runFunction,getFiles}=await import(pathToFileURL(join(cli,'api/endpoints.js')).href);
const {resolveToken}=await import(pathToFileURL(join(cli,'core/credentials.js')).href);
const token=await resolveToken(),suffix=Date.now().toString(36);
const source=`import {db} from 'sdk';export default async function(input){const name='lab_ext_probe_'+input.suffix;if(!/^lab_ext_probe_[a-z0-9_]+$/.test(name))throw new Error('Invalid table');await db.run('CREATE TABLE '+name+'(id INTEGER PRIMARY KEY,value INTEGER NOT NULL)');const output={};try{
if(input.kind==='write'){for(const rows of [10000,10001]){await db.run('DELETE FROM '+name);const before=await db.get('SELECT COUNT(*) AS n FROM '+name);let error,affected;try{affected=(await db.run('WITH RECURSIVE n(i) AS(VALUES(1) UNION ALL SELECT i+1 FROM n WHERE i<'+rows+') INSERT INTO '+name+' SELECT i,i FROM n')).rowsAffected;}catch(e){error=e.message;}const after=await db.get('SELECT COUNT(*) AS n FROM '+name);output['rows'+rows]={before:before.n,after:after.n,affected,error};}await db.run('DELETE FROM '+name+' WHERE id IN (SELECT id FROM '+name+' LIMIT 10000)');for(let start=1;start<=12000;start+=6000)await db.run('WITH RECURSIVE n(i) AS(VALUES('+start+') UNION ALL SELECT i+1 FROM n WHERE i<'+(start+5999)+') INSERT INTO '+name+' SELECT i,i FROM n');output.twoStatements=await db.get('SELECT COUNT(*) AS rows FROM '+name);}
else {for(let start=1;start<=100001;start+=1000){const end=Math.min(100001,start+999);await db.run('WITH RECURSIVE n(i) AS(VALUES('+start+') UNION ALL SELECT i+1 FROM n WHERE i<'+end+') INSERT INTO '+name+' SELECT i,i FROM n');}for(const rows of [1,9999,10000,10001,19999,20000,20001,49999,50000,50001,99999,100000,100001]){try{output['rows'+rows]={result:await db.get('SELECT SUM(value) AS total FROM '+name+' WHERE id<='+rows)};}catch(e){output['rows'+rows]={error:e.message};}}output.indexedLookup=await db.get('SELECT value FROM '+name+' WHERE id=100001');}
}finally{await db.run('DROP TABLE IF EXISTS '+name);output.cleaned=true;}return output;}`;
const record={startedAt:new Date().toISOString(),telegram:{},native:{}};
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function invoke(kind){for(let attempt=0;attempt<4;attempt++){try{return await runFunction(token,'endpoints/queryprobe',{'endpoints/queryprobe':source},{suffix:suffix+'_'+kind,kind},{});}catch(error){if(error.code!==429||attempt===3)throw error;await pause((Number(error.parameters?.retry_after)||30)*1000+1000);}}}
for(const kind of ['write','read']){await pause(3500);const response=await invoke(kind);record.telegram[kind]=response.result;await writeFile(join(directory,'results/query-boundaries.json'),JSON.stringify(record,null,2));console.log(JSON.stringify({kind,result:response.result}));}
const py=`import sqlite3,json\nc=sqlite3.connect(':memory:')\nc.execute('CREATE TABLE t(id INTEGER PRIMARY KEY,value INTEGER)')\nout={'sqlite':sqlite3.sqlite_version,'writes':{}}\nfor n in [10000,10001]:\n c.execute('DELETE FROM t')\n c.execute('WITH RECURSIVE n(i) AS(VALUES(1) UNION ALL SELECT i+1 FROM n WHERE i<'+str(n)+') INSERT INTO t SELECT i,i FROM n')\n out['writes'][n]=c.execute('SELECT COUNT(*) FROM t').fetchone()[0]\nprint(json.dumps(out))\n`;
for(const alias of ['fi','de']){record.native[alias]=await new Promise((res,rej)=>{const child=spawn('ssh',['-F',resolve(process.env.BENCH_SSH_CONFIG||join(work,'vps-ssh.conf')),alias,'python3 -'],{windowsHide:true});let output='',error='';child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>error+=d);child.on('close',code=>code===0?res(JSON.parse(output)):rej(new Error(error)));child.stdin.end(py);});}
record.finishedAt=new Date().toISOString();await writeFile(join(directory,'results/query-boundaries.json'),JSON.stringify(record,null,2));
async function retry(call){for(let attempt=0;attempt<4;attempt++){await pause(3500);try{return await call();}catch(error){if(error.code!==429||attempt===3)throw error;await pause((Number(error.parameters?.retry_after)||30)*1000+1000);}}}
const probe=await retry(()=>runFunction(token,'endpoints/finalprobe',{'endpoints/finalprobe':`import {db} from 'sdk';export default async function(){return {garden:await db.get('SELECT COUNT(*) AS waters FROM water_events'),temporaryTables:await db.all("SELECT name FROM sqlite_master WHERE name LIKE 'lab_ext_%'")};}`},{},{}));
const baseline=JSON.parse(await readFile(join(work,'extended-bench-baseline.json'),'utf8')),state=await retry(()=>getFiles(token));
record.finalProbe=probe.result;record.deployedRevisionUnchanged=state.revision===baseline.revision;record.deployedSourcesUnchanged=JSON.stringify(state.canonical_modules)===JSON.stringify(baseline.canonical_modules);record.finishedAt=new Date().toISOString();await writeFile(join(directory,'results/query-boundaries.json'),JSON.stringify(record,null,2));console.log(JSON.stringify({finalProbe:record.finalProbe,revisionUnchanged:record.deployedRevisionUnchanged,sourcesUnchanged:record.deployedSourcesUnchanged}));


