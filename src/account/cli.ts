import type { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../db.js';
import { adminCommand } from './command.js';

const opened: DatabaseSync[] = [];
try {
  process.exitCode = await adminCommand(process.argv.slice(2), {
    openDatabase: (path) => {
      const db = openDatabase(path);
      opened.push(db);
      return db;
    },
    now: () => new Date(),
    log: (line) => console.log(line),
    error: (line) => console.error(line),
  });
} finally {
  for (const db of opened) db.close();
}
