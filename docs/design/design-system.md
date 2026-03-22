# ACode Design System

## Style Direction

**Dark minimal + frosted glass, Xcode-inspired.**

Deep dark teal-navy base. The editor, pill bar, and terminal/Claude panel are **floating glass cards** with rounded corners (`12px`), semi-transparent backgrounds, and `backdrop-filter: blur(16px)`. The sidebar is a solid panel; the projects rail is a slim vertical strip of glass circle icons. Panels feel like they hover over the base layer.

Reference: Xcode dark theme, Robinhood desktop trading UI.

---

## Color Tokens

### Base
| Token | Value | Usage |
|---|---|---|
| `--bg-base` | `#0c1117` | App background |
| `--bg-panel` | `#111820` | Panel / sidebar background |
| `--bg-elevated` | `#161f2a` | Dropdowns, modals, hover states |
| `--bg-glass` | `rgba(255,255,255,0.04)` | Glass panel fill |

### Borders
| Token | Value | Usage |
|---|---|---|
| `--border-subtle` | `rgba(255,255,255,0.06)` | Panel edges, dividers |
| `--border-active` | `rgba(255,255,255,0.14)` | Focused/active panel border |

### Text
| Token | Value | Usage |
|---|---|---|
| `--text-primary` | `#e8edf2` | Main readable text |
| `--text-secondary` | `#8b97a6` | Labels, metadata, muted text |
| `--text-disabled` | `#4a5568` | Inactive / disabled |

### Accent
| Token | Value | Usage |
|---|---|---|
| `--accent-blue` | `#3b82f6` | Active tab, selection, cursor |
| `--accent-green` | `#22c55e` | Success, positive values |
| `--accent-red` | `#ef4444` | Error, negative values, destructive |
| `--accent-yellow` | `#eab308` | Warning |

---

## Typography

- **Font family**: System font stack — `Inter, -apple-system, BlinkMacSystemFont, sans-serif`
- **Editor font**: Monospace — `"JetBrains Mono", "Fira Code", "Cascadia Code", monospace`
- **Weights used**: 400 (body), 500 (labels), 600 (headings/emphasis)
- **Base size**: 13px for UI chrome, 14px for editor content

---

## Glassmorphism Rules

Keep the glass effect subtle:

```css
/* Panel glass */
background: var(--bg-glass);
border: 1px solid var(--border-subtle);
backdrop-filter: blur(8px);
-webkit-backdrop-filter: blur(8px);
```

- **Blur**: 8–12px max. More than that looks messy.
- **Fill**: `rgba(255,255,255,0.04)` — barely visible tint, not opaque.
- **Backdrop filter**: Only on floating elements (command palette, panels over the editor). Static panels skip the blur for performance.
- **No drop shadows** on flat panels. Use border-only separation.

---

## Component Patterns

### Tabs (editor tabs, top nav)
- Active tab: `--accent-blue` underline or background tint, `--text-primary`
- Inactive tab: no underline, `--text-secondary`
- No heavy pill backgrounds — keep them flat

### Panels / Sidebars
- Background: `--bg-panel`
- Border-right/left: `1px solid var(--border-subtle)`
- No box-shadow

### Floating / Overlay elements (command palette, dropdowns)
- Background: `--bg-elevated` with glass fill
- Border: `var(--border-active)`
- Blur backdrop: `blur(10px)`
- Subtle border-radius: `8px`

### Buttons
- Primary: `--accent-blue` fill, white text, no border
- Ghost: transparent fill, `--border-subtle` border, `--text-secondary` text
- Hover: lighten fill by ~10%, don't change border color

### Scrollbars
- Thin (`4px`), `--bg-elevated` track, `--border-active` thumb
- Only visible on hover

---

## Spacing & Layout

- Base unit: `4px`
- Panel padding: `12px` or `16px`
- Between sections: `8px` gap
- Sidebar width: `240px` (collapsible)
- Tab bar height: `36px`
- Status bar height: `24px`

---

## Editor-specific

- **Cursor**: thin `1px` beam, `--accent-blue`
- **Selection**: `rgba(59,130,246,0.2)` (blue at 20% opacity)
- **Active line**: `rgba(255,255,255,0.03)` — barely visible highlight
- **Line numbers**: `--text-disabled`
- **Gutter background**: same as `--bg-panel`
