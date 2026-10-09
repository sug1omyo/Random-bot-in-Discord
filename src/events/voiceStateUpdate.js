import { Events } from 'discord.js';
import { handleVoiceStateUpdate } from '../voice/tempRoomManager.js';

export const name = Events.VoiceStateUpdate;

export async function execute(oldState, newState) {
  await handleVoiceStateUpdate(oldState, newState);
}
