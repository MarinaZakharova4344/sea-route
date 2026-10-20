import Bubbles from "./Bubbles";

/** Фон рабочих экранов: лучи света и поднимающиеся пузырьки (как на странице входа). */
export default function AppScene() {
  return (
    <div className="scene" aria-hidden="true">
      <div className="scene__rays" />
      <Bubbles className="scene__bubbles" />
    </div>
  );
}
