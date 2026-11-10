import {
  getDueState,
} from "@qingji/domain";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type AnimationEvent as ReactAnimationEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { CompletionCelebration } from "./CompletionCelebration";
import type { AppSettings } from "./settingsStore";
import { formatStickyDue } from "./formatters";
import {
  completeTask,
  undoCompleteTask,
} from "./taskStore";
import { useTask } from "./taskHooks";
import { useNow } from "./useNow";
import { usePrefersReducedMotion } from "./usePrefersReducedMotion";

interface StickyViewProps {
  taskId: string;
  settings: AppSettings;
}

export function StickyView({ taskId, settings }: StickyViewProps) {
  const task = useTask(taskId);
  const [actionPending, setActionPending] = useState(false);
  const [countdownNow, setCountdownNow] = useState(() => Date.now());
  const [isPinned, setIsPinned] = useState(false);
  const now = useNow(15_000);
  const prefersReducedMotion = usePrefersReducedMotion();
  const shouldAnimate =
    settings.stickyAnimations && !prefersReducedMotion;
  const [entryPhase, setEntryPhase] = useState<
    "pending" | "playing" | "done"
  >(() => (shouldAnimate ? "pending" : "done"));
  const [isClosing, setIsClosing] = useState(false);
  const [celebration, setCelebration] = useState<{
    id: number;
    x: number;
    y: number;
  } | null>(null);
  const closingRef = useRef(false);
  const closeSentRef = useRef(false);
  const completionDeadline =
    task?.status === "completed" && settings.stickyCloseOnComplete
      ? new Date(task.completedAt ?? task.updatedAt).getTime() + 5_000
      : null;
  const countdownReference =
    completionDeadline === null
      ? countdownNow
      : Math.max(countdownNow, completionDeadline - 5_000);
  const secondsLeft =
    completionDeadline === null
      ? 0
      : Math.max(
          0,
          Math.ceil((completionDeadline - countdownReference) / 1_000),
        );

  const sendClose = useCallback(() => {
    if (closeSentRef.current) return;
    closeSentRef.current = true;

    const closePromise = window.qingjiDesktop?.closeSticky();
    if (closePromise) {
      void closePromise.catch(() => window.close());
    } else {
      window.close();
    }
  }, []);

  const finishAnimatedClose = useCallback(() => {
    if (closeSentRef.current) return;
    let settled = false;
    const complete = () => {
      if (settled) return;
      settled = true;
      sendClose();
    };
    const fallback = window.setTimeout(complete, 50);
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        window.clearTimeout(fallback);
        complete();
      });
    });
  }, [sendClose]);

  const requestClose = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;

    if (!shouldAnimate) {
      sendClose();
      return;
    }
    setIsClosing(true);
  }, [sendClose, shouldAnimate]);

  useEffect(() => {
    if (!task || task.deletedAt) requestClose();
  }, [requestClose, task]);

  useEffect(() => {
    const desktop = window.qingjiDesktop;
    if (!desktop) return;
    void desktop.getStickyAlwaysOnTop().then(setIsPinned);
  }, []);

  useEffect(() => {
    if (completionDeadline === null) return;
    setCountdownNow(Date.now());
    const timer = window.setInterval(
      () => setCountdownNow(Date.now()),
      250,
    );
    return () => window.clearInterval(timer);
  }, [completionDeadline]);

  useEffect(() => {
    if (!celebration) return;
    const timer = window.setTimeout(() => setCelebration(null), 950);
    return () => window.clearTimeout(timer);
  }, [celebration]);

  useEffect(() => {
    if (completionDeadline === null || isClosing) return;
    const remaining = Math.max(0, completionDeadline - Date.now());
    const timer = window.setTimeout(requestClose, remaining);
    return () => window.clearTimeout(timer);
  }, [completionDeadline, isClosing, requestClose]);

  useEffect(() => {
    if (entryPhase !== "pending") return;
    if (!shouldAnimate) {
      setEntryPhase("done");
      return;
    }

    let cancelled = false;
    const reveal = () => {
      if (!cancelled) setEntryPhase("playing");
    };
    const fallback = window.setTimeout(reveal, 350);
    const enterPromise = window.qingjiDesktop?.waitForStickyEnter();
    if (enterPromise) void enterPromise.then(reveal);
    else reveal();

    return () => {
      cancelled = true;
      window.clearTimeout(fallback);
    };
  }, [entryPhase, shouldAnimate]);

  useEffect(() => {
    if (!isClosing) return;
    const fallback = window.setTimeout(finishAnimatedClose, 340);
    return () => window.clearTimeout(fallback);
  }, [finishAnimatedClose, isClosing]);

  const paperClassName = [
    "sticky-paper",
    entryPhase === "pending" ? "is-waiting-to-paste" : "",
    entryPhase === "playing" ? "is-pasting" : "",
    isClosing ? "is-peeling" : "",
    task?.status === "completed" ? "is-complete" : "",
  ]
    .filter(Boolean)
    .join(" ");

  function handlePaperAnimationEnd(
    event: ReactAnimationEvent<HTMLElement>,
  ) {
    if (event.target !== event.currentTarget) return;

    if (event.animationName === "sticky-paste-in") {
      setEntryPhase("done");
    }
    if (event.animationName === "sticky-peel-away") {
      finishAnimatedClose();
    }
  }

  if (!task || task.deletedAt) {
    return (
      <main className="sticky-shell">
        <article
          className={paperClassName}
          onAnimationEnd={handlePaperAnimationEnd}
        >
          <div className="sticky-drag-region">
            <span>清记便签</span>
            <button
              className="sticky-icon-button"
              type="button"
              aria-label="关闭便签"
              onClick={requestClose}
            >
              ×
            </button>
          </div>
          <div className="sticky-missing">
            <h1>事项不存在</h1>
            <p>它可能已经在另一台设备上被删除。</p>
          </div>
        </article>
      </main>
    );
  }

  const currentTask = task;
  const dueState = getDueState(currentTask, now);
  const isCompleted = currentTask.status === "completed";
  const deadlineLabel = isCompleted
    ? "已完成"
    : dueState === "overdue"
      ? "已经逾期"
      : dueState === "due-today"
        ? "今天到期"
        : "计划事项";

  async function finishTask() {
    setActionPending(true);
    try {
      const completedTask = await completeTask(currentTask.id);
      if (completedTask && settings.completionCelebration) {
        setCelebration({
          id: Date.now(),
          x: window.innerWidth / 2,
          y: window.innerHeight * 0.42,
        });
      }
    } finally {
      setActionPending(false);
    }
  }

  async function undo() {
    setActionPending(true);
    try {
      await undoCompleteTask(currentTask.id);
    } finally {
      setActionPending(false);
    }
  }

  async function togglePinned() {
    const desktop = window.qingjiDesktop;
    if (!desktop) return;
    const next = !isPinned;
    await desktop.setStickyAlwaysOnTop(next);
    setIsPinned(next);
  }

  function beginResize(event: ReactPointerEvent<HTMLDivElement>) {
    if (!window.qingjiDesktop) return;
    event.preventDefault();
    event.stopPropagation();

    const startX = event.screenX;
    const startY = event.screenY;
    const startWidth = window.innerWidth;
    const startHeight = window.innerHeight;
    let pendingWidth = startWidth;
    let pendingHeight = startHeight;
    let frame = 0;

    const onMove = (moveEvent: PointerEvent) => {
      pendingWidth = startWidth + moveEvent.screenX - startX;
      pendingHeight = startHeight + moveEvent.screenY - startY;
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        void window.qingjiDesktop?.resizeSticky(
          pendingWidth,
          pendingHeight,
        );
      });
    };

    const onUp = () => {
      if (frame) {
        window.cancelAnimationFrame(frame);
        frame = 0;
        void window.qingjiDesktop?.resizeSticky(
          pendingWidth,
          pendingHeight,
        );
      }
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  }

  return (
    <main className="sticky-shell">
      <article
        className={paperClassName}
        onAnimationEnd={handlePaperAnimationEnd}
      >
        <div className="paper-grain" />
        <div className="sticky-drag-region">
          <span>清记 · 单事项便签</span>
          <div className="sticky-window-actions">
            <button
              className="sticky-pin-button"
              type="button"
              aria-label={isPinned ? "取消便签置顶" : "置顶便签"}
              aria-pressed={isPinned}
              onClick={() => void togglePinned()}
            >
              {isPinned ? "已置顶" : "置顶"}
            </button>
            <button
              className="sticky-icon-button"
              type="button"
              aria-label="关闭便签"
              onClick={requestClose}
            >
              ×
            </button>
          </div>
        </div>

        <div className="sticky-body">
          <p className={`sticky-deadline ${dueState}`}>
            {deadlineLabel}
            <time>{formatStickyDue(task.dueAt)}</time>
          </p>
          <h1>{currentTask.title}</h1>
          {currentTask.note ? (
            <p className="sticky-note">{currentTask.note}</p>
          ) : null}
        </div>

        <footer className="sticky-footer">
          {isCompleted ? (
            <>
              <span className="completion-copy">
                已完成
                {settings.stickyCloseOnComplete
                  ? ` · ${secondsLeft} 秒后收起`
                  : " · 保持显示"}
              </span>
              <button
                className="undo-button"
                type="button"
                disabled={actionPending}
                onClick={() => void undo()}
              >
                撤销
              </button>
              <button
                className="sticky-secondary-button"
                type="button"
                onClick={() =>
                  void window.qingjiDesktop?.showMain(currentTask.id)
                }
              >
                主窗口
              </button>
            </>
          ) : (
            <>
              <button
                className="sticky-main-button"
                type="button"
                disabled={actionPending}
                onClick={() => void finishTask()}
              >
                <span>✓</span>
                完成这件事
              </button>
              <button
                className="sticky-secondary-button"
                type="button"
                onClick={() =>
                  void window.qingjiDesktop?.showMain(currentTask.id)
                }
              >
                打开主窗口
              </button>
            </>
          )}
        </footer>
        <div
          className="sticky-resize-handle"
          role="separator"
          aria-label="拖动调整便签大小"
          onPointerDown={beginResize}
        />
      </article>
      {celebration ? (
        <CompletionCelebration
          burstId={celebration.id}
          x={celebration.x}
          y={celebration.y}
        />
      ) : null}
    </main>
  );
}
