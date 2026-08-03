# IRON CIRCUIT design system

Version 0.9, D1 leaning, 2026-08-03. Built for a phone-first installed PWA and an N-player rivalry.

## Principles

1. **Set speed wins.** A logged set must take one thumb and one tap after numbers are entered.
2. **Arcade in the hierarchy, not in the way.** Pixel display type and sprites mark moments. Dense controls use a condensed system face.
3. **One live threat.** Lime means ready or earned. Red means urgency, destructive action, or opponent pressure. Never compete both at full intensity in the same component.
4. **The room is dark.** The interface must remain readable at arm's length in a dim gym without blooming into glare.
5. **Every player has a color, never color alone.** Player tokens always include initials, rank, or avatar pattern.

## Color tokens

| Token | Hex | Use |
|---|---:|---|
| `ink-950` | `#070A0C` | App background |
| `steel-900` | `#10161A` | Cabinet cards and sheets |
| `steel-800` | `#182126` | Raised controls |
| `steel-650` | `#34434A` | Borders and disabled controls |
| `fog-400` | `#8FA3AA` | Secondary text, 7.55:1 on ink |
| `white-050` | `#F4F7F2` | Primary text, 18.37:1 on ink |
| `volt-400` | `#C7FF2E` | Player 1, earned, primary action, 16.80:1 on ink |
| `rage-500` | `#FF3B30` | Player 2, danger, rival pressure, 5.60:1 on ink |
| `ice-400` | `#49C6FF` | Player 3, info, proof and coach |
| `gold-400` | `#FFCF40` | Trophies, PR, rare rewards |
| `violet-400` | `#B48CFF` | Boss battle and seasonal event |

Interactive text on colored fills defaults to `ink-950`. White on rage is 3.28:1 and is reserved for bold button or navigation labels at 16px or larger. Ink on rage is 5.60:1 and is preferred for dense text. Never place fog text on steel-650. Decorative CRT glows may use alpha, but text and control borders use solid tokens.

## Typography

| Role | Stack | Size and line height | Notes |
|---|---|---|---|
| Pixel display | `"Arial Black", Impact, Haettenschweiler, sans-serif` | 32/0.95 to 64/0.9 | Use `font-variant-numeric: tabular-nums`; apply block shadow to simulate a cabinet marquee |
| Condensed heading | `Impact, Haettenschweiler, "Arial Narrow Bold", sans-serif` | 18/1 to 28/1 | Uppercase, `0.045em` tracking |
| UI and body | `-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif` | 16/1.35 | System embeddable and fast |
| Numeric input | `"Arial Narrow", "Roboto Condensed", sans-serif` | 28/1 | Tabular, minimum 16px even in compact states |
| Micro label | UI stack, 700 | 12/1.1 | Uppercase, `0.12em`, never carries the only essential meaning |

Google font enhancement: `Press Start 2P` for display only and `Barlow Condensed` for headings and numbers. The fallback design remains intentional if fonts fail offline.

## Layout and spacing

- Canvas maximum: `520px`, centered. Full bleed background.
- Safe-area padding: top `max(12px, env(safe-area-inset-top))`; bottom nav includes `env(safe-area-inset-bottom)`.
- Spacing scale: `4, 8, 12, 16, 20, 24, 32, 40` px.
- Default screen gutter: `16px`.
- Minimum tap target: `48px`. Destructive or mid-set targets: `56px`.
- Primary thumb zone: bottom 35 percent of viewport. Finish remains below workout content, never beside set logging.
- Corners: 0, 4, or clipped 10px chamfers. No pills except small status lamps.
- Border: 2px standard, 3px focused, 4px marquee or boss event.
- Shadows: hard offset only. `4px 4px 0 #000` for controls and `6px 6px 0 rgba(0,0,0,.55)` for cards. No blurred elevation.

## Surface language

Cards use a steel fill, a 2px border, and clipped top-right and bottom-left corners. A 4px colored rail declares state. The cabinet screen may use a subtle CSS grid at 16px intervals at no more than 4 percent opacity. Scanlines are allowed only in decorative headers, never over inputs, timers, or body copy.

## Components

### Buttons

| Variant | Visual | Use |
|---|---|---|
| Primary | Volt fill, ink text, 56px high, 3px black bottom shadow | Log set, accept challenge, finish step |
| Rival | Rage fill, white text | Throw down, destructive or pressure action |
| Secondary | Steel fill, white text, steel-650 border | Film, details, filters |
| Ghost | No fill, fog text, 48px high | Skip, undo, low-risk utilities |
| Boss | Violet frame, white text, animated corner lamps | Enter shared workout |

Pressed: translate `2px 2px`, shadow collapses. Focus-visible: 3px solid ice with 3px offset. Disabled: steel-800 fill, fog at 65 percent, no shadow. Loading: label stays visible and a three-segment meter loops after it.

### Cards

