import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { logger } from '../utils/logger.js';

const commandsDirectory = fileURLToPath(new URL('../commands/', import.meta.url));

export async function loadCommands(commands) {
  const files = (await readdir(commandsDirectory))
    .filter((file) => file.endsWith('.js'))
    .sort();

  for (const file of files) {
    try {
      const command = await import(pathToFileURL(join(commandsDirectory, file)).href);
      const { data, execute } = command;

      if (!data?.name || typeof data.toJSON !== 'function' || typeof execute !== 'function') {
        logger.warn(`Skipping ${file}: command must export data and execute`);
        continue;
      }

      if (commands.has(data.name)) {
        logger.warn(`Skipping ${file}: duplicate command name "${data.name}"`);
        continue;
      }

      commands.set(data.name, { data, execute });
    } catch (error) {
      logger.warn(`Skipping ${file}: ${error.message}`);
    }
  }

  logger.info(`[Commands] Loaded: ${commands.size}`);
  return commands;
}
