export const MINUTE_MS = 60_000;
export const GROWTH_SECONDS = 120;

export function growthAt(state, now) {
  return state.maturedUnits + state.activeTimes.reduce((sum, started) =>
    sum + Math.max(0, Math.min(GROWTH_SECONDS, (now - started) / 1000)), 0);
}

export function stageAt(growth) {
  if (growth < 30) return { name: 'Семечко', level: 0, next: 30 };
  if (growth < 120) return { name: 'Росток', level: 1, next: 120 };
  if (growth < 360) return { name: 'Саженец', level: 2, next: 360 };
  if (growth < 960) return { name: 'Дерево', level: 3, next: 960 };
  return { name: 'Общий сад', level: 4, next: null };
}

export function makeGarden(db, clock = () => Date.now()) {
  async function ensurePlanted(now) {
    await db.run('INSERT INTO gardens (id, planted_at) VALUES (:id, :now) ON CONFLICT(id) DO NOTHING',
      { ':id': 'main', ':now': now });
  }

  async function snapshot(actorId, now = clock()) {
    await ensurePlanted(now);
    const row = await db.get(`SELECT
      (SELECT planted_at FROM gardens WHERE id = 'main') AS plantedAt,
      COUNT(*) AS waters, COUNT(DISTINCT actor_id) AS contributors,
      COALESCE(SUM(CASE WHEN created_at <= :cutoff THEN 120 ELSE 0 END), 0) AS maturedUnits,
      json_group_array(created_at) FILTER (WHERE created_at > :cutoff) AS activeTimes,
      MAX(CASE WHEN actor_id = :actorId THEN slot END) AS lastSlot
      FROM water_events`, { ':cutoff': now - GROWTH_SECONDS * 1000, ':actorId': actorId });
    const activeTimes = JSON.parse(row.activeTimes || '[]');
    const nextWaterAt = row.lastSlot === null ? now : Math.max(now, (row.lastSlot + 1) * MINUTE_MS);
    const state = { plantedAt: row.plantedAt, serverNow: now, waters: row.waters,
      contributors: row.contributors, maturedUnits: row.maturedUnits, activeTimes, nextWaterAt };
    return { ...state, growthUnits: growthAt(state, now) };
  }

  async function water(actorId, eventId) {
    if (!Number.isSafeInteger(actorId) || actorId <= 0) throw new Error('Invalid actor');
    if (typeof eventId !== 'string' || !/^[a-zA-Z0-9:_-]{1,120}$/.test(eventId)) throw new Error('Invalid event');
    const now = clock();
    await ensurePlanted(now);
    // UNIQUE constraints enforce deduplication and the per-user limit in one statement.
    const result = await db.run(`INSERT INTO water_events (event_id, actor_id, slot, created_at)
      VALUES (:eventId, :actorId, :slot, :now) ON CONFLICT DO NOTHING RETURNING event_id`, {
      ':eventId': eventId, ':actorId': actorId, ':slot': Math.floor(now / MINUTE_MS), ':now': now });
    const accepted = result.rowsAffected === 1;
    const previous = accepted ? null : await db.get('SELECT event_id FROM water_events WHERE event_id = :id', { ':id': eventId });
    return { accepted, reason: accepted ? 'watered' : previous ? 'duplicate' : 'cooldown',
      state: await snapshot(actorId, now) };
  }
  return { snapshot, water };
}
