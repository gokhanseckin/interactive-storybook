# Library and book details

## Design direction

A small illustrated bookshelf for Turkish-speaking families. Painted covers carry
the visual character; quiet navigation keeps free listening easy to find.

Palette: lavender paper #F5F3FA, plum ink #302640, purple #695091,
forest green #214F43, butter yellow #F6D98B, muted text #756C82.
Georgia (system serif fallback on Android) for titles; system sans-serif for controls.
Left-aligned library and plot, centered cover presentation and book title.

Home → book details → listening player
                     → Premium information sheet

## Product rules represented

- Standard character names and listening are free.
- Premium is a monthly subscription with one story's name customization per month.
- The details page keeps both customization and listening actions visible.
- No price, purchase flow, entitlement, or personalized generation is fabricated.
  Premium is explicitly marked as coming soon until those services are implemented.
- The garden story plays the approved ElevenLabs edition. The kite story is marked
  coming soon and its listening button is disabled.
- The garden duration describes the current first two sections, not the full manuscript.

## Verification

TypeScript check and all 28 existing mobile tests passed. iOS export includes both
new cover illustrations. Simulator inspection covered home, book details, Premium
sheet open/close, listening entry, saved-progress prompt and return to library.
Subscription billing and entitlement enforcement are future implementation work.
