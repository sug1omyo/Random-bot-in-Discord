import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { logger } from '../utils/logger.js';

const eventsDirectory = fileURLToPath(new URL('../events/', import.meta.url));

export async function loadEvents(client) {
  const files = (await readdir(eventsDirectory))
    .filter((file) => file.endsWith('.js'))
    .sort();

  for (const file of files) {
    try {
      const event = await import(pathToFileURL(join(eventsDirectory, file)).href);

      if (typeof event.name !== 'string' || typeof event.execute !== 'function') {
        logger.warn(`Skipping ${file}: event must export name and execute`);
        continue;
      }

      const handler = (...args) => {
        Promise.resolve(event.execute(...args, client)).catch((error) => {
          logger.error(`Event ${event.name} failed: ${error.message}`);
        });
      };

      if (event.once) {
        client.once(event.name, handler);
      } else {
        client.on(event.name, handler);
      }
    } catch (error) {
      logger.warn(`Skipping ${file}: ${error.message}`);
    }
  }
}
