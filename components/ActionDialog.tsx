import { type ReactNode } from "react";

interface ActionDialogProps {
  isOpen: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  isDanger?: boolean;
  isSubmitting?: boolean;
  onClose: () => void;
  onConfirm: () => void;
  children?: ReactNode;
}

export const ActionDialog = ({
  isOpen,
  title,
  description,
  confirmLabel,
  isDanger = false,
  isSubmitting = false,
  onClose,
  onConfirm,
  children,
}: ActionDialogProps) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/45 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="action-dialog-title"
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl dark:bg-neutral-900"
      >
        <h2
          id="action-dialog-title"
          className="text-lg font-semibold text-gray-900 dark:text-white"
        >
          {title}
        </h2>
        <p className="mt-2 text-sm leading-6 text-gray-500 dark:text-neutral-400">{description}</p>
        {children && <div className="mt-4">{children}</div>}
        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-50 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            取消
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isSubmitting}
            className={`rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-50 ${
              isDanger ? "bg-red-600 hover:bg-red-700" : "bg-blue-600 hover:bg-blue-700"
            }`}
          >
            {isSubmitting ? "处理中..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
