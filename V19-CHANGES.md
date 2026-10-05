# V19 — ABSOLUTE CINEMA / THE RED CARPET CUT

- Fixed the home hero headline containment so the main phrase cannot drift horizontally outside its grid column.
- Hardened desktop/tablet/mobile hero sizing with `minmax(0, ...)`, explicit width/min-width rules, and zero horizontal offsets.
- Reworked the home background into a deeper red-night cinematic field with moving grid, ambient light, dust and projector streaks.
- Added richer hero depth, poster sheen, controlled headline glow and cinematic atmosphere.
- Rebuilt the intro as an animated opening title: curtains, red light beams, grid, noise, logo pulse, title reveal, CTA sheen, progress bar and smooth exit.
- Intro remains session-scoped and can be skipped by pressing the CTA; it auto-closes after 4.2 seconds.
- Bumped frontend cache versions to V19.
- Existing watch-party sync/player/chat logic was left intact.
