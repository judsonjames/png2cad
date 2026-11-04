import { type KeyboardEvent, type ReactNode, useId, useRef } from "react";

export interface TabItem<Id extends string = string> {
  id: Id;
  label: ReactNode;
  /** Small text after the label, such as a camera's state. */
  note?: ReactNode;
  /** A color swatch before the label (a camera's color). */
  swatch?: string;
}

export interface TabsProps<Id extends string> {
  items: TabItem<Id>[];
  selected: Id;
  onSelect: (id: Id) => void;
  label: string;
  /** Prefix for the tab and panel ids; one is made when absent. */
  idPrefix?: string;
}

/**
 * Tabs with tab semantics: arrow keys move between tabs, Home and End jump,
 * and only the selected tab is in the tab order. Pair each tab with a
 * `TabPanel` using the same `idPrefix` and id.
 */
export function Tabs<Id extends string>({ items, selected, onSelect, label, idPrefix }: TabsProps<Id>) {
  const made = useId();
  const prefix = idPrefix ?? made;
  const list = useRef<HTMLDivElement>(null);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = items.findIndex((item) => item.id === selected);
    const next =
      event.key === "ArrowRight"
        ? (index + 1) % items.length
        : event.key === "ArrowLeft"
          ? (index - 1 + items.length) % items.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? items.length - 1
              : -1;
    if (next < 0 || !items.length) return;
    event.preventDefault();
    onSelect(items[next].id);
    list.current?.querySelectorAll<HTMLButtonElement>("[role=tab]")[next]?.focus();
  };
  return (
    <div className="p2c-tabs" role="tablist" aria-label={label} ref={list} onKeyDown={onKeyDown}>
      {items.map((item) => {
        const on = item.id === selected;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            id={`${prefix}-tab-${item.id}`}
            aria-selected={on}
            aria-controls={`${prefix}-panel-${item.id}`}
            tabIndex={on ? 0 : -1}
            className="p2c-tab"
            onClick={() => onSelect(item.id)}
          >
            {item.swatch && <span className="p2c-tab-swatch" style={{ background: item.swatch }} aria-hidden="true" />}
            <span>{item.label}</span>
            {/* The hidden comma keeps the name and note apart when read aloud ("wide, streaming"). */}
            {item.note && <span className="p2c-visually-hidden">, </span>}
            {item.note && <span className="p2c-tab-note">{item.note}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** The panel for one tab; hidden unless its tab is selected. */
export function TabPanel({
  idPrefix,
  id,
  selected,
  children,
}: {
  idPrefix: string;
  id: string;
  selected: string;
  children: ReactNode;
}) {
  return (
    <div
      role="tabpanel"
      id={`${idPrefix}-panel-${id}`}
      aria-labelledby={`${idPrefix}-tab-${id}`}
      hidden={id !== selected}
      className="p2c-tab-panel"
    >
      {id === selected ? children : null}
    </div>
  );
}
