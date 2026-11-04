import type { AnchorHTMLAttributes, ButtonHTMLAttributes } from "react";

export type ButtonVariant = "default" | "primary" | "danger" | "quiet";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  /** Disabled with a busy cursor while an action runs. */
  busy?: boolean;
}

/** A button in the shared look; `type` defaults to "button", not "submit". */
export function Button({ variant = "default", busy = false, className, disabled, type, ...rest }: ButtonProps) {
  return (
    <button
      type={type ?? "button"}
      className={["p2c-button", `p2c-button-${variant}`, className].filter(Boolean).join(" ")}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      {...rest}
    />
  );
}

export interface ButtonLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  variant?: ButtonVariant;
}

/** A link in the button look, such as a download in a row of buttons. */
export function ButtonLink({ variant = "default", className, children, ...rest }: ButtonLinkProps) {
  return (
    <a className={["p2c-button", `p2c-button-${variant}`, className].filter(Boolean).join(" ")} {...rest}>
      {children}
    </a>
  );
}
