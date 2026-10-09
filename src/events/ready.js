import { Events } from 'discord.js';
import { logger } from '../utils/logger.js';
import { autoJoin } from '../voice/autoJoin.js';
import { initializeTempRooms } from '../voice/tempRoomManager.js';

export const name = Events.ClientReady;
export const once = true;

export async function execute(readyClient) {
  console.log('====================================');
  console.log('OI CAI DISSCORD BOT');
  console.log('====================================');
  logger.info(`[Discord] Logged in as ${readyClient.user.tag}`);
  logger.info(`[Discord] Bot ID: ${readyClient.user.id}`);
  logger.info('Bot is ready.');
  await initializeTempRooms(readyClient);
  await autoJoin(readyClient);
}
