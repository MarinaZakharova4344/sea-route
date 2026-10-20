import { applySchema, openDb } from "./index";

const db = openDb();
applySchema(db);
console.log("Схема базы данных применена.");
db.close();
