# CheburekWatch V5

- Fixed API JSON handling: object request bodies are now serialized automatically.
- Fixed message reactions that were visually clickable but never reached the server.
- Added explicit room media endpoint + media SSE event + no-store API caching.
- New room members re-fetch authoritative media state, preventing the "no video" placeholder when a room already has media.
- Improved YouTube player initialization with `origin` and seek-change detection.
- Added responsive/mobile polish and dark chat inputs.
- Added full-screen chat overlay styling.
- Added Creator panel with the requested credits.
- The `armain` word is a hidden Creator Tools trigger. It is server-protected: only the owner of the current room can use it.
- Creator Tools can grant XP minutes, raise level, unlock all achievements, and unlock the secret `бэйби` prefix.
- Secret prefix is derived server-side and shown instead of the normal prefix when unlocked.
- Existing profile design remains the visual reference for the rest of the UI.
