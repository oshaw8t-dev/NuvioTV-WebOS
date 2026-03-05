# Changelog

All notable changes to **NuvioTV webOS** will be documented in this file.

---

## [1.0.1-beta] - 2025-03-04

### First public beta release 🎉

#### Core features
- QR code login and sync-code authentication via Nuvio account
- Home screen with sidebar navigation, hero carousel, catalog rows and Continue Watching section
- Classic and Grid home layout options
- Detail screen for movies and series (hero, ratings, cast, episode list)
- Stream chooser with source/filter selection (no auto-play on entry)
- Video player with pause overlay, subtitle selection, next-episode overlay
- Library screen (saved titles)
- Search and Discover screen
- Plugin/Addon manager with remote sync
- Settings: theme selector, playback options, focus accent color
- Profile selection screen

#### Backend / Sync
- Profile sync via Supabase RPC with legacy fallback
- Addon and plugin sync with remote-empty preservation (prevents accidental local wipe)
- Saved library sync with timestamp-based merge (local + remote)
- Watched items sync with per-item timestamp merge
- Watch progress sync (merge-first pull, safer fallback push)

#### webOS / TV-specific
- Full remote control navigation via webOS input handler
- Focus engine with TV-friendly scroll behavior (card rows scroll only on bounds exit)
- webOS system integration (back button, app lifecycle)
- Resolution: 1920×1080

#### Known limitations (beta)
- Cast detail screen navigation not yet complete
- Settings not yet split into dedicated sub-screens (Android parity pending)
- Player side panels (subtitle delay, display mode overlays) not yet ported
- "More Like This" and company logos on detail screen pending
- Home layout transitions and focus restore edge cases still being refined

---

## Upcoming

- Full settings sub-screens (Appearance, Playback, Trakt, About, Debug)
- Player display mode overlays and richer track dialogs
- Cast detail routing
- Classic/Modern/Grid home transition parity with Android
