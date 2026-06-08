import { useEffect, useState } from "react";
import { Dashboard } from "./components/Dashboard";
import { FallbackPrompt } from "./components/FallbackPrompt";
import { OverlayBar } from "./components/OverlayBar";
import { BallView } from "./components/BallView";
import type { AppStatus } from "../shared/types";

export function App() {
  const params = new URLSearchParams(window.location.search);
  const overlay = params.get("view") === "overlay";
  const ball = params.get("view") === "ball";
  const [status, setStatus] = useState<AppStatus>();
  const [bootError, setBootError] = useState<string>();

  useEffect(() => {
    let active = true;
    const loadStatus = async () => {
      try {
        const nextStatus = await window.hearthstoneAgent.getStatus();
        if (active) setStatus(nextStatus);
      } catch (error: unknown) {
        if (active) setBootError(error instanceof Error ? error.message : "启动失败");
      }
    };
    void loadStatus();
    const unsubscribe = window.hearthstoneAgent.onStatusChanged((nextStatus) => {
      if (active) setStatus(nextStatus);
    });
    const timer = window.setInterval(() => void loadStatus(), 1_500);
    return () => {
      active = false;
      window.clearInterval(timer);
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (overlay || ball) {
      document.body.style.background = "transparent";
      document.body.style.backgroundImage = "none";
    }
  }, [overlay, ball]);

  if (bootError) {
    return <div className="app-shell"><div className="dashboard" style={{padding:40,textAlign:"center",color:"#d56c61"}}>启动失败：{bootError}</div></div>;
  }
  if (!status) {
    return <div className="app-shell"><div className="dashboard" style={{padding:40,textAlign:"center",color:"#8a7a66"}}>正在启动…</div></div>;
  }
  return (
    <>
      {overlay ? <OverlayBar status={status} /> : ball ? <BallView status={status} /> : <Dashboard status={status} />}
      <FallbackPrompt />
    </>
  );
}


