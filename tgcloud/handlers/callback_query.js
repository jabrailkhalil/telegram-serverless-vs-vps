import { api } from 'sdk';
import { garden } from '../lib/service.js';
import { sendGarden } from '../lib/reply.js';
export default async function (query) {
  if (!query.message || !query.from || query.from.is_bot) return;
  if (query.data === 'water:v1') {
    const result = await garden.water(query.from.id, `cb:${query.id}`);
    await api.answerCallbackQuery({ callback_query_id: query.id,
      text: result.accepted ? 'Капля принята 💧' : 'Полить снова можно через минуту.' });
    if (result.reason !== 'duplicate') await sendGarden(query.message.chat.id, result.state);
  } else if (query.data === 'garden:v1') {
    await api.answerCallbackQuery({ callback_query_id: query.id });
    await sendGarden(query.message.chat.id, await garden.snapshot(query.from.id));
  }
}
