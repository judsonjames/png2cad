# Interface guidelines

These rules apply to the web app (`apps/web`) and the shared UI (`packages/ui`).

## Layout and states

- Show what is happening and what needs attention. A healthy result looks quiet: neutral surfaces, with saturated color only for a state that needs action.
- Collapse what passes, never what fails. Passing checks fold into one line; warnings and faults stay visible.
- Draw every state a screen can reach: empty, tracing, updating, failed, ready. An empty state says what belongs there and offers the next action.
- There is no Run button for quick work. The Vector picture updates shortly after a change, and the old picture stays on screen with "Updating…" until the new one arrives.
- Work that can take minutes runs only when asked, and can be canceled. The export preview waits for Check Size: run on every change, it would fit each half-typed size on the way to the one wanted. After a change the old picture stays, with a note that it is out of date.
- Anything that changes the art makes earlier files out of date, so they are cleared rather than left to mislead.
- Give the screen one primary action, and keep it in view. Other actions look subordinate.
- Use standard controls before inventing new ones. Group with spacing and alignment before adding borders or backgrounds.
- Explanations not needed every time go in an info marker (`InfoTip`) beside the control.

## Phones and tablets

- **Side by side** when there is room for picture and settings: from 1000 px wide, or 700 px when the screen is wider than tall, so a phone on its side keeps a large picture.
- **Stacked** below that: the picture on top at a fixed share of the screen, the settings under it, and the primary action pinned to the bottom.
- **Never sideways.** The page never scrolls sideways. A bar that cannot fit becomes one row that scrolls within itself.
- **Fields use 16 px text on touch screens.** iOS zooms in on anything smaller when it is tapped.
- **Every gesture has a touch form.** Pinch zooms and two fingers pan the picture. Anything shown on hover also opens on a tap.
- **Check with touch on.** Test at phone and tablet sizes in both orientations, with touch emulated, not only by narrowing a desktop window.

## Interaction and accessibility

Check these on the rendered page, not only in source:

- **Target size.** Pointer targets are at least 24 × 24 CSS px, and 44 × 44 on a touch screen. A small mark can keep its look with a larger invisible area round it.
- **Contrast.** Text is at least 4.5:1 against the background it actually sits on; large text and control borders at least 3:1.
- **Focus.** Every control shows a visible focus ring.
- **Color alone.** A state shown in color also has text or a shape.
- **Dragging.** Every drag has a click or keyboard alternative: arrow keys pan the picture, plus and minus zoom.
- **Overlays.** Popovers and tips render in the top layer, so a scrolling pane cannot clip them.
- **Motion.** Animation is for state changes only, and respects `prefers-reduced-motion`.

## Interface text

- **One name per thing,** the same on every screen and in the docs.
- **Buttons start with a verb** naming the action: "Make Files", "Add Bambu Template". Never "OK" or "Yes".
- **Title Case for names:** buttons, section titles, field labels and short switch labels. Anything written as a sentence uses sentence case: hints, tips and messages.
- **Toggles describe the on state:** "Keep Enclosed Background".
- **Errors say what failed and how to fix it,** next to where it failed. No blame, "oops" or exclamation marks.
- **Status text pairs:** "Updating…" resolves to the result; a failure says what did not happen and the next step. Do not write "successfully".
- **Info markers** say what the control is and what it affects, in active voice. Keep units a value depends on.
- Use US spelling.

## Reviewing and testing

- **Report coverage first.** Name the screens, states, window sizes and input methods actually checked. A check that could not run is unknown, never a pass.
- **Rank findings:** P0 blocks a task or risks a bad file; P1 materially impairs use or is a confirmed accessibility failure; P2 is friction with a workaround; P3 is polish.
- **Fix in this order:** broken or misleading behavior, missing states, flow and hierarchy, visual polish, then cleanup.
- **Look at real artwork,** not only the sample. Most of what matters shows up on messy, small or low-contrast images.
