"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

export default function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const form = new FormData(e.currentTarget);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: form.get("email"),
          password: form.get("password"),
          remember: form.get("remember") === "on",
        }),
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

  return (
    <form onSubmit={onSubmit}>
      <label className="field">
        <span className="field__label">E-mail</span>
        <input
          className="input"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="name@company.ru"
          required
          aria-invalid={error ? true : undefined}
        />
      </label>

      <div className="field">
        <label className="field__label" htmlFor="password">
          Пароль
        </label>
        <div className="field__box">
          <input
            id="password"
            className="input input--has-action"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            placeholder="Введите пароль"
            required
            aria-invalid={error ? true : undefined}
          />
          <button
            type="button"
            className="field__action"
            onClick={() => setShowPassword((v) => !v)}
            aria-pressed={showPassword}
          >
            {showPassword ? "Скрыть" : "Показать"}
          </button>
        </div>
      </div>

      <label className="check">
        <input className="check__input" type="checkbox" name="remember" />
        <span className="check__box" aria-hidden="true" />
        <span className="check__text">Запомнить меня на этом устройстве</span>
      </label>

      {error && (
        <p role="alert" className="form__error">
          {error}
        </p>
      )}

      <button type="submit" className="button" disabled={pending}>
        {pending ? "Входим…" : "Войти"}
      </button>
    </form>
  );
}
