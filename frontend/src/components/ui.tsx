import type { ButtonHTMLAttributes, InputHTMLAttributes, PropsWithChildren } from "react";

export function Button({
  children,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button className={`button ${className}`.trim()} {...props}>
      {children}
    </button>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input className="input" {...props} />;
}

export function Field({
  label,
  htmlFor,
  hint,
  children
}: PropsWithChildren<{
  label: string;
  htmlFor: string;
  hint?: string;
}>) {
  return (
    <div className="field">
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {hint ? <span className="field-hint">{hint}</span> : null}
    </div>
  );
}

export function Alert({ children }: PropsWithChildren) {
  return (
    <div className="alert" role="alert">
      {children}
    </div>
  );
}

export function LoadingState({ label = "Working..." }: { label?: string }) {
  return (
    <span className="loading-state" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      {label}
    </span>
  );
}

export function Panel({ children }: PropsWithChildren) {
  return <section className="panel">{children}</section>;
}
