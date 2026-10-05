# CheburekWatch V6

- Fixed JSON body serialization globally in the client API helper. This fixes reactions and Creator Tools.
- Chat submit uses object bodies through the fixed API helper and explicit `preventDefault`, so the overlay form no longer reloads the page.
- Playback state is authoritative on the server and broadcast via SSE. Pause and seek are sent immediately; play is lightly debounced.
- Heartbeat now also returns the authoritative room state as a fallback when SSE reconnects.
- Added sequence numbers to playback state to make room state monotonic.
- Creator card moved to the main rooms screen; Creator Tools remain restricted to the room owner.
- Unified the profile-inspired dark burgundy/glass/glow style across cards, buttons, chat, video and home sections.
