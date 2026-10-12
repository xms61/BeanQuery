import { readFileSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../db.js';
import { roasterImportCommand } from './command.js';

const opened: DatabaseSync[] = [];
try {
  process.exitCode = await roasterImportCommand(process.argv.slice(2), {
    openDatabase: (path) => {
      const db = openDatabase(path);
      opened.push(db);
      return db;
    },
    readFile: (path) => readFileSync(path, 'utf8'),
    fetchFn: fetch,
    log: (line) => console.log(line),
    error: (line) => console.error(line),
  });
} finally {
  for (const db of opened) db.close();
}
