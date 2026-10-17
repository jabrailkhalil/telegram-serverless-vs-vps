export const MODES = ['select1','indexedRead','increment','write32Separate','write32Batch'];
export function namesFor(suffix) {
  if (!/^[a-z0-9_]+$/.test(suffix)) throw new Error('Invalid suffix');
  return {gardens:`lab_ext_gardens_${suffix}`,events:`lab_ext_events_${suffix}`,index:`lab_ext_actor_${suffix}`,kv:`lab_ext_kv_${suffix}`};
}
export function checkNames(names) {
  for (const name of Object.values(names)) if (!/^lab_ext_[a-z0-9_]+$/.test(name)) throw new Error('Unsafe fixture name');
}
export async function setup(db,names) {
  checkNames(names);
  await db.run(`CREATE TABLE ${names.gardens}(id TEXT PRIMARY KEY,planted_at INTEGER NOT NULL)`);
  await db.run(`INSERT INTO ${names.gardens} VALUES('main',1)`);
  await db.run(`CREATE TABLE ${names.events}(event_id TEXT PRIMARY KEY,actor_id INTEGER NOT NULL,slot INTEGER NOT NULL,created_at INTEGER NOT NULL)`);
  await db.run(`CREATE UNIQUE INDEX ${names.index} ON ${names.events}(actor_id,slot)`);
  await db.run(`CREATE TABLE ${names.kv}(id INTEGER PRIMARY KEY,value INTEGER NOT NULL,payload TEXT NOT NULL DEFAULT '')`);
  await db.run(`WITH RECURSIVE n(i) AS(VALUES(0) UNION ALL SELECT i+1 FROM n WHERE i<999) INSERT INTO ${names.kv}(id,value,payload) SELECT i,i,'fixture' FROM n`);
  return {ready:true};
}
export async function seed(db,names,size) {
  checkNames(names);
  if (![1000,10000,100000].includes(size)) throw new Error('Unexpected seed size');
  for(;;){const removed=await db.run(`DELETE FROM ${names.events} WHERE event_id IN (SELECT event_id FROM ${names.events} LIMIT 1000)`);if(removed.rowsAffected<1000)break;}
  for(let start=1;start<=size;start+=1000){const end=Math.min(size,start+999);const result=await db.run(`WITH RECURSIVE n(i) AS(VALUES(${start}) UNION ALL SELECT i+1 FROM n WHERE i<${end}) INSERT INTO ${names.events}(event_id,actor_id,slot,created_at) SELECT 'seed:'||i,80000000000000+i,-1,1 FROM n`);if(result.rowsAffected!==end-start+1)throw new Error('Incomplete seed batch');}
  const row=await db.get(`SELECT COUNT(*) AS count FROM ${names.events}`);
  if (row.count!==size) throw new Error('Fixture size mismatch');
  return {rows:row.count};
}
export async function cleanup(db,names) {
  checkNames(names);
  for (const key of ['events','gardens','kv']) await db.run(`DROP TABLE IF EXISTS ${names[key]}`);
  const left=await db.all(`SELECT name FROM sqlite_master WHERE name IN ('${names.events}','${names.gardens}','${names.kv}','${names.index}')`);
  return {cleaned:left.length===0};
}
export function cpuWork() {
  let n=2166136261;
  for(let i=0;i<2000000;i++)n=Math.imul(n^i,16777619)>>>0;
  return n;
}
let jsonFixture;
function jsonInput(){return jsonFixture??=JSON.stringify(Array.from({length:4096},(_,i)=>({id:i,label:'x'.repeat(96),value:i%31})));}
export async function perform(context,mode,input,index) {
  const {db,names,garden,optimizedGarden,httpGet}=context;
  if(mode==='noop')return 42;
  if(mode==='select1')return (await db.get('SELECT 1 AS value')).value;
  if(mode==='indexedRead')return (await db.get(`SELECT value FROM ${names.kv} WHERE id=:id`,{':id':123})).value;
  if(mode==='increment')return (await db.run(`UPDATE ${names.kv} SET value=value+1 WHERE id=0`)).rowsAffected;
  if(mode==='cpu')return cpuWork();
  if(mode==='json') {
    let checksum=0;
    for(let j=0;j<10;j++){const rows=JSON.parse(jsonInput());checksum+=JSON.parse(JSON.stringify(rows))[4095].id;}
    return checksum;
  }
  if(mode==='write32Separate'||mode==='write32Batch') {
    const first=input.idBase+index*32;
    if(!Number.isSafeInteger(first)||first<10000)throw new Error('Invalid batch ID');
    if(mode==='write32Separate') {
      let count=0;for(let j=0;j<32;j++)count+=(await db.run(`INSERT INTO ${names.kv}(id,value) VALUES(:id,1)`,{':id':first+j})).rowsAffected;
      return count;
    }
    const params={};const values=[];
    for(let j=0;j<32;j++){params[':p'+j]=first+j;values.push('(:p'+j+',1)');}
    return (await db.run(`INSERT INTO ${names.kv}(id,value) VALUES ${values.join(',')}`,params)).rowsAffected;
  }
  if(mode==='gardenRead'||mode==='gardenReadNoEnsure') {
    const value=await (mode==='gardenRead'?garden:optimizedGarden).snapshot(90000000000000);
    return {waters:value.waters,growthUnits:value.growthUnits};
  }
  if(mode==='gardenWater') {
    const actor=input.actorBase+index;
    const value=await garden.water(actor,'ext:'+actor);
    return {accepted:value.accepted,waters:value.state.waters};
  }
  if(mode==='sameEvent') {
    const value=await garden.water(input.actorBase,input.event);
    return {accepted:value.accepted,reason:value.reason};
  }
  if(mode==='outbound')return httpGet(input.url);
  throw new Error('Unknown mode '+mode);
}
export async function measure(context,input) {
  if(input.mode==='json')jsonFixture=undefined;
  const count=input.count??1,warmup=input.warmup??0;
  if(!Number.isInteger(count)||count<1||count>50||!Number.isInteger(warmup)||warmup<0||warmup>5)throw new Error('Invalid count');
  const samples=[],warmups=[],outcomes=[];let last;let consecutiveErrors=0;
  for(let i=-warmup;i<count;i++){
    const t=context.now();last=await perform(context,input.mode,input,i+warmup);
    (i<0?warmups:samples).push(context.now()-t);
    if(input.mode==='outbound'&&i>=0){outcomes.push(last);consecutiveErrors=last.error?consecutiveErrors+1:0;if(consecutiveErrors>=3)break;}
  }
  return {mode:input.mode,samplesMs:samples,warmupMs:warmups,last,jsonBytes:input.mode==='json'?jsonInput().length:undefined,outcomes:input.mode==='outbound'?outcomes:undefined};
}
