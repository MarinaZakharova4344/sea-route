import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { beforeEach, describe, expect, it } from "vitest";

/**
 * Проверка service worker без браузера: файл public/sw.js запускается в изолированной среде
 * с подставными caches и fetch, затем проверяются сценарии «есть связь» и «связи нет».
 */

const ORIGIN = "http://app.test";
const SOURCE = fs.readFileSync(path.join(process.cwd(), "public", "sw.js"), "utf8");

type Handler = (event: unknown) => void;

function makeWorker() {
  const listeners: Record<string, Handler[]> = {};
  const stores = new Map<string, Map<string, Response>>();
  const calls: string[] = [];
  let online = true;
  let respond: (url: string) => Response = () => new Response("page", { status: 200 });

  const caches = {
    async open(name: string) {
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name)!;
      return {
        async put(req: Request | string, res: Response) {
          store.set(typeof req === "string" ? new URL(req, ORIGIN).href : req.url, res);
        },
        async addAll(urls: string[]) {
          for (const u of urls) store.set(new URL(u, ORIGIN).href, await mockFetch(new Request(new URL(u, ORIGIN).href)));
        },
      };
    },
    async match(req: Request | string, opts?: { cacheName?: string }) {
      const key = typeof req === "string" ? new URL(req, ORIGIN).href : req.url;
      const names = opts?.cacheName ? [opts.cacheName] : [...stores.keys()];
      for (const n of names) {
        const hit = stores.get(n)?.get(key);
        if (hit) return hit.clone();
      }
      return undefined;
    },
    async keys() {
      return [...stores.keys()];
    },
    async delete(name: string) {
      return stores.delete(name);
    },
  };

  async function mockFetch(req: Request): Promise<Response> {
    calls.push(req.url);
    if (!online) throw new TypeError("Failed to fetch");
    return respond(req.url);
  }

  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, fn: Handler) => (listeners[type] = [...(listeners[type] ?? []), fn]),
    skipWaiting: async () => undefined,
    clients: { claim: async () => undefined },
  };

  vm.runInNewContext(SOURCE, { self, caches, fetch: mockFetch, URL, Response, Request, Promise, setTimeout, clearTimeout, Error, Object, Array, Headers, TypeError });

  async function dispatch(type: string, event: Record<string, unknown>) {
    const waits: Promise<unknown>[] = [];
    let responded: Promise<Response> | undefined;
    const e = { ...event, waitUntil: (p: Promise<unknown>) => waits.push(p), respondWith: (p: Promise<Response>) => (responded = p) };
    for (const fn of listeners[type] ?? []) fn(e);
    await Promise.all(waits);
    return responded;
  }

  return {
    stores,
    calls,
    setOnline: (v: boolean) => (online = v),
    setResponder: (fn: (url: string) => Response) => (respond = fn),
    install: () => dispatch("install", {}),
    activate: () => dispatch("activate", {}),
    message: (data: unknown) => dispatch("message", { data }),
    /** Возвращает ответ воркера или undefined, если он запрос не перехватил. */
    fetch: async (url: string, init: RequestInit & { navigate?: boolean } = {}) => {
      const { navigate, ...rest } = init;
      const request = new Request(url.startsWith("http") ? url : `${ORIGIN}${url}`, rest);
      Object.defineProperty(request, "mode", { value: navigate ? "navigate" : "cors" });
      const p = await dispatch("fetch", { request });
      return p;
    },
  };
}

let sw: ReturnType<typeof makeWorker>;

beforeEach(async () => {
  sw = makeWorker();
  sw.setResponder((url) => (url.endsWith("/offline") ? new Response("OFFLINE PAGE") : new Response(`data for ${url}`)));
  await sw.install();
  await sw.activate();
});