- Exercise card: one per active viewport. Name, prescription, set grid, proof action.
- Receipt row: collapsed exercise, 52px minimum, name left and completion right.
- Score card: rank, initials, score, delta, and metric breakdown.
- Feed card: 3px player rail, timestamp, action verb, points.
- Reward card: gold rail, badge sprite, criteria, progress meter.

### Inputs and set rows

- Every input is at least 16px, preferably 28px for weight and reps.
- A set row is 64px active and 48px complete.
- Columns: set number 36px, weight flexible, reps flexible, LOG 72px.
- The previous set is prefilled but visually labeled `LAST`, never mistaken for a new entry.
- Completed rows invert to white text on steel-800 with a lime check. Tapping the row reopens it. No tiny edit icon.
- Validation occurs in place. Empty reps blocks logging. Empty weight is allowed for bodyweight work.

### Tabs and navigation

- Bottom destinations: TRAIN, FUEL, RIVALRY, VAULT.
- TRAIN is 1.25 times the width of other tabs and receives a filled state when a session is live.
- Within scoreboard: segmented DAY, WEEK, MONTH control, 48px high.
- Tabs use text plus a simple 8px status block. Never icon-only.

### Sheets

- Rest timer: fixed bottom sheet above nav, 38 percent viewport minimum, red progress rail, huge tabular time, `+30` and `SKIP` controls.
- Challenge detail: full-height sheet with opponent, window, score rule, proof policy, accept action pinned above the safe area.
- Confirmation: inline panel first. Modal only for destructive loss of logged work.

### Timer

- Digits: clamp from 72px to 112px based on viewport height.
- Remaining time owns at least 55 percent of the sheet width.
- Progress drains from right to left, matching the loss of rest time.
- Under 10 seconds, red border flashes at 2Hz. The digits do not move or scale.
- At zero, sheet flips to volt and reads `TIME. MOVE.` for 1.8 seconds.

### Score and ranking

- Score is always shown with its period: `WEEK 32 · 684 PTS`.
- Rank changes carry arrows and signed deltas. The table never reorders while the player is touching it.
- Breakdown labels: WORK, FUEL, PROGRESS, BONUS. WHOOP can only appear under BONUS.
- Ties share rank and show the next deciding metric in plain language.

### Boss battles and player challenges

- Boss battle uses violet and a full-width event marquee.
- Player challenge uses the issuer's player color.
- Every event shows deadline, target, scoring rule, safety substitution path, and proof rule before acceptance.
- Proof has three states: NOT REQUIRED, OPTIONAL, REQUIRED BY EVENT. Never imply footage is shared if it is private.

### Trophy case

- Permanent badges use gold.
- Seasonal badges use violet and retain a season label after expiry.
- Locked rewards remain named but desaturated. Hidden rewards show `???` and no criteria only when surprise is intentional.
- Badge rarity: COMMON, HARD, FILTHY, LEGENDARY. Rarity is copy plus border pattern, never color alone.

### Fuel

- Per-player targets are presented as their own rule card, not a universal macro template.
- Photo logging is the primary action. Quick-add remains below it.
- Adherence score and nutrient value are separate numbers to avoid pretending all plans are protein-only.

### Progress

- Seasonal contracts show each player's percent toward their own target, with the actual unit beneath.
- PRs use a gold score popup.
- Measurements and photos use explicit sharing state.
- Monthly showdown appears as an event card with the same rules as a boss battle.

## Accessibility and operating states

- All interactive text must meet 3:1. Normal body text targets 4.5:1.
- Respect `prefers-reduced-motion`: remove screen shake, sprite travel, flicker, and count-up. Retain instant state changes.
- Inputs must declare numeric input modes where appropriate.
- Use live regions for timer completion, score change, sync completion, and upload result.
- Never encode completion, player identity, or rank direction by color alone.
- Offline: show `LOCAL SAVE` in gold, continue logging, queue media, and avoid blocking finish.
- Sync failure: `QUEUED` plus a retry action. Never say data is lost unless the local write also failed.
- No session: preserve the rivalry and Fuel surfaces. TRAIN reads `COACH IS BUILDING THE NEXT ROUND`.

## Handoff mapping from the current app

| Current surface | New skin |
|---|---|
| Today and sealed workout | TRAIN cabinet, session marquee, `PRESS START` reveal |
| Exercise block and receipt lines | Active round card and round receipts |
| Rest bottom sheet | Red countdown cabinet drawer |
| Film button and Film Room | PROOF button and VAULT film review |
| Fuel strip and Fuel tab | FUEL power meter and per-player mission card |
| Progress | CONTRACTS, PR ladder, measurements, monthly showdown |
| Gear | VAULT equipment loadout |
| Cute zoo stamp | LOADOUT RECEIPT object comparison |
| Review, Progress, Train, Fuel, Gear nav | VAULT, PROGRESS content under VAULT, TRAIN, FUEL, RIVALRY |

## Copy guardrails

- Results can be profane. Safety instructions stay exact.
- Attack the behavior or scoreboard, never the player as a person.
- Avoid slurs, body shaming, food morality, and medical jokes.
- Keep every action label literal even when surrounding copy jokes.
