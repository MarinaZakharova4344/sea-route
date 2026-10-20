import { redirect } from "next/navigation";
import { getCurrentUser, homeFor } from "@/lib/auth/server";
import Bubbles from "@/components/Bubbles";
import BrandIcon from "@/components/BrandIcon";
import LoginForm from "./LoginForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Вход · Морской маршрут" };

/**
 * Пузырьки медленно поднимаются со дна экрана вверх.
 * left: положение по ширине; size: диаметр, px; dur: время подъёма, с;
 * delay: сдвиг старта (отрицательный, чтобы при загрузке пузырьки уже были в разных местах);
 * sway: боковое покачивание, px; o: прозрачность.
 */
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

      <Bubbles className="login__bubbles" />

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
