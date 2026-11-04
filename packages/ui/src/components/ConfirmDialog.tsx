import { type ReactNode, useCallback, useState } from "react";
import { Button } from "./Button";
import { Dialog } from "./Dialog";

export interface ConfirmDialogProps {
  open: boolean;
  title: ReactNode;
  /** What will happen, in words: what is written where, what it replaces. */
  children: ReactNode;
  confirmLabel: string;
  /** A destructive action: the confirm button is red. */
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export interface Question {
  title: ReactNode;
  /** What will happen, in words. */
  text: ReactNode;
  confirmLabel: string;
  danger?: boolean;
}

/**
 * Asks a question in a ConfirmDialog and resolves to the answer, for code that
 * used `window.confirm`: `if (!(await confirm({ ... }))) return;`. Render
 * `dialog` once in the component.
 */
export function useConfirm(): { confirm: (question: Question) => Promise<boolean>; dialog: ReactNode } {
  const [asked, setAsked] = useState<(Question & { answer: (yes: boolean) => void }) | null>(null);
  const confirm = useCallback(
    (question: Question) => new Promise<boolean>((answer) => setAsked({ ...question, answer })),
    [],
  );
  const reply = (yes: boolean) => {
    asked?.answer(yes);
    setAsked(null);
  };
  const dialog = (
    <ConfirmDialog
      open={asked !== null}
      title={asked?.title ?? ""}
      confirmLabel={asked?.confirmLabel ?? "OK"}
      danger={asked?.danger}
      onConfirm={() => reply(true)}
      onCancel={() => reply(false)}
    >
      {asked?.text}
    </ConfirmDialog>
  );
  return { confirm, dialog };
}

/**
 * A modal question before a change that is hard to undo. It names what will
 * happen and puts Cancel first, where focus starts; Escape cancels unless the
 * action is running.
 */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  danger,
  busy,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      title={title}
      onClose={onCancel}
      busy={busy}
      actions={
        <>
          <Button onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button variant={danger ? "danger" : "primary"} busy={busy} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Dialog>
  );
}

/** Actions that restart, reboot or remove things, kept apart from everyday ones. */
export function DangerZone({ title = "Careful", children }: { title?: ReactNode; children: ReactNode }) {
  return (
    <div className="p2c-danger-zone" role="group" aria-label={typeof title === "string" ? title : "Careful"}>
      <span className="p2c-danger-zone-title">{title}</span>
      <div className="p2c-danger-zone-actions">{children}</div>
    </div>
  );
}
