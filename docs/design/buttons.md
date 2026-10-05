# Buttons

Design language comes from the left sidebar (`components/Shell.tsx`).

| Sidebar value | Used for buttons |
|---|---|
| Row 36px, padding 10px × 6px, gap 10px | `md` 40px, `sm` 32px, gap 8px; hit area always ≥ 44px (`.btn::before`) |
| Radius 8px (`rounded-lg`), 10px on bigger controls | `sm`/`icon-sm` 8px, `md`/`lg` 10px |
| Text 13.5px; normal weight, active 600 | `md` 13.5px, `sm` 13px; filled buttons 600, others 500 |
| Icons 16px, stroke 1.8 | `leftIcon`/`rightIcon` 15–16px |
| Hover `bg-surface2`; active `bg-accentSoft text-accentText` semibold | `quiet` hover; `active` prop = the same pressed look |
| Section labels 12px medium `text-muted` | group labels in toolbars |
| Count badge: pill, 11px bold, accentSoft (coral when urgent) | use a `Pill`/badge inside the button, not a new variant |

## Which variant

| Variant | When | Example |
|---|---|---|
| `primary` | The one main action of a view (max one) | Save, Create lead |
| `cta` | Money or conversion moment, rare | Convert to student, Collect fee |
| `secondary` | Helpful but not the main action | Log call next to Save |
| `outline` | Normal action, Cancel | Cancel, Export |
| `quiet` | Toolbars, filters, menus; low emphasis | More, Filter, view toggles |
| `danger` | Destructive. Always ask to confirm (`kit/Confirm`) | Delete, Remove |
| `link` | Inline in text | "See all" |

## Sizes

| Size | Visual height | Use |
|---|---|---|
| `sm` | 32 | Dense tables, toolbars |
| `md` (default) | 40 | Forms, panels |
| `lg` | 44 | Phone sticky bar, hero actions |
| `icon-sm` / `icon` / `icon-lg` | 32 / 40 / 44 square | Icon-only (`IconButton`) |

## Placement

| Rule |
|---|
| Page header: main action top-right. |
| Forms: primary rightmost, Cancel just left of it. |
| Phones: primary full-width, sticky at the bottom (`Toolbar`). |
| Secondary actions on the left or in a "More" menu. |
| Max one `primary` per view. |
| Destructive actions always confirm first. |
| Icon-only buttons only via `IconButton` (needs `aria-label`, shows a tooltip). |

## Props

`variant`, `size`, `leftIcon`, `rightIcon`, `loading` (spinner, disabled, same width), `fullWidth`, `active` (pressed, sets `aria-pressed`). Plus `IconButton`, `ButtonGroup` (segmented), `Toolbar` (`start`, children, `primary`, `sticky`).

## Old → new

| Old | Now | Look |
|---|---|---|
| no variant / `ghost` | `outline` | unchanged: bordered surface button |
| `primary` | `primary` | unchanged |
| `cta` | `cta` | unchanged |
| `danger` | `danger` | unchanged, plus red tint on hover |
| — | `quiet` | new: borderless, sidebar-style hover |

Old buttons were 44px tall; default is now 40px visual with a 44px hit area. Demo: `/dev/ui` (Admin only).
