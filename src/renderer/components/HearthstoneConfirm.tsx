interface HearthstoneConfirmProps {
  title: string;
  message: string;
  confirmText: string;
  cancelText: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function HearthstoneConfirm({
  title,
  message,
  confirmText,
  cancelText,
  onConfirm,
  onCancel,
}: HearthstoneConfirmProps) {
  return (
    <div className="guide-overlay confirm-overlay" onClick={onCancel}>
      <div className="confirm-panel" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="close-confirm-title">
        <div className="confirm-sigil"><span>!</span></div>
        <div className="confirm-copy">
          <h2 id="close-confirm-title">{title}</h2>
          <p>{message}</p>
        </div>
        <div className="confirm-actions">
          <button className="btn-confirm-cancel" onClick={onCancel}>{cancelText}</button>
          <button className="btn-confirm-danger" onClick={onConfirm}>{confirmText}</button>
        </div>
      </div>
    </div>
  );
}
