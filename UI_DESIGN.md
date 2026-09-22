# UI_DESIGN.md — REVORA Design System

## 0. Design Philosophy

REVORA is **financial infrastructure with intelligent autonomy** — not
an AI chatbot wrapped around a dashboard. Every screen must make three things
instantly legible and visually distinct from each other:

1. **Money** (at risk / recoverable / recovered) — the outcome layer.
2. **AI reasoning** (probability, diagnosis, recommendation) — the intelligence layer.
3. **Policy control** (limits, blocks, escalation) — the governance layer.

If a component doesn't clearly belong to one of those three layers, it doesn't
belong on Mission Control. Color, in this system, is not decoration — it is
how the user tells the three layers apart at a glance. See §3.

**Reference aesthetics** (conceptual, not literal copies):
- **Stripe Dashboard** — information hierarchy, financial-product credibility, restraint.
- **Linear** — density, interaction quality, sophisticated dark UI, keyboard-first feel.
- **Fintech / infra control rooms** — live activity, status indicators, "the system is working" feeling.

The attached reference image is the visual blueprint for density, composition,
and panel language. This file makes it implementation-exact.

---

## 1. Color System

All colors are HSL-derived for consistent contrast; hex given for direct use.
Never use a raw color name in code — always reference the token.

### 1.1 Base / Surface (near-black navy, NOT pure black)

| Token | Hex | Use |
|---|---|---|
| `bg-canvas` | `#080B12` | App background |
| `bg-surface` | `#0F141F` | Sidebar, header |
| `bg-panel` | `#131A26` | Cards / panels |
| `bg-panel-raised` | `#171F2D` | Nested panel, drawer background |
| `bg-panel-hover` | `#1A2333` | Hover state on interactive panel |
| `border-subtle` | `#1E2733` | Default panel border |
| `border-strong` | `#2A3646` | Emphasized border (active nav, focused input) |
| `border-divider` | `#182130` | Hairline separators inside panels |

### 1.2 Text

| Token | Hex | Use |
|---|---|---|
| `text-primary` | `#F3F6FB` | Headlines, financial numbers |
| `text-secondary` | `#A7B2C3` | Body copy, labels |
| `text-muted` | `#6C7789` | Metadata, timestamps, helper text |
| `text-disabled` | `#454E5E` | Disabled controls |

### 1.3 Primary — Electric Indigo/Blue (system, navigation, Razorpay-adjacent)

| Token | Hex |
|---|---|
| `primary-100` | `#DCE3FF` |
| `primary-300` | `#8FA3FF` |
| `primary-500` | `#4F6EF7` (base) |
| `primary-600` | `#3B57DE` |
| `primary-700` | `#2C42B0` |
| `primary-muted-bg` | `#161E3A` |

### 1.4 AI / Intelligence — Violet

| Token | Hex |
|---|---|
| `ai-100` | `#E6DEFF` |
| `ai-300` | `#B69AFF` |
| `ai-500` | `#8B5CF6` (base) |
| `ai-600` | `#7440E0` |
| `ai-700` | `#5B2FB3` |
| `ai-muted-bg` | `#211A3D` |

### 1.5 Recovery / Success — Emerald

| Token | Hex |
|---|---|
| `success-100` | `#D3FBE9` |
| `success-300` | `#5FE3AD` |
| `success-500` | `#10B981` (base) |
| `success-600` | `#0C9268` |
| `success-muted-bg` | `#0E241C` |

### 1.6 Revenue at Risk — Coral/Red

| Token | Hex |
|---|---|
| `risk-100` | `#FFE1E3` |
| `risk-300` | `#FF8A8F` |
| `risk-500` | `#F5484F` (base) |
| `risk-600` | `#D42F38` |
| `risk-muted-bg` | `#2B1418` |

### 1.7 Warning — Amber (needs attention, not yet blocked/failed)

| Token | Hex |
|---|---|
| `warning-300` | `#FFD37A` |
| `warning-500` | `#F5A623` (base) |
| `warning-muted-bg` | `#2B2110` |

### 1.8 Semantic Color Mapping — DO NOT VIOLATE

- **Red/coral** → money at risk, blocked action, policy violation.
- **Violet** → AI reasoning, recommendation, "Recovery Brain," Copilot.
- **Emerald** → recovered money, successful intervention, policy status "Active/Allowed."
- **Amber** → escalation queue, "needs merchant attention," suppressed-but-not-blocked.
- **Indigo/blue** → navigation, system chrome, neutral data, live status.

A component gets **one** semantic accent color, chosen by which layer it
belongs to (§0). Never mix two accent colors on one card to "make it pop."
Never use violet for anything that isn't literally an AI-generated
recommendation or explanation.

