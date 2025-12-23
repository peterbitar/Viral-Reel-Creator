import Database from "better-sqlite3";
import path from "path";

const dbPath = path.join(process.cwd(), "data", "app.db");

export const db = new Database(dbPath);

export function exec(sql: string): void {
  db.exec(sql);
}


