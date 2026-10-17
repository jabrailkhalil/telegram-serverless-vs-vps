import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import net from 'node:net';
import tls from 'node:tls';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const out=join(root,'benchmark/results');
await mkdir(out,{recursive:true});
const model=await readFile(join(root,'tgcloud/lib/model.js'),'utf8');
const scenario=await readFile(join(root,'benchmark/scenario.mjs'),'utf8');
const mode=process.argv[2];
function exec(cmd,args,options={}) {
  return new Promise((r,j)=>{
    const child=spawn(cmd,args,{...options,windowsHide:true}); let stdout='',stderr='';
    child.stdout.on('data',x=>stdout+=x);child.stderr.on('data',x=>stderr+=x);
    child.once('error',j);child.once('close',code=>code===0?r({stdout,stderr}):j(new Error(`${cmd} failed (${code}): ${stderr.slice(-1200)}`)));
  });
}

if(mode==='cloud') {
  const token=process.env.TGCLOUD_TOKEN;if(!token) throw new Error('TGCLOUD_TOKEN required');
  const apiPath=process.env.TGCLOUD_CLI_MODULE||join(root,'node_modules/@tgcloud/cli/src/api/endpoints.js');
  const {runFunction}=await import(pathToFileURL(resolve(apiPath)).href);
  const suffix=Date.now().toString(36);
  const names={gardens:`lab_bench_gardens_${suffix}`,events:`lab_bench_events_${suffix}`,index:`lab_bench_actor_${suffix}`};
  const sources={
    'lib/bench_model':model.replaceAll('water_events',names.events).replaceAll('gardens',names.gardens),
    'lib/bench_scenario':scenario,
    'endpoints/bench':await readFile(join(root,'benchmark/cloud.js'),'utf8')
  };
  const result={environment:'Telegram Serverless',timer:'Date.now (1 ms quantization)',
    note:'Authenticated developer run API. Measured operations reuse an invocation after five warmups. Not a Mini App latency measurement.',
    startedAt:new Date().toISOString(),fixture:names,modes:{},concurrent:[],managementCalls:[]};
  const run=async input=>{
    const t=performance.now();
    const response=await runFunction(token,'endpoints/bench',sources,{...names,...input},{});
    result.managementCalls.push({action:input.action,roundTripMs:performance.now()-t,runtimeReportedMs:response.time*1000});
    return response.result;
  };
  let setup=false;
  try {
    setup=true;result.setup=await run({action:'setup'});
    for(const action of ['read','water','replay']) {result.modes[action]=await run({action}); console.log(`Cloud ${action}: ${result.modes[action].samplesMs.length} samples`);}
    for(const kind of ['same','different']) for(let round=0;round<3;round++) {
      const results=await Promise.all(Array.from({length:4},(_,i)=>run({action:'single',
        actor:80000001000000+(kind==='same'?round:100+round*4+i),event:`concurrent:${kind}:${round}:${i}`})));
      result.concurrent.push({mode:kind,round,results});
    }
  } finally {
    if(setup) {
      try {result.cleanup=await run({action:'cleanup'});}
      catch(e) {result.cleanup={cleaned:false,error:e.message};}
    }
    result.finishedAt=new Date().toISOString();
    await writeFile(join(out,'telegram.json'),JSON.stringify(result,null,2));
  }
  if(!result.cleanup?.cleaned) throw new Error('Temporary fixture cleanup not confirmed; see results/telegram.json');
  console.log(JSON.stringify({environment:result.environment,cleanup:result.cleanup,modes:Object.keys(result.modes)}));
} else if(mode==='vps') {
  const alias=process.argv[3];if(!['fi','de'].includes(alias)) throw new Error('Expected fi or de SSH alias');
  const cfg=resolve(process.env.BENCH_SSH_CONFIG||'work/vps-ssh.conf');
  const local=await mkdtemp(resolve('work/benchmark-bundle-'));
  let remote;
  try {
    await writeFile(join(local,'bench-model.mjs'),model.replaceAll('water_events','lab_bench_events').replaceAll('gardens','lab_bench_gardens'));
    await writeFile(join(local,'scenario.mjs'),scenario);
    await writeFile(join(local,'vps-runner.mjs'),await readFile(join(root,'benchmark/vps-runner.mjs'),'utf8'));
    remote=(await exec('ssh',['-F',cfg,alias,'mktemp -d /tmp/telegram-garden-runner-XXXXXXXX'])).stdout.trim();
    if(!/^\/tmp\/telegram-garden-runner-[A-Za-z0-9]+$/.test(remote)) throw new Error('Unexpected remote directory');
    await exec('scp',['-F',cfg,join(local,'bench-model.mjs'),join(local,'scenario.mjs'),join(local,'vps-runner.mjs'),`${alias}:${remote}/`]);
    let nodeExecutable=process.env.BENCH_NODE_REMOTE||'node';
    if(process.env.BENCH_NODE_LOCAL) {
      await exec('scp',['-F',cfg,resolve(process.env.BENCH_NODE_LOCAL),`${alias}:${remote}/node`]);
      await exec('ssh',['-F',cfg,alias,`chmod 700 ${remote}/node`]);
      nodeExecutable=`${remote}/node`;
    }
    if(!/^[A-Za-z0-9_./-]+$/.test(nodeExecutable)) throw new Error('Unexpected Node path');
    const t=performance.now();
    const response=await exec('ssh',['-F',cfg,alias,`${nodeExecutable} ${remote}/vps-runner.mjs`]);
    const result=JSON.parse(response.stdout);result.sshCommandRoundTripMs=performance.now()-t;
    result.note='Same garden JavaScript and SQL, native Node SQLite adapter, WAL and synchronous FULL. SSH round trip is a management measurement.';
    await writeFile(join(out,`${alias}.json`),JSON.stringify(result,null,2));
    console.log(JSON.stringify({host:alias,cpus:result.metadataBefore.cpus,memoryMiB:result.metadataBefore.totalMemoryMiB,node:result.metadataBefore.node,durationMs:result.durationMs,modes:Object.keys(result.modes)}));
  } finally {
    if(remote && /^\/tmp\/telegram-garden-runner-[A-Za-z0-9]+$/.test(remote)) await exec('ssh',['-F',cfg,alias,`rm -r -- ${remote}`]);
    // Keep the tiny local staging folder for audit; it contains source only.
  }
} else if(mode==='network') {
  const hosts=JSON.parse(await readFile(resolve(process.env.BENCH_NETWORK_CONFIG||'work/benchmark-targets.json'),'utf8'));
  const result={startedAt:new Date().toISOString(),networkContext:'Windows Wi-Fi; active Xray Wintun tunnel; no tunnel settings changed.',
    note:'Fresh TCP+TLS connections from the same Windows PC through its existing tunnel. Includes neither an HTTP request nor any database operation. TCP connect may be acknowledged by the local tunnel and is not remote RTT.',hosts:{}};
  const entries=Object.entries(hosts);
  for(const [name] of entries) result.hosts[name]={samples:[]};
  for(let i=0;i<20;i++) {
    const order=[...entries.slice(i%entries.length),...entries.slice(0,i%entries.length)];
    for(const [name,target] of order) {
      const samples=result.hosts[name].samples;
      if(samples.length>=3 && samples.every(s=>s.error)) continue;
      const t=performance.now();
      samples.push(await new Promise(resolve=>{
        const socket=tls.connect({...target,port:443,rejectUnauthorized:true});
        let tcpMs;
        socket.once('connect',()=>tcpMs=performance.now()-t);
        socket.setTimeout(5000,()=>socket.destroy(new Error('timeout')));
        socket.once('secureConnect',()=>{resolve({tcpMs,tlsMs:performance.now()-t,protocol:socket.getProtocol(),sessionReused:socket.isSessionReused()});socket.destroy();});
        socket.once('error',e=>resolve({tcpMs,error:e.code||e.message}));
      }));
    }
  }
  for(const [name,{samples}] of Object.entries(result.hosts)) console.log(`${name}: ${samples.filter(s=>!s.error).length}/${samples.length} TLS successes`);
  await writeFile(join(out,'network.json'),JSON.stringify(result,null,2));
} else throw new Error('Use cloud, vps fi, vps de, or network');
