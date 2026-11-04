import type { ReactNode } from "react";
import { LogoMark } from "./LogoMark";

/**
 * The top of every page: the product name, the page's place, and the navigation.
 * The name can carry a product word in the accent color.
 */
export function AppHeader({
  brand = "png2cad",
  product,
  brandHref,
  subtitle,
  children,
}: {
  brand?: string;
  /** The product word after the brand, drawn in the accent color. */
  product?: string;
  /** Where the product name leads (the overview), if anywhere. */
  brandHref?: string;
  subtitle?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="p2c-app-header">
      <div className="p2c-brand-row">
        <LogoMark />
        <div className="p2c-brand">
          {brandHref ? (
            <a className="p2c-brand-name" href={brandHref}>
              <BrandName brand={brand} product={product} />
            </a>
          ) : (
            <span className="p2c-brand-name">
              <BrandName brand={brand} product={product} />
            </span>
          )}
          {subtitle && <span className="p2c-brand-subtitle">{subtitle}</span>}
        </div>
      </div>
      {children}
    </header>
  );
}

/** The brand, then the product word in the accent color. */
export function BrandName({ brand = "png2cad", product }: { brand?: string; product?: string }) {
  return (
    <>
      {brand}
      {product && (
        <>
          {" "}
          <span className="p2c-brand-product">{product}</span>
        </>
      )}
    </>
  );
}

export interface NavItem {
  href: string;
  label: string;
}

/** Links between pages; the current one is marked for screen readers and styled. */
export function NavLinks({ items, current, label = "Pages" }: { items: NavItem[]; current: string; label?: string }) {
  return (
    <nav className="p2c-nav" aria-label={label}>
      {items.map((item) => (
        <a key={item.href} href={item.href} aria-current={item.href === current ? "page" : undefined}>
          {item.label}
        </a>
      ))}
    </nav>
  );
}

export interface SectionNavItem {
  id: string;
  label: ReactNode;
  /** A link target (`#network`); without one the item is a button for `onSelect`. */
  href?: string;
  /** Small text after the label, such as a section's summary or a count. */
  note?: ReactNode;
}

/**
 * A vertical list of a page's sections, the
 * current one marked with `aria-current`. Items are links when they have an
 * `href`, otherwise buttons that call `onSelect`.
 */
export function SectionNav({
  items,
  current,
  onSelect,
  label = "Sections",
}: {
  items: SectionNavItem[];
  current: string;
  onSelect?: (id: string) => void;
  label?: string;
}) {
  return (
    <nav className="p2c-section-nav" aria-label={label}>
      <ul>
        {items.map((item) => {
          const body = (
            <>
              <span>{item.label}</span>
              {item.note && <span className="p2c-section-nav-note">{item.note}</span>}
            </>
          );
          const on = item.id === current;
          return (
            <li key={item.id}>
              {item.href ? (
                <a href={item.href} aria-current={on ? "location" : undefined} onClick={() => onSelect?.(item.id)}>
                  {body}
                </a>
              ) : (
                <button type="button" aria-current={on ? "true" : undefined} onClick={() => onSelect?.(item.id)}>
                  {body}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * Page tabs drawn like the nav links, for an app that switches views itself
 * instead of loading pages.
 */
export function NavTabs<T extends string>({
  items,
  current,
  onSelect,
  label = "Views",
}: {
  items: { id: T; label: string }[];
  /** The open tab, or null when the open view is not one of them (a gear's Settings). */
  current: T | null;
  onSelect: (id: T) => void;
  label?: string;
}) {
  return (
    <nav className="p2c-nav" aria-label={label}>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          aria-current={item.id === current ? "page" : undefined}
          onClick={() => onSelect(item.id)}
        >
          {item.label}
        </button>
      ))}
    </nav>
  );
}
