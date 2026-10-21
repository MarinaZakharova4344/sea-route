/**
 * Команды управления пользователями (запускать на сервере, где лежит база):
 *   npm run users -- list
 *   npm run users -- add имя@компания.ru "Имя Фамилия" manager [пароль]
 *   npm run users -- password имя@компания.ru [новый пароль]
 *   npm run users -- disable имя@компания.ru     (ушёл из компании: вход закрыт, открытые сессии перестают работать)
 *   npm run users -- enable имя@компания.ru
 * Если пароль не указан, создаётся случайный и показывается один раз.
 */
import { openDb, applySchema } from "./index";
import { UserError, addUser, listUsers, setDisabled, setPassword } from "../lib/auth/users";

const [cmd, ...args] = process.argv.slice(2);
const db = openDb();
applySchema(db);

function usage(): never {
  console.log(["Команды:", "  list", "  add <email> <имя> <manager|director> [пароль]", "  password <email> [новый пароль]", "  disable <email>", "  enable <email>"].join("\n"));
  process.exit(1);
}

try {
  switch (cmd) {
    case "list":
      for (const u of listUsers(db)) console.log(`${String(u.id).padStart(3)}  ${u.role.padEnd(8)} ${u.email.padEnd(32)} ${u.name}${u.disabled ? "  [отключён]" : ""}`);
      break;
    case "add": {
      const [email, name, role, password] = args;
      if (!email || !name || !role) usage();
      const r = addUser(db, { email, name, role, password });
      console.log(`Пользователь создан: ${email} (${role}).${password ? "" : ` Пароль (показан один раз): ${r.password}`}`);
      break;
    }
    case "password": {
      if (!args[0]) usage();
      const pw = setPassword(db, args[0], args[1]);
      console.log(`Пароль для ${args[0]} изменён.${args[1] ? "" : ` Новый пароль (показан один раз): ${pw}`}`);
      break;
    }
    case "disable":
    case "enable":
      if (!args[0]) usage();
      setDisabled(db, args[0], cmd === "disable");
      console.log(cmd === "disable" ? `Вход закрыт: ${args[0]}` : `Вход открыт: ${args[0]}`);
      break;
    default:
      usage();
  }
} catch (e) {
  if (e instanceof UserError) {
    console.error("Ошибка: " + e.message);
    process.exit(1);
  }
  throw e;
}
