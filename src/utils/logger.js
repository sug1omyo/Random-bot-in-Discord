function timestamp() {
  const date = new Date();
  const pad = (value) => String(value).padStart(2, '0');

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} `
    + `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function write(level, message) {
  console.log(`[${timestamp()}] [${level}] ${message}`);
}

export function isMusicDebugEnabled() {
  return process.env.MUSIC_DEBUG?.trim().toLowerCase() === 'true';
}

export function logMusicError(context, error) {
  const message = error instanceof Error ? error.message : String(error);
  const stack = isMusicDebugEnabled() && error instanceof Error && error.stack
    ? `\n${error.stack}`
    : '';
  write('ERROR', `[Music ERROR] ${context}: ${message}${stack}`);
}

export const logger = {
  info(message) {
    write('INFO', message);
  },
  warn(message) {
    write('WARN', message);
  },
  error(message) {
    write('ERROR', message);
  },
};
