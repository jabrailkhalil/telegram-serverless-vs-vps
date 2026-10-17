import { db } from 'sdk';
import { makeGarden } from './model.js';
export const garden = makeGarden(db);
