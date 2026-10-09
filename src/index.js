import 'dotenv/config';
import { Client, Collection, GatewayIntentBits } from 'discord.js';
import { loadCommands } from './loaders/commandLoader.js';
import { loadEvents } from './loaders/eventLoader.js';
import { logger } from './utils/logger.js';
import { initializePlayer } from './music/player.js';
import { shutdownVoiceConnections } from './voice/voiceManager.js';

process.on('unhandledRejection', (reason) => {
  const error = reason instanceof Error ? reason : new Error(String(reason));
  logger.error(`[Process] Unhandled rejection: ${error.message}${process.env.MUSIC_DEBUG?.trim().toLowerCase() === 'true' && error.stack ? `\n${error.stack}` : ''}`);
});

process.on('uncaughtException', (error) => {
  logger.error(`[Process] Uncaught exception: ${error.message}${process.env.MUSIC_DEBUG?.trim().toLowerCase() === 'true' && error.stack ? `\n${error.stack}` : ''}`);
  process.exit(1);
});

process.on('warning', (warning) => {
  logger.warn(`[Process] Warning: ${warning.message}${process.env.MUSIC_DEBUG?.trim().toLowerCase() === 'true' && warning.stack ? `\n${warning.stack}` : ''}`);
});

const token = process.env.DISCORD_TOKEN;

if (!token?.trim()) {
  logger.error('[CONFIG ERROR] Missing DISCORD_TOKEN');
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});

client.commands = new Collection();
logger.info('Bot starting');

await loadCommands(client.commands);
await loadEvents(client);
await initializePlayer(client);

try {
  await client.login(token);
} catch (error) {
  logger.error(`[Discord] Login failed: ${error.message}`);
  client.destroy();
  process.exitCode = 1;
}

let shutdownStarted = false;
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    if (shutdownStarted) {
      return;
    }

    shutdownStarted = true;
    logger.info(`[Process] ${signal} received; shutting down`);
    shutdownVoiceConnections();
    client.destroy();
    process.exitCode = 0;
  });
}
