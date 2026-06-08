import { useEffect, useState } from "react";

interface HearthstoneToastProps {
  message: string;
  type: "success" | "error";
  onClose: () => void;
}

export function HearthstoneToast({ message, type, onClose }: HearthstoneToastProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setVisible(true);
    const timer = setTimeout(() => {
      setVisible(false);
      setTimeout(onClose, 200);
    }, 2000);
    return () => clearTimeout(timer);
  }, [onClose]);

  return (
    <div className="toast-overlay">
      <div className={`toast-panel ${type} ${visible ? "show" : ""}`}>
        <div className="toast-sigil"><span>{type === "success" ? "✓" : "✕"}</span></div>
        <div className="toast-message">{message}</div>
      </div>
    </div>
  );
}
