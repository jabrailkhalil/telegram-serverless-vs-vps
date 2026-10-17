import { DatabaseSync } from 'node:sqlite';

export function connect(filename = ':memory:', initialize = true) {
  const raw = new DatabaseSync(filename);
  raw.exec('PRAGMA busy_timeout = 10000');
  if (initialize) raw.exec(`PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS gardens (id TEXT PRIMARY KEY, planted_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS water_events (event_id TEXT PRIMARY KEY, actor_id INTEGER NOT NULL,
      slot INTEGER NOT NULL, created_at INTEGER NOT NULL);
    CREATE UNIQUE INDEX IF NOT EXISTS water_actor_slot ON water_events(actor_id, slot);`);
  return { raw, close: () => raw.close(),
    async get(query, params = {}) { return raw.prepare(query).get(params) || null; },
    async run(query, params = {}) {
      const statement = raw.prepare(query);
      if (/\bRETURNING\b/i.test(query)) {
        const rows = statement.all(params);
        return { rowsAffected: rows.length, rows };
      }
      const result = statement.run(params);
      return { rowsAffected: result.changes, lastInsertRowid: result.lastInsertRowid, rows: [] };
    },
  };
}
