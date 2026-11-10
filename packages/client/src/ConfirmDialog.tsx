import { useEffect, useRef } from "react";

interface ConfirmDialogProps {
  title: string;
  description: string;
  subject?: string;
  confirmLabel: string;
  busy?: boolean;
  onConfirm(): void;
  onCancel(): void;
}

export function ConfirmDialog({
  title,
  description,
  subject,
  confirmLabel,
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const busyRef = useRef(busy);
  const cancelRef = useRef(onCancel);
  busyRef.current = busy;
  cancelRef.current = onCancel;

  useEffect(() => {
    const previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    cancelButtonRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busyRef.current) {
        cancelRef.current();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previouslyFocused?.focus();
    };
  }, []);

  return (
    <div
      className="modal-backdrop confirm-backdrop"
      role="presentation"
      onMouseDown={() => {
        if (!busy) onCancel();
      }}
    >
      <section
        className="confirm-card"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-description"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="confirm-heading">
          <span className="confirm-symbol" aria-hidden="true">
            删
          </span>
          <div>
            <p className="eyebrow">危险操作</p>
            <h2 id="confirm-dialog-title">{title}</h2>
          </div>
        </div>
        <p id="confirm-dialog-description" className="confirm-description">
          {description}
        </p>
        {subject ? <div className="confirm-subject">“{subject}”</div> : null}
        <p className="confirm-note">
          删除后该记录会从当前列表移除，并在连接服务器时同步到其他设备。
        </p>
        <div className="confirm-actions">
          <button
            className="secondary-button"
            type="button"
            ref={cancelButtonRef}
            disabled={busy}
            onClick={onCancel}
          >
            取消
          </button>
          <button
            className="danger-button"
            type="button"
            disabled={busy}
            onClick={onConfirm}
          >
            {busy ? "正在删除…" : confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}
