import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { Task } from "@qingji/domain";
import type { CompletionMode } from "./settingsStore";

export interface CompletionOrigin {
  x: number;
  y: number;
}

interface CompleteTaskButtonProps {
  mode: CompletionMode;
  task: Task;
  onComplete(task: Task, origin: CompletionOrigin): void;
}

const HOLD_DURATION_MS = 600;
const MOVE_CANCEL_DISTANCE = 9;

export function CompleteTaskButton({
  mode,
  task,
  onComplete,
}: CompleteTaskButtonProps) {
  const [holding, setHolding] = useState(false);
  const holdTimer = useRef<number | undefined>(undefined);
  const triggered = useRef(false);
  const suppressClick = useRef(false);
  const pointerStart = useRef({ x: 0, y: 0 });

  function clearHoldTimer() {
    if (holdTimer.current !== undefined) {
      window.clearTimeout(holdTimer.current);
      holdTimer.current = undefined;
    }
  }

  function cancelHold() {
    clearHoldTimer();
    setHolding(false);
  }

  useEffect(() => () => clearHoldTimer(), []);

  function beginHold(event: ReactPointerEvent<HTMLButtonElement>) {
    if (mode !== "hold" || event.button !== 0) return;
    event.preventDefault();
    triggered.current = false;
    suppressClick.current = false;
    pointerStart.current = { x: event.clientX, y: event.clientY };
    const origin = { x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
    setHolding(true);
    clearHoldTimer();
    holdTimer.current = window.setTimeout(() => {
      holdTimer.current = undefined;
      triggered.current = true;
      suppressClick.current = true;
      setHolding(false);
      onComplete(task, origin);
    }, HOLD_DURATION_MS);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
    if (mode !== "hold" || !holding || triggered.current) return;
    const distance = Math.hypot(
      event.clientX - pointerStart.current.x,
      event.clientY - pointerStart.current.y,
    );
    if (distance > MOVE_CANCEL_DISTANCE) {
      suppressClick.current = true;
      cancelHold();
    }
  }

  function handlePointerEnd(event: ReactPointerEvent<HTMLButtonElement>) {
    if (mode !== "hold") return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (!triggered.current) suppressClick.current = true;
    cancelHold();
  }

  function handleClick(event: ReactMouseEvent<HTMLButtonElement>) {
    if (mode === "hold") {
      if (suppressClick.current) {
        suppressClick.current = false;
        event.preventDefault();
      }
      return;
    }
    const bounds = event.currentTarget.getBoundingClientRect();
    onComplete(task, {
      x: event.clientX || bounds.left + bounds.width / 2,
      y: event.clientY || bounds.top + bounds.height / 2,
    });
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    onComplete(task, {
      x: bounds.left + bounds.width / 2,
      y: bounds.top + bounds.height / 2,
    });
  }

  return (
    <button
      type="button"
      className={[
        "complete-button",
        mode === "hold" ? "hold-mode" : "",
        holding ? "is-holding" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      aria-label={
        mode === "hold"
          ? `长按完成 ${task.title}`
          : `完成 ${task.title}`
      }
      title={mode === "hold" ? "按住 0.6 秒完成" : "单击完成"}
      onPointerDown={beginHold}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
    >
      <span className="complete-button-ring" aria-hidden="true" />
      <span className="complete-button-mark" aria-hidden="true">
        ✓
      </span>
      <span className="complete-button-label">
        {mode === "hold" ? "长按" : "完成"}
      </span>
    </button>
  );
}
