import Link from "next/link";

/** Экран «Страница не найдена»: понятный текст и кнопка, которая возвращает к работе. */
export default function NotFoundView({ homeHref, homeLabel }: { homeHref: string; homeLabel: string }) {
  return (
    <div className="panel errview" role="alert">
      <h1>Страница не найдена</h1>
      <p>Такой страницы нет, или перевозку удалили. Проверьте адрес или вернитесь к работе.</p>
      <Link href={homeHref} className="btn">
        {homeLabel}
      </Link>
    </div>
  );
}
