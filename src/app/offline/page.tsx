import BrandIcon from "@/components/layout/BrandIcon";

export const metadata = { title: "Нет связи · Морской маршрут" };

/** Показывается, когда страницы нет в сохранённых и интернета нет. */
export default function Offline() {
  return (
    <main className="offline">
      <BrandIcon className="offline__icon" />
      <h1>Нет связи с интернетом</h1>
      <p>Эта страница ещё не была загружена. Откройте приложение, когда появится интернет, и вы снова увидите свежие данные.</p>
      <a href="/" className="offline__btn">
        Повторить
      </a>
    </main>
  );
}
