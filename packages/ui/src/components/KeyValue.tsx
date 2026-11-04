import type { ReactNode } from "react";

export interface KeyValueItem {
  /** A stable key when the label is not plain text. */
  key?: string;
  label: ReactNode;
  value: ReactNode;
}

/** Facts as label and value pairs, such as a file's size and type (`<dl>`). */
export function KeyValue({ items }: { items: KeyValueItem[] }) {
  return (
    <dl className="p2c-key-value">
      {items.map((item, index) => (
        <div key={item.key ?? (typeof item.label === "string" ? item.label : index)} className="p2c-key-value-row">
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
