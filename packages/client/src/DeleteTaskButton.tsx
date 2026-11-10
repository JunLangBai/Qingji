interface DeleteTaskButtonProps {
  taskTitle: string;
  onDelete(): void;
}

export function DeleteTaskButton({
  taskTitle,
  onDelete,
}: DeleteTaskButtonProps) {
  return (
    <button
      className="delete-button"
      type="button"
      aria-label={`删除 ${taskTitle}`}
      title="删除事项"
      onClick={onDelete}
    >
      <span aria-hidden="true">×</span>
    </button>
  );
}