---

## 2. Typography

**UI typeface:** Geist Sans (fallback: `-apple-system, "Segoe UI", Roboto, sans-serif`).
**Numeric/tabular typeface:** Geist Mono (fallback: `"IBM Plex Mono", ui-monospace, monospace`)
— used for **all currency figures, timestamps, transaction IDs, percentages,
and the audit ledger.** This is what gives financial numbers their
"infrastructure" feel instead of looking like a marketing stat. Never set a
₹ amount in the sans typeface.

Do not use Inter. Do not introduce a display/serif font.

### Type Scale

| Token | Size / Line-height | Weight | Use |
|---|---|---|---|
| `display-lg` | 40px / 44px | 600 | Hero KPI numbers (₹18.42L) |
| `display-sm` | 28px / 34px | 600 | Secondary KPI numbers, drawer headline amount |
| `heading-lg` | 20px / 28px | 600 | Panel titles ("Mission Control", "Recovery Brain") |
| `heading-sm` | 15px / 22px | 600 | Card/section titles |
| `body-md` | 14px / 20px | 400 | Default body copy |
| `body-sm` | 13px / 18px | 400 | Secondary copy, descriptions |
| `label` | 12px / 16px | 500, uppercase, +0.04em tracking | Field labels, table headers, KPI captions |
| `mono-lg` | 22px / 28px | 500 | Amounts inside cards/opportunity rows |
| `mono-sm` | 12px / 16px | 400 | Timestamps, transaction IDs, ledger rows |

---

## 3. Spacing & Layout

Base unit: **4px**. Scale: `4, 8, 12, 16, 24, 32, 48, 64, 96`.

- Panel internal padding: `16` (dense panels) or `24` (primary KPI cards).
- Gap between panels in a grid: `16`.
- Sidebar width: `240px` expanded / `72px` collapsed.
- Right drawer (Transaction Deep Dive): `440px` fixed, full-screen on mobile/tablet.
- Max content width: none — this is a desktop operational tool; content fills
  the viewport in an asymmetric grid, not a centered max-width column.

### Radius Scale (restrained — this is infrastructure, not a consumer app)

| Token | Value | Use |
|---|---|---|
| `radius-sm` | 6px | Buttons, inputs, badges |
| `radius-md` | 8px | Cards, panels |
| `radius-lg` | 12px | Drawer, modal |
| `radius-pill` | 999px | Status pills only (e.g. "Active", "Live") |

Never round a panel more than `radius-md`. No pill-shaped cards.

### Shadows — minimal, used only for elevation above the base plane

- `shadow-panel`: `0 1px 2px rgba(0,0,0,0.24)` — barely-there, for card separation.
- `shadow-drawer`: `0 8px 32px rgba(0,0,0,0.48)` — the right-side drawer only.
- No shadow on hover-only states; use `border-strong` + `bg-panel-hover` instead.

### Borders

1px solid `border-subtle` on every panel by default. On focus/active/selected,
switch to 1px `border-strong` — do not add a glow or outer ring.

---

## 4. Components

### Buttons
- **Primary** (`Execute Action`, `Retry Now`): `primary-500` bg, `text-primary` text, `radius-sm`, 14px/500 weight, 10px vertical / 16px horizontal padding.
- **Destructive-adjacent** (`Escalate`, `Escalate Instead`): outlined `risk-500` border, `risk-300` text, transparent bg; fills solid `risk-500` only on hover.
- **Secondary** (`Send Reminder`, `View all`): `border-subtle` outline, `text-secondary`, transparent bg.
- Never use a gradient fill on a button.

### Status Pills
Small `radius-pill`, 11px uppercase label, colored dot + colored text on a
`*-muted-bg` background matching the semantic category (Active = success,
Blocked = risk, Escalated = warning, Live = primary).

### Cards / Panels
`bg-panel`, `border-subtle`, `radius-md`, `16–24px` padding. Title in
`heading-sm`, optional subtitle in `body-sm text-muted` directly beneath.
Panels are **not uniform-height in a grid** — Revenue Leak Breakdown and
Recovery Brain are visually heavier than the KPI row; size communicates
importance (§ "Design Principle" from brief — no `CARD/CARD/CARD/CARD` rows).

### Tables (Audit Ledger, Transactions)
Row height 40–48px, `mono-sm` for timestamp/ID/amount columns, `body-sm` for
descriptive columns, `border-divider` hairlines only (no cell borders,
no zebra striping — striping reads as "generic admin table").

