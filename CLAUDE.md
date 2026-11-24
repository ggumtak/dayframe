@DESIGN.md

- Follow DESIGN.md for every UI change: theme tokens only, at most two hues per screen, one filled button per screen.
- Never hard-code a colour in `apps/mobile/src`; `npm test` (colorBudget.test.ts) fails if you do.
- Before reporting UI work, run the preview harness in `apps/mobile` (`scripts/preview/README.md`), light and `--dark`,
  and look at the screenshots yourself.
- Before finishing, run `npm run typecheck`, `npm run lint` and `npm test` in `apps/mobile`.
