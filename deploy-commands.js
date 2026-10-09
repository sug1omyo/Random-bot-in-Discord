import 'dotenv/config';
import { REST, Routes } from 'discord.js';
import { loadCommands } from './src/loaders/commandLoader.js';
import { logger } from './src/utils/logger.js';

const requiredVariables = ['DISCORD_TOKEN', 'CLIENT_ID', 'GUILD_ID'];
const missingVariable = requiredVariables.find((name) => !process.env[name]?.trim());

if (missingVariable) {
  logger.error(`[CONFIG ERROR] Missing ${missingVariable}`);
  process.exit(1);
}

const commands = await loadCommands(new Map());
const payload = [...commands.values()].map(({ data }) => data.toJSON());
const commandWord = payload.length === 1 ? 'command' : 'commands';
const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

try {
  logger.info(`[Commands] Deploying ${payload.length} guild ${commandWord}...`);
  await rest.put(
    Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
    { body: payload },
  );
  logger.info(`[Commands] Successfully deployed ${payload.length} ${commandWord}.`);
} catch (error) {
  logger.error(`Failed to deploy guild commands: ${error.message}`);
  process.exitCode = 1;
}
