# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the Game

No build step — open `index.html` directly in a browser. There is no dev server, bundler, or package manager.

## Architecture

This is a vanilla JS + HTML5 Canvas game with no dependencies. All game logic lives in `tetris.js` as module-level globals; there is no bundling or module system.

**Data model:**
- `board` — 2D array `[ROWS][COLS]` where each cell is either `0` (empty) or a piece ID (1–7)
- `piece` / `nextPiece` — objects with `{ id, matrix, x, y }` where `matrix` is the current rotation state
- Piece IDs are indices into both `COLORS` and `PIECES` (1-indexed; index 0 is null)

**Game loop:** `requestAnimationFrame`-driven. Each tick computes `delta` since last drop; when `delta >= dropInterval` the piece moves down one row. Drawing and input handling are synchronous within the same loop.

**Key invariant:** `isValid(mat, ox, oy)` is the single source of truth for all collision — movement, rotation, and lock all go through it. Wall-kick offsets `[0, 1, -1, 2, -2]` are tried in order during rotation.

**Overlay pattern:** The `#overlay` div toggles `.hidden` class to show start screen, pause, and game over — `startBtn` text changes to match the current state ("Start Game" → "Play Again"; "Resume" when paused).

**Scoring:** `LINE_SCORES[cleared] * level`; soft drop +1/row, hard drop +2/row. Level = `floor(lines/10) + 1`; `dropInterval` decreases 90ms per level, floored at 100ms.
