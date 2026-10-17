import {readFile,writeFile,mkdir,mkdtemp} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {namesFor,MODES} from './common.mjs';

const project=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const workspace=resolve(process.env.BENCH_WORKSPACE||resolve(project,'../..'));
const work=resolve(process.env.BENCH_WORK_DIR||join(workspace,'work'));await mkdir(work,{recursive:true});
const directory=resolve(dirname(fileURLToPath(import.meta.url)));
const out=join(directory,'results');await mkdir(out,{recursive:true});
const cli=resolve(process.env.TGCLOUD_CLI_ROOT||join(work,'telegram-lab-runtime/node_modules/@tgcloud/cli/src'));
const {runFunction,getFiles}=await import(pathToFileURL(join(cli,'api/endpoints.js')).href);
process.chdir(project);
const {resolveToken}=await import(pathToFileURL(join(cli,'core/credentials.js')).href);
const token=await resolveToken();
const suffix='r'+Date.now().toString(36);
const names=namesFor(suffix);
const source=await readFile(join(project,'tgcloud/lib/model.js'),'utf8');
const mapped=source.replaceAll('water_events',names.events).replaceAll('gardens',names.gardens);
const optimized=mapped.replaceAll('await ensurePlanted(now);','/* Fixture is already planted. */');
const common=await readFile(join(directory,'common.mjs'),'utf8');
const sources={'lib/ext_common':common,'lib/ext_model':mapped,'lib/ext_model_optimized':optimized,'endpoints/ext':await readFile(join(directory,'cloud.js'),'utf8')};
let record={startedAt:new Date().toISOString(),run:suffix,pilot:process.argv.includes('--pilot'),fixture:names,environments:{},errors:[],cleanup:{},notes:['Cloud calls use the authenticated developer run API, not the deployed Mini App endpoint.','Server-side timings exclude the controller transport. CPU and JSON are pure JavaScript.','Concurrency is bounded at 8. This is not a saturation test.','The optimized read only omits ensurePlanted, after setup inserted the garden. Production code is unchanged.']};
if(process.argv.includes('--resume')){record=JSON.parse(await readFile(join(out,'raw.json'),'utf8'));record.observedLimits=[...(record.observedLimits||[]),...record.errors.map(error=>({error,observedAt:record.finishedAt}))];record.errors=[];record.cleanup={};record.segments??=[{startedAt:record.startedAt,fixture:record.fixture}];record.segments.push({startedAt:new Date().toISOString(),fixture:names});}
let serial=0,actorSerial=0;const clients={};const remotes=[];
let nextCloudCall=0;const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function pace(weight=1){const wait=Math.max(0,nextCloudCall-performance.now());nextCloudCall=Math.max(nextCloudCall,performance.now())+weight*3500;if(wait)await sleep(wait);}
async function invoke(input){for(let attempt=0;attempt<3;attempt++){try{return await runFunction(token,'endpoints/ext',sources,{suffix,...input},{});}catch(error){if((error.code===429||error.status===429)&&attempt<2){const seconds=Number(error.parameters?.retry_after||String(error.message).match(/retry after (\d+)/i)?.[1]||30);console.log(`Management API rate limit: waiting ${seconds+1}s`);await sleep((seconds+1)*1000);continue;}throw error;}}}
const safeError=error=>String(error?.message||error).replaceAll(token,'[REDACTED]').slice(0,1000);
const save=()=>writeFile(join(out,'raw.json'),JSON.stringify(record,null,2));
function command(cmd,args,options={}){return new Promise((res,rej)=>{const child=spawn(cmd,args,{...options,windowsHide:true});let stdout='',stderr='';child.stdout.on('data',d=>stdout+=d);child.stderr.on('data',d=>stderr+=d);child.once('error',rej);child.once('close',code=>code===0?res(stdout):rej(new Error(`${cmd} failed (${code}): ${stderr.slice(-500)}`)));});}
function adapter(alias){
  const env=record.environments[alias]??={calls:[],rounds:[],concurrency:[],idle:[]};
  return async input=>{if(alias==='telegram'&&!input.wave)await pace();const t=performance.now();let value;
    if(alias==='telegram'){const r=await invoke(input);value=r.result;env.calls.push({action:input.action,mode:input.mode,size:input.size,roundTripMs:performance.now()-t,runtimeReportedMs:r.time*1000});}
    else {value=await clients[alias](input);env.calls.push({action:input.action,mode:input.mode,size:input.size,roundTripMs:performance.now()-t,runtimeReportedMs:value._hostReportedMs});delete value._hostReportedMs;}
    return value;
  };
}
const cfg=resolve(process.env.BENCH_SSH_CONFIG||join(work,'vps-ssh.conf'));
async function startVps(alias){
  const remote=(await command('ssh',['-F',cfg,alias,'mktemp -d /var/tmp/telegram-garden-extended-XXXXXXXX'])).trim();
  if(!/^\/var\/tmp\/telegram-garden-extended-[a-zA-Z0-9]+$/.test(remote))throw new Error('Unexpected remote directory');
  remotes.push({alias,remote});
  const filesystem=JSON.parse(await command('ssh',['-F',cfg,alias,`findmnt -J -T ${remote} -o FSTYPE`]));if(filesystem.filesystems[0].fstype==='tmpfs')throw new Error('Persistent storage required');
  const staging=await mkdtemp(join(work,'ext-bundle-'));
  for(const [file,body]of [['ext-model.mjs',mapped],['ext-model-optimized.mjs',optimized],['common.mjs',common],['vps-runner.mjs',await readFile(join(directory,'vps-runner.mjs'),'utf8')]])await writeFile(join(staging,file),body);
  const binary=resolve(process.env.BENCH_NODE_LOCAL||join(work,'benchmark-node-linux'));
  await command('scp',['-q','-F',cfg,...['ext-model.mjs','ext-model-optimized.mjs','common.mjs','vps-runner.mjs'].map(f=>join(staging,f)),`${alias}:${remote}/`]);
  await command('scp',['-q','-F',cfg,binary,`${alias}:${remote}/node`]);
  await command('ssh',['-F',cfg,alias,`chmod 700 ${remote}/node`]);
  const child=spawn('ssh',['-F',cfg,alias,`${remote}/node ${remote}/vps-runner.mjs ${suffix}`],{windowsHide:true});
  const pending=new Map();let id=0;let stderr='';
  child.stderr.on('data',d=>stderr+=d);
  createInterface({input:child.stdout}).on('line',line=>{try{const r=JSON.parse(line),job=pending.get(r.id);if(job){pending.delete(r.id);if(r.error)job.reject(new Error(r.error));else{r.result._hostReportedMs=r.runtimeReportedMs;job.resolve(r.result);}}}catch(error){for(const job of pending.values())job.reject(error);pending.clear();}});
  child.once('close',code=>{for(const job of pending.values())job.reject(new Error('Remote runner closed '+code+': '+stderr.slice(-500)));pending.clear();});
  clients[alias]=input=>new Promise((resolve,reject)=>{const requestId=++id;pending.set(requestId,{resolve,reject});child.stdin.write(JSON.stringify({id:requestId,input})+'\n');});
  remotes.find(r=>r.alias===alias).child=child;
}
const call={};
async function runRound(alias,round,modes=MODES){
  if(record.environments[alias].rounds.some(r=>r.round===round))return;
  const results={round,cases:{}};
  for(const mode of modes){const count=record.pilot?3:['cpu','json'].includes(mode)?15:mode.startsWith('write32')?10:50;
    const response=await call[alias]({action:'measure',mode,count,warmup:mode==='noop'?0:3,idBase:10000000+(++serial)*100000,actorBase:90000000000000+(++actorSerial)*1000});
    if(['select1','indexedRead','increment','write32Separate','write32Batch'].includes(mode)&&response.last!==({select1:1,indexedRead:123,increment:1,write32Separate:32,write32Batch:32}[mode]))throw new Error('Wrong result '+mode);
    results.cases[mode]=response;
  }
  record.environments[alias].rounds.push(results);await save();console.log(`${alias}: micro round ${round} complete`);
}
try{
  await pace();await writeFile(join(work,'extended-bench-baseline.json'),JSON.stringify(await getFiles(token)));await pace();
  if(process.argv.includes('--resume')){record.preResumeCleanup=[];for(const segment of record.segments.slice(0,-1)){const priorSuffix=segment.fixture.events.replace('lab_ext_events_','');await pace();record.preResumeCleanup.push({fixture:segment.fixture,result:(await invoke({suffix:priorSuffix,action:'cleanup'})).result});}}
  record.productionBefore=(await runFunction(token,'endpoints/check',{'endpoints/check':`import {db} from 'sdk';export default async function(){return db.get('SELECT COUNT(*) AS waters FROM water_events');}`},{},{})).result;
  await Promise.all(['fi','de'].map(startVps));
  for(const alias of ['fi','de','telegram']){
    call[alias]=adapter(alias);if(alias!=='telegram')record.environments[alias].metadataBefore=await call[alias]({action:'metadata'});
    record.environments[alias].setupAttempted=true;await call[alias]({action:'setup'});record.environments[alias].setup=true;
  }
  const rounds=record.pilot?1:3;
  for(let round=0;round<rounds;round++)for(const alias of [['fi','telegram','de'],['de','fi','telegram'],['telegram','de','fi']][round%3])await runRound(alias,round);
  for(let round=0;round<(record.pilot?2:30);round++)for(const alias of [['fi','telegram','de'],['de','fi','telegram'],['telegram','de','fi']][round%3])for(const mode of ['cpu','json']){
    if(record.environments[alias].pure?.some(r=>r.mode===mode&&r.round===round))continue;
    const count=mode==='cpu'?20:5;const response=await call[alias]({action:'measure',mode,count,warmup:0});
    (record.environments[alias].pure??=[]).push({mode,round,iterations:count,runtimeReportedMs:record.environments[alias].calls.at(-1).runtimeReportedMs,innerClockSamplesMs:response.samplesMs,last:response.last,jsonBytes:response.jsonBytes});
    if(round%10===0)console.log(`${alias}: pure ${mode} block ${round} complete`);
  }
  await save();
  for(const size of record.pilot?[1000]:[1000,10000,100000]){
    for(let round=0;round<rounds;round++)for(const alias of [['telegram','fi','de'],['fi','de','telegram'],['de','telegram','fi']][round%3]){
      if(record.environments[alias].scale?.some(r=>r.size===size&&r.round===round))continue;
      const cases={};try{await call[alias]({action:'seed',size});}catch(error){(record.environments[alias].scaleFailures??=[]).push({size,round,phase:'seed',error:safeError(error)});await save();continue;}
      for(const mode of ['gardenRead','gardenReadNoEnsure','gardenWater']){
        let r;try{r=await call[alias]({action:'measure',mode,count:record.pilot?3:mode==='gardenWater'?20:30,warmup:3,actorBase:90000000000000+(++actorSerial)*1000});}catch(error){cases[mode]={samplesMs:[],error:safeError(error)};continue;}
        if(mode!=='gardenWater'&&r.last.waters!==size)throw new Error('Wrong garden size');
        if(mode==='gardenWater'&&!r.last.accepted)throw new Error('Rejected synthetic watering');
        cases[mode]=r;
      }
      (record.environments[alias].scale??=[]).push({size,round,cases});await save();console.log(`${alias}: ${size} rows round ${round} complete`);
    }
  }
  if(!process.argv.includes('--core-only')){
  for(const alias of ['fi','telegram','de']){
    const env=record.environments[alias];env.concurrency=[];await call[alias]({action:'counterReset'});let increments=0;
    for(const level of record.pilot?[2]:[1,4,8])for(const mode of ['indexedRead','increment'])for(let round=0;round<(record.pilot?1:5);round++){
      const jobs=Array.from({length:level},()=>({action:'measure',mode,count:1,warmup:0,wave:true}));if(alias==='telegram')await pace(level);const t=performance.now();
      const response=alias==='telegram'?{results:await Promise.all(jobs.map(job=>call[alias](job)))}:await call[alias]({action:'parallel',jobs});
      for(const r of response.results)if(r.last!==(mode==='indexedRead'?123:1))throw new Error('Concurrency result mismatch');
      if(mode==='increment')increments+=level;
      env.concurrency.push({level,mode,round,controllerWallMs:performance.now()-t,hostWallMs:response.wallMs,results:response.results});
    }
    env.counter=await call[alias]({action:'counter'});if(env.counter.value!==increments)throw new Error('Lost concurrent increments');
    await save();console.log(`${alias}: concurrency complete, ${increments} increments preserved`);
  }
  for(const alias of ['fi','telegram','de']){record.environments[alias].writeLimit=[];for(const rows of [10000,10001])record.environments[alias].writeLimit.push(await call[alias]({action:'limitProbe',rows}));await save();console.log(`${alias}: SQL write boundary checked`);}
  for(const alias of ['telegram','de','fi']){
    const env=record.environments[alias];env.independent=[];
    for(const mode of ['noop','select1','gardenRead'])for(let i=0;i<(record.pilot?2:20);i++){
      const r=await call[alias]({action:'measure',mode,count:1,warmup:0});env.independent.push({mode,sample:i,controllerRoundTripMs:env.calls.at(-1).roundTripMs,runtimeReportedMs:env.calls.at(-1).runtimeReportedMs,...r});
    }
    await save();console.log(`${alias}: independent calls complete`);
  }
  for(let round=0;round<(record.pilot?1:3);round++)for(const alias of ['de','telegram','fi'])for(const url of ['https://telegram.org/js/telegram-web-app.js','https://app8881637352.tgcloud.ai/']){
    const result=await call[alias]({action:'measure',mode:'outbound',url,count:record.pilot?1:10,warmup:0});
    (record.environments[alias].outbound??=[]).push({round,url,...result});await save();console.log(`${alias}: outbound round ${round} ${new URL(url).hostname}: ${result.outcomes.filter(o=>o.status===200).length}/${result.outcomes.length} successful`);
  }
  }
}catch(error){record.errors.push(safeError(error));console.error('BENCHMARK ERROR: '+safeError(error));}
finally{
  if(call.telegram&&record.environments.telegram.setupAttempted){try{record.cleanup.telegram=await call.telegram({action:'cleanup'});}catch(error){record.cleanup.telegram={cleaned:false,error:safeError(error)};}}
  for(const {alias,remote,child}of remotes){
    if(child){child.stdin.end();await new Promise(res=>child.exitCode!==null?res():child.once('close',res));}
    try{await command('ssh',['-F',cfg,alias,`rm -r -- ${remote}`]);record.cleanup[alias]={cleaned:true};}catch(error){record.cleanup[alias]={cleaned:false,error:safeError(error)};}
  }
  try{record.productionAfter=(await runFunction(token,'endpoints/check',{'endpoints/check':`import {db} from 'sdk';export default async function(){return db.get('SELECT COUNT(*) AS waters FROM water_events');}`},{},{})).result;}catch(error){record.productionAfter={error:safeError(error)};}
  record.finishedAt=new Date().toISOString();await save();
}
if(record.errors.length||Object.values(record.cleanup).some(v=>!v.cleaned))process.exitCode=1;
console.log(JSON.stringify({finished:record.finishedAt,errors:record.errors,cleanup:record.cleanup,productionBefore:record.productionBefore,productionAfter:record.productionAfter}));
