type Level = 'info' | 'warn' | 'error';

function write(level: Level, message: string, meta?: unknown) {
  const line = {
    time: new Date().toISOString(),
    level,
    message,
    ...(meta ? { meta } : {}),
  };
  const out = JSON.stringify(line);
  if (level === 'error') console.error(out);
  else if (level === 'warn') console.warn(out);
  else console.log(out);
}

export const log = {
  info: (m: string, meta?: unknown) => write('info', m, meta),
  warn: (m: string, meta?: unknown) => write('warn', m, meta),
  error: (m: string, meta?: unknown) => write('error', m, meta),
};
