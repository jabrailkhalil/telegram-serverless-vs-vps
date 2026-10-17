import { table, integer, text, uniqueIndex } from 'sdk/db';

export const gardens = table('gardens', {
  id: text('id').primaryKey(),
  plantedAt: integer('planted_at').notNull(),
});

export const waterEvents = table('water_events', {
  eventId: text('event_id').primaryKey(),
  actorId: integer('actor_id').notNull(),
  slot: integer('slot').notNull(),
  createdAt: integer('created_at').notNull(),
}, t => ({ onePerMinute: uniqueIndex('water_actor_slot').on(t.actorId, t.slot) }));
