# Stint design system

Everything should feel like the left sidebar: soft tints instead of borders, 8–10px radius, 13.5px text, muted small labels. Demo: `/dev/ui` (Admin). Buttons: `buttons.md`.

## Tokens (`app/globals.css`, Tailwind names in brackets)

| Token | Value | Use |
|---|---|---|
| Spacing | 4px scale (Tailwind 1 = 4px) | Use 1, 2, 3, 4, 6 mostly |
| `--space-page` (`p-page`) / `--space-page-sm` (`p-page-sm`) | 24 / 16 | Page padding desktop / phone |
| `--space-section` (`gap-section`) | 24 | Between page sections |
| `--space-card` (`p-card`) | 16 | Inside cards |
| `--radius-sm/md/lg/xl` (`rounded-chip/row/control/card`) | 6 / 8 / 10 / 14 | chips / rows, nav / buttons, inputs / cards, panels |
| `--shadow-1/2/3` (`shadow-1/2/3`) | very subtle | resting card / hover / popover, modal |
| `--row` / `--row-compact` | 48 / 40 | Table row height |
| Colours | existing (`surface`, `surface2`, `accentSoft`…) | `surface2` = hover, `accentSoft`+`accentText` = selected |

## Borders

| Do | Don't |
|---|---|
| Separate with background (`bg` page, `surface` card, `surface2` hover) | Box every section in a border |
| Hairline `line` for table row dividers and page/top bar edges | Cell borders, double borders |
| `line2` only for inputs and outline buttons | `line2` on cards |

## Tables (`components/kit/Table.tsx`, CSS `.ui-table`)

| Part | Rule |
|---|---|
| `Table` | `label` required; card surface, `shadow-1`, scrolls inside |
| Header `Th` | Sticky, 11.5px uppercase muted, one hairline below |
| Rows `Tr` | 48px (40 compact), hairline divider only, hover `surface2`; `selected` = sidebar active look; `onOpen` makes the row clickable |
| Numbers | `Td numeric` / `Th numeric`: right-aligned, tabular figures |
| Status | `Pill` (compact) |
| `RowActions` | Hidden until hover on mouse; always visible on touch |
| Density | `useDensity()` + `ButtonGroup` "Comfortable / Compact" in the filters row; remembered per browser |

## Board (`BoardColumn` in `components/kit/PageHeader.tsx`, CSS `.ui-col`, `.ui-card`, `.ui-count`)

| Part | Rule |
|---|---|
| Column | `surface2` background, radius 14, no border |
| Column header | Like sidebar section label (12px muted) + count badge (`.ui-count`, `data-tone="bad"` = coral) |
| Card | `surface`, radius 10, `shadow-1`; `shadow-2` on hover only; selected = 2px accent ring |

## Page layout (`components/kit/PageHeader.tsx`)

| Part | Rule |
|---|---|
| `PageHeader` | Title 22px semibold, one-line description, `actions` top-right (one primary), `filters` row beneath |
| Filters | `Button size="sm" variant="quiet"` chips, `active` when on |
| `KpiCard` | Muted label, 26px number, optional hint with `tone`. 2 columns on phone, 4 on desktop |
| `EmptyState` (`kit/EmptyState`) | Title + one line + next action |
| Spacing | `p-page-sm md:p-page`, `gap-section` between blocks |

## Motion

| Rule |
|---|
| Press: scale 0.97, 120ms. Hover: colour only, 120–150ms. |
| No animation on keyboard-driven actions. Respect reduced motion. |
