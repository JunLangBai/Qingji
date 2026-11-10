import {
  completedTasksNewestFirst,
  getDueState,
  groupActiveTasksByCreatedOn,
  summarizeActiveTasks,
  type Task,
} from "@qingji/domain";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  CompletionCelebration,
} from "./CompletionCelebration";
import type { CompletionOrigin } from "./CompleteTaskButton";
import { EmptyState } from "./EmptyState";
import { formatToday } from "./formatters";
import { HistoryPanel } from "./HistoryPanel";
import { SettingsDialog } from "./SettingsDialog";
import { subscribeNotificationActions } from "./notificationService";
import {
  resetPreferenceSettings,
  saveSettings,
  type AppSettings,
} from "./settingsStore";
import { TaskCaptureCard } from "./TaskCaptureCard";
import { TaskEditorDialog } from "./TaskEditorDialog";
import { TaskGroups } from "./TaskGroups";
import { UpdateBanner } from "./UpdateBanner";
import { useTasks } from "./taskHooks";
import { useAppUpdate } from "./useAppUpdate";
import {
  completeTask,
  completeTasks,
  deleteTask,
  deleteTasks,
  getTasksSnapshot,
  undoCompleteTask,
  undoCompleteTasks,
  updateTask,
} from "./taskStore";
import { useNow } from "./useNow";

interface MainViewProps {
  settings: AppSettings;
}

type ActiveView = "todo" | "history";
type TaskFilter = "all" | "today" | "overdue";

interface SelectionToolbarProps {
  selectedCount: number;
  totalCount: number;
  allSelected: boolean;
  onToggleAll(): void;
  onClear(): void;
  children: ReactNode;
}

function SelectionToolbar({
  selectedCount,
  totalCount,
  allSelected,
  onToggleAll,
  onClear,
  children,
}: SelectionToolbarProps) {
  return (
    <div className="selection-toolbar" role="toolbar" aria-label="批量操作">
      <label className="selection-all">
        <input
          type="checkbox"
          checked={allSelected}
          onChange={onToggleAll}
        />
        全选当前 {totalCount} 项
      </label>
      <span>已选 {selectedCount} 项</span>
      <div className="selection-actions">
        {children}
        <button
          className="text-button"
          type="button"
          onClick={onClear}
        >
          清除选择
        </button>
      </div>
    </div>
  );
}

