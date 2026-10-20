import type { CSSProperties } from "react";
import { redirect } from "next/navigation";
import { getCurrentUser, homeFor } from "@/lib/auth/server";
import LoginForm from "./LoginForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Вход · Морской маршрут" };

/**
 * Пузырьки медленно поднимаются со дна экрана вверх.
 * left: положение по ширине; size: диаметр, px; dur: время подъёма, с;
 * delay: сдвиг старта (отрицательный, чтобы при загрузке пузырьки уже были в разных местах);
 * sway: боковое покачивание, px; o: прозрачность.
 */
/** Простая детерминированная «случайность»: разметка одинакова при каждой загрузке (без расхождений при гидратации). */
const rnd = (i: number, k: number) => {
  const x = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
  return x - Math.floor(x);
};

/** Размеры: много мелких, меньше средних и несколько крупных. */
const SIZES = [6, 7, 8, 9, 10, 12, 14, 16, 18, 22, 26, 32, 40, 52];

const BUBBLES = Array.from({ length: 36 }, (_, i) => {
  const size = SIZES[Math.floor(Math.pow(rnd(i, 1), 1.35) * SIZES.length)];
  return {
    left: Math.round((i * 100) / 36 + (rnd(i, 2) - 0.5) * 2.6),
    size,
    dur: Math.round(56 + rnd(i, 3) * 52),
    delay: -Math.round(rnd(i, 4) * 110),
    sway: Math.round(6 + size / 3 + rnd(i, 5) * 8),
    o: Math.round((0.45 + rnd(i, 6) * 0.2) * 100) / 100,
  };
});

/**
 * Волна: синусоида, повторяющаяся без шва. Слой в 2 раза шире экрана
 * и сдвигается на половину своей ширины, поэтому движение бесконечно.
 * Период должен делить 1440 без остатка.
 */
function wavePath(base: number, amp: number, period: number): string {
  const half = period / 2;
  const n = Math.round(2880 / half);
  let d = `M0 ${base} Q ${half / 2} ${base - 2 * amp} ${half} ${base}`;
  for (let i = 2; i <= n; i++) d += ` T ${half * i} ${base}`;
  return `${d} L2880 200 L0 200 Z`;
}

/** Иконка как в референсе: рыба над волной на синей плитке. */
function BrandIcon() {
  return (
    <svg viewBox="0 0 100 100" aria-hidden="true">
      <defs>
        <linearGradient id="tile" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#4a97ca" />
          <stop offset="1" stopColor="#22629c" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="98" height="98" rx="23" fill="url(#tile)" />
      <rect x="1.5" y="1.5" width="97" height="97" rx="22.5" fill="none" stroke="rgba(255,255,255,0.35)" />
      <path
        d="M19 51C24 40 34 34 46 35C58 36 66 44 69 50C66 57 58 65 46 65C33 65 24 61 19 51Z"
        fill="#f4f8ff"
      />
      <path d="M66 51L80.5 33V67Z" fill="#f4f8ff" strokeLinejoin="round" />
      <circle cx="34" cy="47" r="4.2" fill="#2c6fb3" />
      <path
        d="M13 75C20 69 27 69 33 73S46 79 52 74S66 69 72 73S84 79 90 74"
        fill="none"
        stroke="#f4f8ff"
        strokeWidth="4.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) redirect(homeFor(user.role));

  return (
    <main className="login">
      <div className="login__scene" aria-hidden="true">
        <svg className="wave wave--back" viewBox="0 0 2880 200" preserveAspectRatio="none">
          <path d={wavePath(80, 20, 1440)} fill="#14264e" />
        </svg>
        <svg className="wave wave--front" viewBox="0 0 2880 200" preserveAspectRatio="none">
          <path d={wavePath(92, 14, 720)} fill="#142a59" />
        </svg>
      </div>

      <div className="login__bubbles" aria-hidden="true">
        {BUBBLES.map((b, i) => (
          <span
            key={i}
            className="bubble"
            style={
              {
                left: `${b.left}%`,
                "--size": `${b.size}px`,
                "--dur": `${b.dur}s`,
                "--delay": `${b.delay}s`,
                "--sway": `${b.sway}px`,
                "--o": b.o,
              } as CSSProperties
            }
          >
            <span className="bubble__body" />
          </span>
        ))}
      </div>
      <section className="login__hero">
        <div className="brand">
          <div className="brand__icon">
            <BrandIcon />
          </div>
          <div>
            <div className="brand__name">Морской маршрут</div>
            <div className="brand__tag">Контейнерные перевозки</div>
          </div>
        </div>
        <h1 className="hero__title">
          Порядок в перевозках,<span>ясность в цифрах</span>
        </h1>
        <p className="hero__text">Учёт перевозок для менеджеров и аналитика для руководителя в одном приложении.</p>
      </section>

      <section className="login__card" aria-labelledby="login-title">
        <h2 id="login-title" className="card__title">
          Вход в систему
        </h2>
        <p className="card__lead">Введите e-mail и пароль, выданные администратором</p>
        <LoginForm />
        <p className="card__help">
          Нет доступа или забыли пароль?
          <br />
          Обратитесь к администратору.
        </p>
      </section>
    </main>
  );
}
