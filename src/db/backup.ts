/**
 * Резервная копия базы данных. Делается штатным механизмом SQLite, поэтому копия согласованная, даже если приложение в это
 * время работает и в базу пишут.
 *
 *   npm run db:backup                 копия в папку backups/ (имя с датой и временем), хранятся последние 14
 *   npm run db:backup -- --keep 30    хранить последние 30
 *
 * Запускать по расписанию (например, раз в сутки через планировщик задач или cron). Восстановление: остановить приложение,
 * заменить файл базы (data/sea-route.db) нужной копией и запустить снова.
 */
import fs from "node:fs";
import path from "node:path";
import { openDb, DEFAULT_DB_PATH } from "./index";

const PREFIX = "sea-route-";

export async function backupDatabase(options: { dir?: string; keep?: number; source?: string; now?: Date } = {}): Promise<{ file: string; removed: string[] }> {
  const dir = options.dir ?? path.join(process.cwd(), "backups");
  const keep = options.keep ?? 14;
  const now = options.now ?? new Date();
  fs.mkdirSync(dir, { recursive: true });

  const stamp = now.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  const file = path.join(dir, `${PREFIX}${stamp}.db`);
  const db = openDb(options.source ?? process.env.DATABASE_PATH ?? DEFAULT_DB_PATH);
  try {
    await db.backup(file);
  } finally {
    db.close();
  }

  // Старые копии удаляются, чтобы диск не заполнялся; самая новая всегда остаётся.
  const all = fs
    .readdirSync(dir)
    .filter((f) => f.startsWith(PREFIX) && f.endsWith(".db"))
    .sort();
  const removed = all.slice(0, Math.max(0, all.length - Math.max(1, keep)));
  for (const f of removed) fs.rmSync(path.join(dir, f), { force: true });
  return { file, removed: removed.map((f) => path.join(dir, f)) };
}

// Запуск из командной строки
if (process.argv[1] && /backup\.(ts|js)$/.test(process.argv[1])) {
  const i = process.argv.indexOf("--keep");
  const keep = i > -1 ? Number(process.argv[i + 1]) : undefined;
  if (keep !== undefined && (!Number.isInteger(keep) || keep < 1)) {
    console.error("Ошибка: --keep должно быть целым числом не меньше 1");
    process.exit(1);
  }
  backupDatabase({ keep }).then(
    (r) => {
      console.log(`Резервная копия создана: ${r.file}`);
      if (r.removed.length) console.log(`Удалены старые копии: ${r.removed.length}`);
    },
    (e) => {
      console.error("Не удалось сделать копию:", e instanceof Error ? e.message : e);
      process.exit(1);
    },
  );
}
