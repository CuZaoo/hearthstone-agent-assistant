import { useEffect } from "react";
import type { AppStatus } from "../../shared/types";

export function BallView({ status }: { status: AppStatus }) {
  const analysis = status.analysis;
  const count = analysis?.candidates?.length ?? 0;

  useEffect(() => {
    document.body.style.background = "transparent";
    document.body.style.backgroundImage = "none";
  }, []);

  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.screenX;
    const startY = e.screenY;
    const winStartX = window.screenX;
    const winStartY = window.screenY;

    const onMouseMove = (ev: MouseEvent) => {
      window.moveTo(ev.screenX - (startX - winStartX), ev.screenY - (startY - winStartY));
    };

    const onMouseUp = (ev: MouseEvent) => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      if (Math.abs(ev.screenX - startX) < 3 && Math.abs(ev.screenY - startY) < 3) {
        void window.hearthstoneAgent.toggleOverlay();
      }
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  };

  return (
    <div className="ball-shell">
      <div className="ball-body" onMouseDown={onMouseDown}>
        <span className="ball-icon">⚔</span>
        {count > 0 && <span className="ball-badge">{count}</span>}
      </div>
    </div>
  );
}
