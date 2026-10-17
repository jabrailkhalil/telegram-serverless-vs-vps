import {readFile,writeFile,mkdtemp} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
export function execute(command,args){return new Promise((res,rej)=>{const p=spawn(command,args,{windowsHide:true});let out='',err='';p.stdout.on('data',d=>out+=d);p.stderr.on('data',d=>err+=d);p.on('error',rej);p.on('close',code=>code===0?res(out):rej(new Error(`${command} (${code}): ${err.slice(-500)}`)));});}
export async function createVps({alias,workspace,directory,mapped,optimized,common,suffix}){
  const work=resolve(process.env.BENCH_WORK_DIR||join(workspace,'work'));
  const cfg=resolve(process.env.BENCH_SSH_CONFIG||join(work,'vps-ssh.conf'));
  const remote=(await execute('ssh',['-F',cfg,alias,'mktemp -d /var/tmp/telegram-garden-disk-XXXXXXXX'])).trim();
  if(!/^\/var\/tmp\/telegram-garden-disk-[A-Za-z0-9]+$/.test(remote))throw new Error('Unexpected persistent temporary path');
  let child;
  const cleanup=async()=>{if(child){child.stdin.end();await new Promise(r=>child.exitCode!==null?r():child.once('close',r));}await execute('ssh',['-F',cfg,alias,`rm -r -- ${remote}`]);return {cleaned:true};};
  try{
    const stage=await mkdtemp(join(work,'ext-disk-bundle-'));
    const files={'ext-model.mjs':mapped,'ext-model-optimized.mjs':optimized,'common.mjs':common,'vps-runner.mjs':await readFile(join(directory,'vps-runner.mjs'),'utf8')};
    for(const [name,body]of Object.entries(files))await writeFile(join(stage,name),body);
    await execute('scp',['-q','-F',cfg,...Object.keys(files).map(f=>join(stage,f)),`${alias}:${remote}/`]);
    await execute('scp',['-q','-F',cfg,resolve(process.env.BENCH_NODE_LOCAL||join(work,'benchmark-node-linux')),`${alias}:${remote}/node`]);
    await execute('ssh',['-F',cfg,alias,`chmod 700 ${remote}/node`]);
    const filesystem=JSON.parse(await execute('ssh',['-F',cfg,alias,`findmnt -J -T ${remote} -o TARGET,SOURCE,FSTYPE`]));
    if(filesystem.filesystems[0].fstype==='tmpfs')throw new Error('Disk control must not use tmpfs');
    child=spawn('ssh',['-F',cfg,alias,`${remote}/node ${remote}/vps-runner.mjs ${suffix}`],{windowsHide:true});let next=0;const pending=new Map();let stderr='';
    child.stderr.on('data',d=>stderr+=d);
    createInterface({input:child.stdout}).on('line',line=>{const r=JSON.parse(line),job=pending.get(r.id);if(!job)return;pending.delete(r.id);r.error?job.reject(new Error(r.error)):job.resolve({...r.result,runtimeReportedMs:r.runtimeReportedMs});});
    child.on('close',code=>{for(const p of pending.values())p.reject(new Error('Runner closed '+code+': '+stderr.slice(-200)));pending.clear();});
    const call=input=>new Promise((resolve,reject)=>{const id=++next;pending.set(id,{resolve,reject});child.stdin.write(JSON.stringify({id,input})+'\n');});
    return {call,cleanup,filesystem};
  }catch(error){await cleanup();throw error;}
}
