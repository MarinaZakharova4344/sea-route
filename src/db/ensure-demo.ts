/**
 * Подготовка базы при запуске для показа (GitHub Codespaces, хостинг без постоянного диска): если база пустая
 * или задан режим always, загружаются демонстрационные данные. Без этого шага приложение запускалось бы без пользователей.
 *
 *   DEMO_RESEED=always  при каждом запуске загрузить данные заново (даты всегда свежие, правки пропадают)
 *   DEMO_RESEED=empty   загружать только в пустую базу (по умолчанию; для хостинга с постоянным диском)
 *   DEMO_SET=small      обычный набор из 58 перевозок; по умолчанию крупный (около 960) для графиков
 *   DEMO_PASSWORD       пароль демо-пользователей (по умолчанию demo12345)
 */
import { applySchema, openDb } from "./";
import { seed } from "./seed";
import { addLargeDemo } from "./seed-large";
import { recalcAll } from "../lib/calc/recalc";

const always = process.env.DEMO_RESEED === "always";
const large = process.env.DEMO_SET !== "small";

const db = openDb();
applySchema(db);
const users = (db.prepare("SELECT COUNT(*) n FROM users").get() as { n: number }).n;

if (always || users === 0) {
  seed(db);
  if (large) addLargeDemo(db);
  recalcAll(db);
  const n = (db.prepare("SELECT COUNT(*) n FROM shipments").get() as { n: number }).n;
  console.log(`Демонстрационные данные загружены: перевозок ${n}.`);
} else {
  console.log("База уже заполнена, демонстрационные данные не трогаем.");
}
db.close();