export function MainView({ settings }: MainViewProps) {
  const tasks = useTasks();
  const now = useNow();
  const appUpdate = useAppUpdate(settings.syncServerUrl);
  const [activeView, setActiveView] = useState<ActiveView>("todo");
  const [taskFilter, setTaskFilter] = useState<TaskFilter>("all");
  const [historyCreatedOn, setHistoryCreatedOn] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [undo, setUndo] = useState<{ ids: string[]; label: string } | null>(
    null,
  );
  const [celebration, setCelebration] = useState<{
    id: number;
    x: number;
    y: number;
  } | null>(null);
  const [focusedTaskId, setFocusedTaskId] = useState<string | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([]);
  const workspaceRef = useRef<HTMLElement>(null);
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  const settingsCloseButtonRef = useRef<HTMLButtonElement>(null);
  const isDesktop = Boolean(window.qingjiDesktop);

  useEffect(() => {
    if (!undo) return;
    const timer = window.setTimeout(() => setUndo(null), 5_000);
    return () => window.clearTimeout(timer);
  }, [undo]);

  useEffect(() => {
    if (!celebration) return;
    const timer = window.setTimeout(() => setCelebration(null), 950);
    return () => window.clearTimeout(timer);
  }, [celebration]);

  useEffect(() => {
    if (!showSettings) return;

    const previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    settingsCloseButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShowSettings(false);
    };
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      (previouslyFocused ?? settingsButtonRef.current)?.focus();
    };
  }, [showSettings]);

  useEffect(() => {
    if (!editingTask) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setEditingTask(null);
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [editingTask]);

  useEffect(() => {
    const desktop = window.qingjiDesktop;
    if (!desktop) return;

    return desktop.onFocusTask((taskId) => {
      const target = getTasksSnapshot().find((task) => task.id === taskId);
      if (!target || target.deletedAt) return;

      setActiveView(target.status === "completed" ? "history" : "todo");
      setTaskFilter("all");
      if (target.status === "completed") setHistoryCreatedOn("");
      setFocusedTaskId(taskId);
    });
  }, []);

  useEffect(() => {
    return window.qingjiDesktop?.onShowTodo(() => {
      setActiveView("todo");
      setTaskFilter("all");
      setSelectionMode(false);
      setSelectedTaskIds([]);
      window.requestAnimationFrame(() => {
        workspaceRef.current?.scrollTo({ top: 0 });
      });
    });
  }, []);

  useEffect(() => {
    return subscribeNotificationActions((action) => {
      setActiveView("todo");
      setTaskFilter("all");
      setSelectionMode(false);
      setSelectedTaskIds([]);
      if (action.taskId) {
        const target = getTasksSnapshot().find(
          (task) => task.id === action.taskId,
        );
        if (target?.status === "active" && !target.deletedAt) {
          setFocusedTaskId(target.id);
        }
      }
      window.requestAnimationFrame(() => {
        workspaceRef.current?.scrollTo({ top: 0 });
      });
    });
  }, []);

  useEffect(() => {
    if (!focusedTaskId) return;
    const scrollTimer = window.setTimeout(() => {
      const target = [...document.querySelectorAll<HTMLElement>("[data-task-id]")]
        .find((element) => element.dataset.taskId === focusedTaskId);
      target?.scrollIntoView({ block: "center" });
    }, 60);
    const clearTimer = window.setTimeout(
      () => setFocusedTaskId(null),
      1_800,
    );

    return () => {
      window.clearTimeout(scrollTimer);
      window.clearTimeout(clearTimer);
    };
  }, [
    activeView,
    focusedTaskId,
    historyCreatedOn,
    taskFilter,
    tasks,
  ]);

  const summary = useMemo(
    () => summarizeActiveTasks(tasks, now),
    [now, tasks],
  );
  const filteredTasks = useMemo(
    () =>
      tasks.filter((task) => {
        if (task.status !== "active" || task.deletedAt) return false;
        const state = getDueState(task, now);
        if (taskFilter === "today") return state === "due-today";
        if (taskFilter === "overdue") return state === "overdue";
        return true;
      }),
    [now, taskFilter, tasks],
  );
  const groups = useMemo(
    () => groupActiveTasksByCreatedOn(filteredTasks),
    [filteredTasks],
  );
  const completed = useMemo(
    () => completedTasksNewestFirst(tasks),
    [tasks],
  );
  const completedDates = useMemo(
    () =>
      [...new Set(completed.map((task) => task.createdOn))].sort(
        (left, right) => right.localeCompare(left),
      ),
    [completed],
  );
  const visibleCompleted = useMemo(
    () =>
      historyCreatedOn
        ? completed.filter(
            (task) => task.createdOn === historyCreatedOn,
          )
        : completed,
    [completed, historyCreatedOn],
  );
  const visibleTaskIds = useMemo(
    () => groups.flatMap((group) => group.tasks.map((task) => task.id)),
    [groups],
  );
  const visibleCompletedIds = useMemo(
    () => visibleCompleted.map((task) => task.id),
    [visibleCompleted],
  );
  const selectableIds =
    activeView === "history" ? visibleCompletedIds : visibleTaskIds;
  const selectableSet = useMemo(
    () => new Set(selectableIds),
    [selectableIds],
  );
  const selectedSet = useMemo(
    () => new Set(selectedTaskIds),
    [selectedTaskIds],
  );
  const selectedVisibleIds = selectedTaskIds.filter((id) =>
    selectableSet.has(id),
  );
  const allVisibleSelected =
    selectableIds.length > 0 &&
    selectableIds.every((id) => selectedSet.has(id));

  useEffect(() => {
    if (
      historyCreatedOn &&
      !completedDates.includes(historyCreatedOn)
    ) {
      setHistoryCreatedOn("");
    }
  }, [completedDates, historyCreatedOn]);

  useEffect(() => {
    setSelectedTaskIds((current) =>
      current.filter((id) => selectableSet.has(id)),
    );
  }, [selectableSet]);

  function switchView(view: ActiveView) {
    setActiveView(view);
    setSelectionMode(false);
    setSelectedTaskIds([]);
    window.requestAnimationFrame(() => {
      workspaceRef.current?.scrollTo({ top: 0 });
    });
  }

  function applyTaskFilter(filter: Exclude<TaskFilter, "all">) {
    setActiveView("todo");
    setTaskFilter((current) => (current === filter ? "all" : filter));
    setSelectionMode(false);
    setSelectedTaskIds([]);
    window.requestAnimationFrame(() => {
      workspaceRef.current?.scrollTo({ top: 0 });
    });
  }

  function updateSettings(patch: Partial<AppSettings>) {
    saveSettings({ ...settings, ...patch });
  }

  function resetSettings() {
    if (
      !window.confirm(
        "恢复默认设置？事项、完成记录和当前账号连接不会改变。",
      )
    ) {
      return;
    }
    saveSettings(resetPreferenceSettings(settings));
  }

  function toggleSelectionMode() {
    setSelectionMode((current) => !current);
    setSelectedTaskIds([]);
  }

  function toggleTaskSelection(taskId: string) {
    setSelectedTaskIds((current) =>
      current.includes(taskId)
        ? current.filter((id) => id !== taskId)
        : [...current, taskId],
    );
  }

  function toggleSelectAll() {
    setSelectedTaskIds(
      allVisibleSelected ? [] : [...selectableIds],
    );
  }

  function clearSelection() {
    setSelectedTaskIds([]);
  }

  function changeHistoryCreatedOn(value: string) {
    setHistoryCreatedOn(value);
    setSelectionMode(false);
    setSelectedTaskIds([]);
  }

  function handleCreated() {
    setActiveView("todo");
    setTaskFilter("all");
    window.requestAnimationFrame(() => {
      workspaceRef.current?.scrollTo({ top: 0 });
    });
  }

  function showCompletionCelebration(origin?: CompletionOrigin) {
    if (!settings.completionCelebration) return;
    setCelebration({
      id: Date.now(),
      x: origin?.x ?? window.innerWidth / 2,
      y: origin?.y ?? window.innerHeight * 0.42,
    });
  }

  async function handleComplete(task: Task, origin: CompletionOrigin) {
    const completedTask = await completeTask(task.id);
    if (completedTask) {
      showCompletionCelebration(origin);
      setUndo({
        ids: [completedTask.id],
        label: `已完成「${completedTask.title}」`,
      });
    }
  }

  async function handleCompleteSelected() {
    if (selectedVisibleIds.length === 0) return;
    const selected = [...selectedVisibleIds];
    const completed = await completeTasks(selected);
    setSelectionMode(false);
    setSelectedTaskIds([]);
    if (completed > 0) {
      showCompletionCelebration();
      setUndo({ ids: selected, label: `已完成 ${completed} 项` });
    }
  }

  async function handleDelete(task: Task) {
    if (!window.confirm(`删除“${task.title}”？`)) return;
    await deleteTask(task.id);
  }

  async function handleDeleteSelected() {
    if (selectedVisibleIds.length === 0) return;
    if (
      !window.confirm(`删除所选 ${selectedVisibleIds.length} 项？`)
    ) {
      return;
    }
    await deleteTasks(selectedVisibleIds);
    setSelectionMode(false);
    setSelectedTaskIds([]);
  }

  function openSticky(task: Task) {
    if (!window.qingjiDesktop) return;
    void window.qingjiDesktop.openSticky(task.id, {
      alwaysOnTop: settings.stickyAlwaysOnTop,
    });
  }

  async function saveEditedTask(input: {
    title: string;
    note?: string;
    dueAt: string;
    notificationLeadMinutes: Task["notificationLeadMinutes"];
  }) {
    if (!editingTask) return;
    const updated = await updateTask(editingTask.id, {
      title: input.title.trim(),
      note: input.note?.trim() || undefined,
      dueAt: new Date(input.dueAt).toISOString(),
      notificationLeadMinutes: input.notificationLeadMinutes,
    });
    if (!updated) throw new Error("Task no longer exists");
    setEditingTask(null);
  }

  async function restoreCompletedTask(task: Task) {
    await undoCompleteTask(task.id);
    setActiveView("todo");
    setTaskFilter("all");
    setFocusedTaskId(task.id);
    window.requestAnimationFrame(() => {
      workspaceRef.current?.scrollTo({ top: 0 });
    });
  }

  async function restoreSelectedCompletedTasks() {
    if (selectedVisibleIds.length === 0) return;
    await undoCompleteTasks(selectedVisibleIds);
    setSelectionMode(false);
    setSelectedTaskIds([]);
    setActiveView("todo");
    setTaskFilter("all");
    window.requestAnimationFrame(() => {
      workspaceRef.current?.scrollTo({ top: 0 });
    });
  }

  const filterLabel =
    taskFilter === "today"
      ? "今天到期"
      : taskFilter === "overdue"
        ? "已经逾期"
        : "未完成事项";
  const visibleTaskCount = groups.reduce(
    (total, group) => total + group.tasks.length,
    0,
  );
  const todayFilterActive =
    activeView === "todo" && taskFilter === "today";
  const overdueFilterActive =
    activeView === "todo" && taskFilter === "overdue";

  return (
    <main className={`app-shell ${isDesktop ? "desktop" : "mobile"}`}>
      <aside className="side-rail">
        <div className="brand-mark">清</div>
        <div className="brand-copy">
          <p className="eyebrow">QINGJI</p>
          <h1>清记</h1>
        </div>
        <nav className="side-nav" aria-label="主视图">
          <button
            className={`nav-item ${activeView === "todo" ? "active" : ""}`}
            type="button"
            aria-current={activeView === "todo" ? "page" : undefined}
            onClick={() => switchView("todo")}
          >
            <span>今</span>
            待办
          </button>
          <button
            className={`nav-item ${activeView === "history" ? "active" : ""}`}
            type="button"
            aria-current={activeView === "history" ? "page" : undefined}
            onClick={() => switchView("history")}
          >
            <span>记</span>
            完成记录
          </button>
        </nav>
        <div className="side-spacer" />
        <button
          className="nav-item"
          type="button"
          ref={settingsButtonRef}
          onClick={() => setShowSettings(true)}
        >
          <span>设</span>
          设置
        </button>
        <p className="side-hint">把忙碌留给事情，把记忆交给清记。</p>
      </aside>

      <section className="workspace" ref={workspaceRef}>
        <header className="topbar">
          <div>
            <p className="eyebrow">今天</p>
            <h2>{formatToday(now)}</h2>
          </div>
          <div className="summary-row">
            <button
              className={`summary-card warm ${todayFilterActive ? "active" : ""}`}
              type="button"
              aria-pressed={todayFilterActive}
              onClick={() => applyTaskFilter("today")}
            >
              <strong>{summary.todayRemaining}</strong>
              <span>今天到期</span>
            </button>
            <button
              className={`summary-card danger ${overdueFilterActive ? "active" : ""}`}
              type="button"
              aria-pressed={overdueFilterActive}
              onClick={() => applyTaskFilter("overdue")}
            >
              <strong>{summary.overdue}</strong>
              <span>已经逾期</span>
            </button>
          </div>
        </header>

        {appUpdate.release ? (
          <UpdateBanner
            release={appUpdate.release}
            onDismiss={appUpdate.dismissRelease}
          />
        ) : null}

        <TaskCaptureCard
          defaultLeadMinutes={settings.defaultLeadMinutes}
          onCreated={handleCreated}
        />

        {activeView === "history" ? (
          <>
            {selectionMode ? (
              <SelectionToolbar
                selectedCount={selectedVisibleIds.length}
                totalCount={selectableIds.length}
                allSelected={allVisibleSelected}
                onToggleAll={toggleSelectAll}
                onClear={clearSelection}
              >
                <button
                  className="text-button"
                  type="button"
                  disabled={selectedVisibleIds.length === 0}
                  onClick={() => void restoreSelectedCompletedTasks()}
                >
                  恢复所选
                </button>
                <button
                  className="text-button danger-text"
                  type="button"
                  disabled={selectedVisibleIds.length === 0}
                  onClick={() => void handleDeleteSelected()}
                >
                  删除所选
                </button>
              </SelectionToolbar>
            ) : null}
            <HistoryPanel
              completed={completed}
              visibleCompleted={visibleCompleted}
              createdDates={completedDates}
              selectedCreatedOn={historyCreatedOn}
              focusedTaskId={focusedTaskId}
              selectionMode={selectionMode}
              selectedTaskIds={selectedSet}
              onSelectCreatedOn={changeHistoryCreatedOn}
              onRestore={(task) => void restoreCompletedTask(task)}
              onDelete={(task) => void handleDelete(task)}
              onToggleSelection={toggleTaskSelection}
              onToggleSelectionMode={toggleSelectionMode}
            />
          </>
        ) : (
          <section className="content-section">
            <div className="section-heading">
              <div>
                <p className="eyebrow">OPEN ITEMS</p>
                <h3>{filterLabel}</h3>
              </div>
              <div className="section-heading-actions">
                <button
                  className={`text-button selection-mode-button ${selectionMode ? "active" : ""}`}
                  type="button"
                  aria-pressed={selectionMode}
                  onClick={toggleSelectionMode}
                >
                  {selectionMode ? "退出多选" : "多选"}
                </button>
                {taskFilter !== "all" ? (
                  <button
                    className="text-button"
                    type="button"
                    onClick={() => setTaskFilter("all")}
                  >
                    显示全部
                  </button>
                ) : (
                  <p>按创建日期归档</p>
                )}
                <span>{visibleTaskCount} 项</span>
              </div>
            </div>

            {selectionMode ? (
              <SelectionToolbar
                selectedCount={selectedVisibleIds.length}
                totalCount={selectableIds.length}
                allSelected={allVisibleSelected}
                onToggleAll={toggleSelectAll}
                onClear={clearSelection}
              >
                <button
                  className="text-button"
                  type="button"
                  disabled={selectedVisibleIds.length === 0}
                  onClick={() => void handleCompleteSelected()}
                >
                  完成所选
                </button>
                <button
                  className="text-button danger-text"
                  type="button"
                  disabled={selectedVisibleIds.length === 0}
                  onClick={() => void handleDeleteSelected()}
                >
                  删除所选
                </button>
              </SelectionToolbar>
            ) : null}

            {groups.length === 0 ? (
              <EmptyState
                title={
                  taskFilter === "all"
                    ? "桌面已经清空"
                    : taskFilter === "today"
                      ? "今天没有剩余事项"
                      : "没有逾期事项"
                }
                body={
                  taskFilter === "all"
                    ? "记下下一件有截止时间的事情。"
                    : "可以切换到其他待办或显示全部。"
                }
              />
            ) : (
              <TaskGroups
                groups={groups}
                now={now}
                isDesktop={isDesktop}
                focusedTaskId={focusedTaskId}
                selectionMode={selectionMode}
                selectedTaskIds={selectedSet}
                completionMode={settings.completionMode}
                onComplete={(task, origin) =>
                  void handleComplete(task, origin)
                }
                onDelete={(task) => void handleDelete(task)}
                onEdit={setEditingTask}
                onOpenSticky={openSticky}
                onToggleSelection={toggleTaskSelection}
              />
            )}
          </section>
        )}
      </section>

      {showSettings ? (
        <SettingsDialog
          settings={settings}
          isDesktop={isDesktop}
          closeButtonRef={settingsCloseButtonRef}
          updateRelease={appUpdate.release}
          updateChecking={appUpdate.checking}
          updateMessage={appUpdate.message}
          onChange={updateSettings}
          onResetSettings={resetSettings}
          onCheckForUpdate={() => void appUpdate.checkForUpdate(true)}
          onClose={() => setShowSettings(false)}
        />
      ) : null}

      {editingTask ? (
        <TaskEditorDialog
          key={editingTask.id}
          task={editingTask}
          onClose={() => setEditingTask(null)}
          onSave={saveEditedTask}
        />
      ) : null}

      {undo ? (
        <div className="undo-toast" role="status">
          <span className="undo-toast-check" aria-hidden="true">
            ✓
          </span>
          <span className="undo-toast-copy">
            <strong>{undo.label}</strong>
            <small>已加入完成记录，5 秒内可以撤销</small>
          </span>
          <button
            type="button"
            onClick={() => {
              void undoCompleteTasks(undo.ids);
              setUndo(null);
            }}
          >
            撤销
          </button>
        </div>
      ) : null}

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
