import fs from "node:fs";
import { DEFAULT_DB_PATH } from "./";

const file = process.env.DATABASE_PATH ?? DEFAULT_DB_PATH;
for (const f of [file, `${file}-wal`, `${file}-shm`]) fs.rmSync(f, { force: true });
console.log(`База данных удалена: ${file}`);
