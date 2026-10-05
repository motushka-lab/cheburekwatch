# CheburekWatch V4

- Authoritative room playback state with server timestamp.
- Remote pause/play/seek reconciliation for direct video and YouTube.
- Watch time persisted in seconds; 20 minutes = 1 level.
- Heartbeat every 5 seconds with stale-tick protection.
- Persistent Telegram-style message reactions with toggle state.
- In-player chat overlay usable in fullscreen.
- Mobile responsive layout and PWA manifest.
- Creator button placeholder.
- Room deletion retained for owner.

VK iframe playback controls remain subject to VK embed API/browser permissions; room state is still authoritative, but exact programmatic seeking can depend on the embedded player's API.
