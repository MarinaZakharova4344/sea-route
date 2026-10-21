/** Заглушка на время загрузки страницы: блоки мерцают, пока приходят данные. */
export default function PageSkeleton() {
  return (
    <div className="skeleton" aria-busy="true" aria-label="Загрузка">
      <div className="skeleton__line skeleton__line--title" />
      <div className="skeleton__line skeleton__line--sub" />
      <div className="skeleton__block" />
      <div className="skeleton__block skeleton__block--tall" />
      <div className="skeleton__block" />
    </div>
  );
}
