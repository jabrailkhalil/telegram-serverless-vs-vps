import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {namesFor,MODES} from './common.mjs';
import {createVps} from './vps-client.mjs';
const directory=dirname(fileURLToPath(import.meta.url)),project=resolve(directory,'../..'),workspace=resolve(process.env.BENCH_WORKSPACE||resolve(project,'../..'));
const work=resolve(process.env.BENCH_WORK_DIR||join(workspace,'work'));await mkdir(work,{recursive:true});process.chdir(project);
const suffix='f'+Date.now().toString(36),names=namesFor(suffix);
const model=await readFile(join(project,'tgcloud/lib/model.js'),'utf8');
const mapped=model.replaceAll('water_events',names.events).replaceAll('gardens',names.gardens),optimized=mapped.replaceAll('await ensurePlanted(now);','/* Fixture is already planted. */');
const common=await readFile(join(directory,'common.mjs'),'utf8');
const cli=resolve(process.env.TGCLOUD_CLI_ROOT||join(work,'telegram-lab-runtime/node_modules/@tgcloud/cli/src'));
const {runFunction,getFiles}=await import(pathToFileURL(join(cli,'api/endpoints.js')).href);
const {resolveToken}=await import(pathToFileURL(join(cli,'core/credentials.js')).href);
const token=await resolveToken();
const cloudSource=await readFile(join(directory,'cloud.js'),'utf8');
const sources={'lib/ext_common':common,'lib/ext_model':mapped,'lib/ext_model_optimized':optimized,'endpoints/ext':cloudSource};
const output={startedAt:new Date().toISOString(),fixture:names,environments:{},cleanup:{},errors:[],notes:['VPS databases are on /var/tmp, verified ext4.','The cloud SQL concurrency suite uses Promise.all within one invocation; it is not a multi-user throughput benchmark.']};
const save=()=>writeFile(join(directory,'results/supplement.json'),JSON.stringify(output,null,2));
const pause=ms=>new Promise(r=>setTimeout(r,ms));let previous=0;
async function cloud(input){const wait=Math.max(0,previous+3000-performance.now());if(wait)await pause(wait);previous=performance.now();for(let i=0;i<3;i++){try{const t=performance.now(),r=await runFunction(token,'endpoints/ext',sources,{suffix,...input},{});return {...r.result,runtimeReportedMs:r.time*1000,controllerRoundTripMs:performance.now()-t};}catch(e){if(e.code!==429||i===2)throw e;await pause((Number(e.parameters?.retry_after)||30)*1000+1000);}}}
let serial=0,actors=0;
const jobs=(level,mode)=>Array.from({length:level},()=>({action:'measure',mode,count:1,warmup:0}));
// Native disk measurements run before any cloud call, allowing prior quota windows to expire.
for(const alias of ['fi','de']){
  let host;
  try{
    host=await createVps({alias,workspace,directory,mapped,optimized,common,suffix});
    const e=output.environments[alias]={rounds:[],scale:[],concurrency:[],independent:[],outbound:[],filesystem:host.filesystem};
    e.metadataBefore=await host.call({action:'metadata'});await host.call({action:'setup'});
    for(let round=0;round<3;round++){const cases={};for(const mode of MODES)cases[mode]=await host.call({action:'measure',mode,count:mode.startsWith('write32')?10:50,warmup:3,idBase:50000000+(++serial)*100000});e.rounds.push({round,cases});}
    for(const size of [1000,10000,100000])for(let round=0;round<3;round++){await host.call({action:'seed',size});const cases={};for(const mode of ['gardenRead','gardenReadNoEnsure','gardenWater'])cases[mode]=await host.call({action:'measure',mode,count:mode==='gardenWater'?20:30,warmup:3,actorBase:90000000000000+(++actors)*1000});e.scale.push({size,round,cases});}
    await host.call({action:'counterReset'});let increments=0;
    for(const level of [1,4,8])for(const mode of ['indexedRead','increment'])for(let round=0;round<5;round++){const response=await host.call({action:'parallel',jobs:jobs(level,mode)});if(mode==='increment')increments+=level;e.concurrency.push({level,mode,round,results:response.results,controllerWallMs:response.wallMs});}
    e.counter=await host.call({action:'counter'});if(e.counter.value!==increments)throw new Error('Lost increments');
    for(let i=0;i<10;i++)e.independent.push({mode:'noop',sample:i,...await host.call({action:'measure',mode:'noop',count:1,warmup:0})});
    for(let round=0;round<3;round++)for(const url of ['https://telegram.org/js/telegram-web-app.js','https://app8881637352.tgcloud.ai/'])e.outbound.push({round,url,...await host.call({action:'measure',mode:'outbound',url,count:10,warmup:0})});
    await save();console.log(`${alias}: persistent disk measurements complete (${e.filesystem.filesystems[0].fstype})`);
  }catch(error){output.errors.push(alias+': '+error.message);console.error(error.message);}
  finally{if(host)output.cleanup[alias]=await host.cleanup();await save();}
}
try{
  const e=output.environments.telegram={concurrency:[],independent:[],outbound:[]};
  await cloud({action:'setup'});await cloud({action:'seed',size:1000});
  const result=await cloud({action:'concurrencySuite'});e.concurrency=result.rounds;e.counter=result.counter;e.concurrencyScope='Concurrent SDK SQL calls inside one invocation';
  for(let i=0;i<10;i++){e.independent.push({mode:'noop',sample:i,...await cloud({action:'measure',mode:'noop',count:1,warmup:0})});}
  for(let round=0;round<3;round++)for(const url of ['https://telegram.org/js/telegram-web-app.js','https://app8881637352.tgcloud.ai/']){e.outbound.push({round,url,...await cloud({action:'measure',mode:'outbound',url,count:10,warmup:0})});await save();}
}catch(error){output.errors.push('telegram: '+error.message);console.error(error.message);}
finally{
  try{output.cleanup.telegram=await cloud({action:'cleanup'});}catch(error){output.cleanup.telegram={cleaned:false,error:error.message};}
  try{
    await pause(3000);
    const result=await runFunction(token,'endpoints/finalprobe',{'endpoints/finalprobe':`import {db} from 'sdk';export default async function(){return {garden:await db.get('SELECT COUNT(*) AS waters FROM water_events'),temporaryTables:await db.all("SELECT name FROM sqlite_master WHERE name LIKE 'lab_ext_%'")};}`},{},{});output.finalProbe=result.result;
    const baseline=JSON.parse(await readFile(join(work,'extended-bench-baseline.json'),'utf8'));await pause(3500);const state=await getFiles(token);output.deployedRevisionUnchanged=state.revision===baseline.revision;output.deployedSourcesUnchanged=JSON.stringify(state.canonical_modules)===JSON.stringify(baseline.canonical_modules);
  }catch(error){output.finalProbe={error:error.message};}
  output.finishedAt=new Date().toISOString();await save();
}
console.log(JSON.stringify({errors:output.errors,cleanup:output.cleanup,finalProbe:output.finalProbe,revisionUnchanged:output.deployedRevisionUnchanged,sourcesUnchanged:output.deployedSourcesUnchanged}));
if(output.errors.length||Object.values(output.cleanup).some(v=>!v.cleaned))process.exitCode=1;
