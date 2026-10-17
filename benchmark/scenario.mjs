export const SAMPLE_COUNT = 50;
export const WARMUP_COUNT = 5;
export const SEED_COUNT = 1000;

export async function runScenario(garden, mode, now = () => Date.now()) {
  const actor = 80000000000100;
  const samplesMs = [];
  const warmupSamplesMs = [];
  let accepted = 0;
  const run = async (index, warmup) => {
    const started = now();
    let result;
    if (mode === 'read') result = await garden.snapshot(actor);
    else if (mode === 'water') result = await garden.water(actor + index, `measure:${warmup ? 'warm' : 'sample'}:${index}`);
    else if (mode === 'replay') result = await garden.water(actor + 49, 'measure:sample:49');
    else throw new Error('Unknown benchmark mode');
    const elapsed = now() - started;
    if (!warmup) { samplesMs.push(elapsed); if (result.accepted) accepted++; }
    else warmupSamplesMs.push(elapsed);
    return result;
  };
  // Different synthetic actors for warmups and measured writes.
  for (let i = 0; i < WARMUP_COUNT; i++) await run(i + 1000, true);
  for (let i = 0; i < SAMPLE_COUNT; i++) await run(i, false);
  return {mode, samplesMs, warmupSamplesMs, accepted, final: await garden.snapshot(actor)};
}

export function fixtureSql(gardens, events, index) {
  for (const name of [gardens,events,index]) if (!/^lab_bench_[a-z0-9_]+$/.test(name)) throw new Error('Unsafe fixture name');
  return [
    `CREATE TABLE ${gardens} (id TEXT PRIMARY KEY, planted_at INTEGER NOT NULL)`,
    `CREATE TABLE ${events} (event_id TEXT PRIMARY KEY, actor_id INTEGER NOT NULL, slot INTEGER NOT NULL, created_at INTEGER NOT NULL)`,
    `CREATE UNIQUE INDEX ${index} ON ${events}(actor_id,slot)`,
    `WITH RECURSIVE n(i) AS (VALUES(1) UNION ALL SELECT i+1 FROM n WHERE i<${SEED_COUNT})
      INSERT INTO ${events}(event_id,actor_id,slot,created_at)
      SELECT 'seed:'||i,80000000000000+i,-1,1 FROM n`
  ];
}