### Charts
- **Donut** (Revenue Leak Breakdown): 8–10px stroke, semantic category colors, total in `display-sm` mono centered.
- **Sparkline** (KPI trend): single-color line matching card's semantic accent, no axis, no gridlines, 32–40px tall.
- **Ring** (recovery probability, e.g. 82%): stroke matches the *action's* semantic outcome (success green if the AI recommendation is proceeding, risk red if blocked).
- No 3D, no drop shadows on chart elements, no decorative gradients under bars.

### Recovery Brain / AI panels
Represent "intelligence" with a restrained node/network line-art motif in
`ai-500` at low opacity as a background texture — never a glowing orb, never
a floating 3D brain render used as the primary visual. The reference image's
brain icon should read as a small icon-level motif, not the dominant visual
element of the panel.

### Action Blocked panel
Full `risk-muted-bg` panel, `risk-500` left border accent (4px), triangle/alert
icon in `risk-500`. Structure exactly as in the brief: Reason → "What would
happen if we ignored this" counterfactual → explicit confirmation line
("Policy protected customer and merchant") in `success-300` → single
`Escalate Instead` button. This panel's job is to make the block feel like a
*feature firing correctly*, not an error state — no red flashing, no siren
iconography, just calm, confident color-coding.

---

## 5. Motion

Motion communicates **system state and cause/effect**, never decoration.

| Event | Motion |
|---|---|
| Scan | Transaction count increments rapidly (150–400ms per batch tick), leak-type bars fill in sequence, not simultaneously |
| KPI reveal | Numbers count up over ~600ms with ease-out, not a spring/bounce |
| Recovery execution | Each action appears in Live Activity feed via a 200ms slide-in + fade, newest on top |
| Recovered amount increment | The KPI ticks upward in place — do not re-render/flash the whole card |
| Policy block | The attempted action visibly moves toward "Execute" then is intercepted — a short (300ms) horizontal stop/deflect, landing on the red Action Blocked state. This is the single most important animation in the product. |
| Success confirmation | A single checkmark fade-in, no confetti, no bounce |

Durations: 150–400ms, `ease-out` for reveals, `ease-in-out` for state
transitions. Respect `prefers-reduced-motion`: disable count-up/slide-in,
keep instant state changes with color/icon only.

Banned: floating particles, animated gradient blobs, bouncing/springy
easing, looping ambient animation on idle panels, confetti.

---

## 6. Iconography

Line icons only (Lucide or Phosphor, regular weight, 18–20px), never filled
icons except for status dots. Icons are always paired with a text label or
color — never color-alone or icon-alone to convey status (accessibility).

---

## 7. Accessibility

- Minimum contrast: 4.5:1 for body text, 3:1 for large/display text — verify
  every text-on-`bg-panel` pairing above against these tokens.
- Every status pill/badge carries text, not just color (e.g. "● Blocked", not a bare dot).
- All interactive elements reachable via keyboard; visible focus = 2px
  `primary-300` outline, 2px offset — never remove `:focus-visible`.
- Charts/rings must have an adjacent numeric label — never chart-only.
- Motion respects `prefers-reduced-motion` (§5).

---

## 8. Responsive Behavior

- **Desktop (≥1280px):** full command-center grid as specified, sidebar expanded.
- **Laptop (1024–1279px):** sidebar auto-collapses to icon rail (72px); KPI
  row stays 3-across; secondary grid drops from 3 to 2 columns.
- **Tablet (768–1023px):** single-column stacked panels in priority order
  (KPIs → Revenue Leak Breakdown → Recovery Brain → Top Opportunities →
  Live Activity → Simulator/Policy/Copilot → Audit Ledger); Transaction Deep
  Dive becomes a full-screen sheet, not a 440px drawer.
- **Below 768px:** not a target for this hackathon (merchant ops tool); show
  a "best viewed on a larger screen" notice rather than attempting a broken layout.

---

## 9. Explicit Ban List

Do not use, under any circumstance:

- Default shadcn gray palette / unstyled shadcn primitives
- Inter as the UI typeface
- Centered hero + gradient blob
- Giant glowing AI orb as a primary interactive element
- Full-height "AI Copilot chat window" taking up half the screen
- Glassmorphism (frosted blur panels)
- Pill-shaped cards or excessive corner radius (>12px on panels)
- Rainbow gradients / purple gradient applied to every component
- 3D illustrations or stock illustration art
- Generic robot imagery
- "AI magic" / "✨" copy and emoji-as-UI
- Huge empty hero sections
- Zebra-striped generic admin tables
- 3D or decorative charts, unnecessary chart axes
- Random ambient particle animation
- Neon/crypto-terminal color overload
- Equal-size `CARD / CARD / CARD / CHART / CARD` grid layouts with no visual hierarchy
