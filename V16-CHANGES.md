# CheburekWatch V16

## Visual / homepage
- Reworked the hero toward the neon editorial cinema reference: deeper layered glow, glass controls, richer poster treatment and floating feature rail.
- Fixed the hero phrase `Одному — преступление.` so it no longer drifts/clips outside its column.
- On mobile the hero keeps the phrase readable and stacks the emphasis cleanly.
- Strengthened mobile navigation and responsive hierarchy.

## Mobile watch room
- The video/chat stage now uses the available viewport more efficiently.
- Chat gets substantially more usable vertical space.
- Participant rail is compressed to a thin horizontal strip.
- Splitter remains draggable with a larger touch target; video/chat proportions are still persisted.
- When a video is already loaded, the add-video form collapses to a compact `Сменить кино` control at the bottom instead of consuming a large block.
- Tapping that control expands the add-video form; submitting a new video collapses it again.
- The chat/message area remains independently scrollable and touch-friendly.
- Mobile layout uses `svh/dvh`-friendly sizing to behave better with browser chrome and the keyboard.

## Compatibility
- No new external assets or font/CDN dependencies added.
- Existing playback sync, SSE, room APIs and player integrations are preserved.
