import { useEffect, useRef, useState } from "react";

interface CloseBehaviorHintProps {
  open: boolean;
  onResolved(): void;
}

export function CloseBehaviorHint({
  open,
  onResolved,
}: CloseBehaviorHintProps) {
  const [dontShowAgain, setDontShowAgain] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const stayButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    setDontShowAgain(false);
    setError("");
    stayButtonRef.current?.focus();
  }, [open]);

  async function resolve(action: "tray" | "quit") {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await window.qingjiDesktop?.resolveCloseHint({
        action,
        dontShowAgain,
      });
      onResolved();
    } catch {
      setError("暂时无法完成窗口操作，请再试一次。");
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <div className="modal-backdrop close-hint-backdrop">
      <section
        className="close-hint-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="close-hint-title"
        aria-describedby="close-hint-description"
      >
        <div className="close-hint-heading">
          <div className="close-hint-seal" aria-hidden="true">
            清
          </div>
          <h2 id="close-hint-title">清记仍在后台运行</h2>
        </div>

        <p id="close-hint-description" className="close-hint-description">
          窗口已收起，便签继续显示。要完全退出，请右键托盘图标并选择“退出清记”。
        </p>

        <label className="close-hint-checkbox">
          <input
            type="checkbox"
            checked={dontShowAgain}
            onChange={(event) => setDontShowAgain(event.target.checked)}
          />
          不再提醒
        </label>

        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}

        <div className="close-hint-actions">
          <button
            className="secondary-button danger-text"
            type="button"
            disabled={busy}
            onClick={() => void resolve("quit")}
          >
            退出清记
          </button>
          <button
            className="primary-button"
            type="button"
            ref={stayButtonRef}
            disabled={busy}
            onClick={() => void resolve("tray")}
          >
            留在托盘
          </button>
        </div>
      </section>
    </div>
  );
}
