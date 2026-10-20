import type { ReactNode } from "react";

/** Поле формы: подпись, элемент ввода, подсказка и ошибка под ним. */
export default function Field({ label, error, hint, children, wide }: { label: string; error?: string; hint?: string; children: ReactNode; wide?: boolean }) {
  return (
    <label className={`field${wide ? " field--wide" : ""}${error ? " field--error" : ""}`}>
      <span className="field__label">{label}</span>
      {children}
      {error ? <span className="field__error" role="alert">{error}</span> : hint ? <span className="field__hint">{hint}</span> : null}
    </label>
  );
}
