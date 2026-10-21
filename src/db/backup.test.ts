import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { backupDatabase } from "./backup";

describe("резервная копия базы", () => {
  it("копия содержит те же данные, старые копии удаляются, самая новая остаётся", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sr-backup-"));
    const source = path.join(dir, "live.db");
    const live = new Database(source);
    live.pragma("journal_mode = WAL");
    live.exec("CREATE TABLE t (n INTEGER); INSERT INTO t VALUES (1), (2), (3);");
    // база «в работе»: подключение открыто и в неё продолжают писать
    const backups = path.join(dir, "backups");
    let last = "";
    for (let i = 0; i < 4; i++) {
      live.exec("INSERT INTO t VALUES (100)");
      const r = await backupDatabase({ dir: backups, keep: 2, source, now: new Date(Date.UTC(2026, 9, 21, 10, i, 0)) });
      last = r.file;
    }
    expect(fs.readdirSync(backups).length).toBe(2);
    const copy = new Database(last, { readonly: true });
    expect((copy.prepare("SELECT COUNT(*) n FROM t").get() as { n: number }).n).toBe(7); // 3 исходных + 4 вставки
    copy.close();
    live.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
