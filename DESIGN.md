# Dayframe colour budget (색 예산)

Calm first: the eye should land on **overdue (if any) → task titles → everything else**. Structure (position, spacing,
size, weight, grey level) carries hierarchy; colour is a signal, not decoration. Tokens: `apps/mobile/src/theme/tokens.ts`.

## Rules (규칙)

1. **한 화면에 색은 두 가지까지** — the accent, plus red only when something is overdue or destructive.
2. **One meaning per colour.** Accent = tap me / selected / progress data. Red = overdue / destructive. Nothing else.
3. **One filled (solid accent) button per screen** — the FAB or one primary button. Everything else is `secondary`
   (neutral fill), `ghost` (no fill) or an outlined pill. `Button kind="danger"` is red text on a neutral fill.
4. **Status colour only as small marks** — icon, short text, dot, thin line. Never a card background, strip or band.
5. **No colour in reading text** except an overdue date (red) and an inline action link (accent).
6. **Priority is `!!!` / `!!` / `!`** before the title (bold, text colour), never a colour. Screen readers hear
   "우선순위 가장 높음/높음/보통" (`taskA11yLabel`).
7. **Structure before colour.** Fewer boxes: section headings + spacing + hairlines; no card inside a card; no badges
   that do not change a decision.
8. **Icons next to text are one step lighter** than the text (`textMuted` / `textFaint`), unless selected.
9. **One neutral temperature**: every grey is a faint cool tint (OKLCH hue ≈ 258°, chroma < 0.03). No #000 / #FFF text
   on dark.
10. **Dark mode is tuned separately**: accent chroma ≈ 83 % of light (Helmholtz–Kohlrausch), a lighter `accentText`
    for text/links, off-white text.
11. **Contrast floor**: text ≥ 4.5:1, icons/controls ≥ 3:1, on the real background (tested in `tokens.test.ts`).
12. **Grayscale check**: the order overdue → titles → meta must still read in a black-and-white screenshot.
13. **User colours live in one small mark.** List colours (muted 톤인톤 set, `listColors.ts`) only on the list icon in
    the 목록 tab and list pickers. Habit colours are stored but not drawn. Weekends are not coloured.

## Tokens by role (역할별 토큰)

| Role | Token | Light | Dark |
|---|---|---|---|
| Page / card | `background` / `surface` | `#FFFFFF` / `#FFFFFF` | `#15171A` / `#1D2024` |
| Neutral fill (inputs, secondary buttons, empty cells) | `surfaceMuted` | `#F3F5F8` | `#272B31` |
| Hairline | `border` | `#E6E9EE` | `#31353C` |
| Unchecked ring, input outline | `control` | `#868E9C` | `#7A8290` |
| Titles, task titles, `!!!` | `text` | `#1D2129` | `#E8EAED` |
| Meta, subtitles, group headings | `textMuted` | `#5C6675` | `#A0A7B2` |
| Counts, tags, completed, placeholders | `textFaint` | `#858E9C` | `#767E8B` |
| Filled button, FAB, checked, progress | `accent` | `#2B66E0` | `#3B6CD0` |
| Accent text / links / selected label | `accentText` | `#2B66E0` | `#82ADFE` |
| Selected chip background (only) | `accentSoft` | `#F0F4FD` | `#1D293F` |
| Text on accent | `onAccent` | `#FFFFFF` | `#F5F7FA` |
| Progress ramp (light → full) | `accentRamp` | 22 % / 50 % / 100 % accent over surface | same |
| Overdue, destructive | `danger` | `#CC3A2E` | `#F08074` |

Accent options: 파랑 (default), 청록, 보라, 슬레이트 (`palettes.ts`). Retired 주황/분홍/초록 read back as 파랑.

## Locked in code (코드로 잠금)

- Colours come **only** from `useTheme().colors`. Hex / `rgb()` / `hsl()` / alpha suffixes (`+ '2E'`) / named colours
  anywhere else in `apps/mobile/src` fail `npm test` (`src/theme/colorBudget.test.ts`, allow-list in `colorBudget.ts`:
  theme, accent and list palettes, stored habit colours, art maths, native widgets, notification colour).
- New role? Add a token in `tokens.ts` for both modes and a contrast assertion in `tokens.test.ts` first.
- Before reporting UI work: run the preview harness, light and `--dark`
  (`EXPO_OFFLINE=1 node scripts/preview/run.mjs --shots scripts/preview/calm-shots.mjs --out <dir> [--dark]` in
  `apps/mobile`), look at the shots, and count hues per screen (≤ 2).
