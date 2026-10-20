"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

export default function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const form = new FormData(e.currentTarget);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: form.get("email"), password: form.get("password") }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Не удалось войти");
        return;
      }
      router.replace("/");
      router.refresh();
    } catch {
      setError("Нет связи с сервером. Проверьте подключение и повторите");
    } finally {
      setPending(false);
    }
  }

  const field = { display: "block", width: "100%", padding: 10, margin: "4px 0 12px", fontSize: 16, boxSizing: "border-box" as const };

  return (
    <form onSubmit={onSubmit}>
      <label>
        E-mail
        <input name="email" type="email" autoComplete="username" required style={field} />
      </label>
      <label>
        Пароль
        <input name="password" type="password" autoComplete="current-password" required style={field} />
      </label>
      {error && (
        <p role="alert" style={{ color: "#b00020" }}>
          {error}
        </p>
      )}
      <button type="submit" disabled={pending} style={{ padding: "10px 16px", fontSize: 16 }}>
        {pending ? "Входим…" : "Войти"}
      </button>
    </form>
  );
}
