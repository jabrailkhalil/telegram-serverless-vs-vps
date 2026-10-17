import { api } from 'sdk';
import { stageAt } from './model.js';
import { MINI_APP_URL } from './config.js';
export async function sendGarden(chatId, state, prefix = '') {
  const stage = stageAt(state.growthUnits);
  const keyboard = [[{ text: '💧 Полить', callback_data: 'water:v1' },
    { text: '🌿 Посмотреть', callback_data: 'garden:v1' }]];
  if (MINI_APP_URL && chatId > 0) keyboard.push([{ text: 'Открыть сад', web_app: { url: MINI_APP_URL } }]);
  await api.sendMessage({ chat_id: chatId,
    text: `${prefix ? prefix + '\n\n' : ''}🌱 Сад без сервера\n\n${stage.name} · ${Math.floor(state.growthUnits)} единиц роста\nПоливов: ${state.waters} · Садовников: ${state.contributors}\n\nКаждый полив даёт две минуты роста. Поливать можно раз в минуту.\n/water — полить\n/garden — посмотреть`,
    reply_markup: { inline_keyboard: keyboard } });
}