describe("service worker", () => {
  it("при установке сохраняет страницу «Нет связи» и иконки", () => {
    const urls = [...sw.stores.get("sr-static-v1")!.keys()];
    expect(urls).toContain(`${ORIGIN}/offline`);
    expect(urls).toContain(`${ORIGIN}/icons/icon-192.png`);
  });

  it("есть связь: страница руководителя берётся из сети и сохраняется", async () => {
    const res = await sw.fetch("/director", { navigate: true });
    expect(await res!.text()).toBe(`data for ${ORIGIN}/director`);
    expect(sw.stores.get("sr-pages-v1")!.has(`${ORIGIN}/director`)).toBe(true);
  });

  it("связи нет: показывается последняя сохранённая копия, а не ошибка", async () => {
    await sw.fetch("/director/profit?days=90", { navigate: true });
    sw.setOnline(false);
    const res = await sw.fetch("/director/profit?days=90", { navigate: true });
    expect(await res!.text()).toBe(`data for ${ORIGIN}/director/profit?days=90`);
  });

  it("связи нет и страница не сохранялась: показывается страница «Нет связи»", async () => {
    sw.setOnline(false);
    const res = await sw.fetch("/manager/shipments/5", { navigate: true });
    expect(await res!.text()).toBe("OFFLINE PAGE");
  });

  it("при переходах внутри приложения (запросы RSC) тоже работает последняя копия", async () => {
    await sw.fetch("/director/changes?_rsc=abc", { headers: { RSC: "1" } });
    sw.setOnline(false);
    const res = await sw.fetch("/director/changes?_rsc=abc", { headers: { RSC: "1" } });
    expect(await res!.text()).toBe(`data for ${ORIGIN}/director/changes?_rsc=abc`);
  });

  it("не сохраняются ошибки сервера и перенаправления (например, на страницу входа)", async () => {
    sw.setResponder(() => new Response("boom", { status: 500 }));
    await sw.fetch("/director", { navigate: true });
    const redirected = new Response("login", { status: 200 });
    Object.defineProperty(redirected, "redirected", { value: true });
    sw.setResponder(() => redirected);
    await sw.fetch("/manager", { navigate: true });
    expect(sw.stores.get("sr-pages-v1")?.size ?? 0).toBe(0);
  });

  it("запросы к API и любые изменения не перехватываются: данные для правок всегда свежие", async () => {
    expect(await sw.fetch("/api/shipments")).toBeUndefined();
    expect(await sw.fetch("/api/analytics/profit")).toBeUndefined();
    expect(await sw.fetch("/api/shipments/1", { method: "PATCH", body: "{}" })).toBeUndefined();
    expect(await sw.fetch("/api/auth/login", { method: "POST", body: "{}" })).toBeUndefined();
  });

  it("чужие адреса не перехватываются", async () => {
    expect(await sw.fetch("https://example.com/director", { navigate: true })).toBeUndefined();
  });

  it("статика отдаётся из кэша без обращения к сети", async () => {
    await sw.fetch("/_next/static/chunks/app.js");
    const before = sw.calls.length;
    sw.setOnline(false);
    const res = await sw.fetch("/_next/static/chunks/app.js");
    expect(await res!.text()).toContain("data for");
    expect(sw.calls.length).toBe(before);
  });

  it("страница входа без связи: «Нет связи», а не сохранённая копия чужих данных", async () => {
    sw.setOnline(false);
    const res = await sw.fetch("/login", { navigate: true });
    expect(await res!.text()).toBe("OFFLINE PAGE");
  });

  it("при выходе из системы сохранённые страницы удаляются", async () => {
    await sw.fetch("/director", { navigate: true });
    expect(sw.stores.has("sr-pages-v1")).toBe(true);
    await sw.message({ type: "CLEAR_PAGES" });
    expect(sw.stores.has("sr-pages-v1")).toBe(false);
    sw.setOnline(false);
    const res = await sw.fetch("/director", { navigate: true });
    expect(await res!.text()).toBe("OFFLINE PAGE");
  });

  it("при обновлении воркера старые версии кэшей удаляются", async () => {
    sw.stores.set("sr-static-v0", new Map());
    await sw.activate();
    expect(sw.stores.has("sr-static-v0")).toBe(false);
  });
});
