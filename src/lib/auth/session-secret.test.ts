import { SignJWT } from "jose";
import { afterEach, describe, expect, it, vi } from "vitest";
import { signSession, verifySession } from "./session";

const original = { ...process.env };
afterEach(() => {
  process.env = { ...original };
  vi.restoreAllMocks();
});

const forgedWith = (secret: string) =>
  new SignJWT({}).setProtectedHeader({ alg: "HS256" }).setSubject("1").setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(secret));

describe("секрет подписи сессий в рабочей среде", () => {
  it("секрет из образца .env.example не годится: сессию, подписанную им, подделать нельзя", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const env = process.env as Record<string, string | undefined>;
    env.NODE_ENV = "production";
    env.SESSION_SECRET = "change-me-to-a-long-random-string";
    const mine = await signSession(7);
    expect(await verifySession(mine)).toBe(7); // свои сессии работают в этом процессе
    expect(await verifySession(await forgedWith("change-me-to-a-long-random-string"))).toBeNull(); // подделка по известному образцу не проходит
  });

  it("слишком короткий секрет тоже не используется, а нормальный длинный используется", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const env = process.env as Record<string, string | undefined>;
    env.NODE_ENV = "production";
    env.SESSION_SECRET = "short";
    expect(await verifySession(await forgedWith("short"))).toBeNull();
    const good = "x7Kq9vLm2RtYp4Nw8ZaB5cDfG1hJ3sUe6";
    env.SESSION_SECRET = good;
    expect(await verifySession(await forgedWith(good))).toBe(1);
  });
});
