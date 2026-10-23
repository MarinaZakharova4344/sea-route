import { applySchema, openDb } from "./";

const db = openDb();
applySchema(db);
console.log("Схема базы данных применена.");
db.close();
