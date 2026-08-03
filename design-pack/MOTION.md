# Motion, haptics, and celebration

Motion has one job: make state change unmistakable without slowing a set.

## Timing tokens

- `snap`: 90ms, button press and row confirmation.
- `quick`: 160ms, card change and score popup.
- `round`: 280ms, exercise transition and sheet entry.
- `victory`: 700ms, badge or PR reveal.
- Easing: `cubic-bezier(.2,.8,.2,1)` for entry; linear only for the timer drain.

## Workout mode

- LOG press collapses its hard shadow immediately, then the row flashes lime for 90ms and compacts to the completed height.
- `+XP` rises 24px beside the button and disappears in 500ms. It never blocks the next input.
- The next incomplete set receives a single 160ms ice outline. No pulsing afterward.
- Moving to the next exercise slides the old card 12px left and the new card 12px in from the right. Total 220ms.
- Film upload animates a three-segment meter. Success locks the camera block to lime and reads `PROOF IN`.

## Rest timer

- Sheet rises in 180ms after a set is logged. Timer starts immediately, not after the animation.
- The red top rail drains continuously. Digits remain fixed to avoid visual jitter.
- At 10 seconds: one medium haptic and red edge flash.
- At 3, 2, 1: short haptic on each second.
- At zero: `[180, 80, 180]` vibration when supported; sheet flips lime and reads `TIME. MOVE.` for 1.8 seconds.
- `+30`: one short haptic and a `+30` score-style popup. `SKIP`: no celebration, one low haptic.

## Rivalry

- Score updates count only the changed digits for 280ms.
- A lead change stamps `LEAD STOLEN` over the affected two rows for 700ms, then reorders after touch input has ended.
- Feed events enter once from the bottom by 8px. New items do not bounce forever.
- W-L changes flip one block like a mechanical scoreboard.

## Wins, PRs, and trophies

- Normal session finish: 300ms cabinet flash, object sprite drops 12px into the LOADOUT RECEIPT, then the final score appears.
- PR: gold border chases one lap around the card, medium-heavy haptic, `NEW PR` stamp.
- Boss win: three hard screen shakes of 2px over 180ms, heavy haptic, violet to gold palette swap, badge reveal.
- Monthly win: full 700ms celebration with falling square confetti, never more than 20 particles, then it stops completely.
- Loss: no shame animation. Score locks, opponent row flashes red once, and the app gives one direct comeback line.

## Share moment

The LOADOUT RECEIPT builds in three beats: volume, equivalent object, scoreboard delta. Total under 900ms. The share button remains still and reachable during animation. Exported share art is a static frame with no missing context.

## Reduced motion and quiet mode

With `prefers-reduced-motion: reduce`, all transforms, shakes, confetti, flicker, and count-up effects are removed. Color and copy changes remain instant. Haptics have a separate in-app toggle because OS reduced motion does not reliably express vibration preference.

## Audio

Default off. Optional sounds: set confirm click, timer warning, PR sting, boss victory. Never play audio on app open or during a video recording.
