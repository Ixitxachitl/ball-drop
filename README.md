# Ball Drop

A pachinko-style race for chat, as an OBS browser source. Viewers type `!join` and get a little pixel wheel in
their chat color on the starting line at the top of the screen. When a mod or the broadcaster types `!start`,
the trapdoors drop and every wheel races down a machine that's thrown together fresh for each race. Whoever
reaches the goal at the bottom first wins.

The machine is a random Rube Goldberg contraption built from the Stunt Wheel's track, casino and pinball
pieces: ramps that roll the pack back and forth across the screen, peaks that split it, valleys, glass coin
funnels, pinball flippers, pachinko pins and pop bumpers, springs, loops, trapdoors, jumps only the fast wheels
clear, and glass pipes that take a shortcut a few floors down. However it's put together there's always a way
to the goal, with forks along the way.

Racers' names always show over their wheels. When a racer chats during the race, only their emotes (and emoji)
pop up in a speech bubble over their wheel.

## Setup

In OBS: **Add → Browser**, point it at `index.html` (or wherever it's hosted), at your canvas size
(e.g. 1920×1080). The background is transparent inside OBS.

Right-click the source → **Interact** and move the mouse over it:

- **Join race**: puts you (the broadcaster) on the starting line.
- **Start race**: starts it (there has to be at least one racer).
- **New machine**: builds a different machine for the racers already waiting.
- The **gear** opens the settings: your Twitch / Kick channel, TikTok or YouTube, the join and start commands,
  the most racers, starting by itself after a while, and more.

Every setting can also be a URL parameter, which overrides it, e.g. `index.html?channel=yourchannel`. The full
list is in the comment at the top of `index.html`. `?demo=1` fills it with fake chatters who join and race.

## Chat commands

| Command  | Who                      | What                                      |
| -------- | ------------------------ | ----------------------------------------- |
| `!join`  | anyone                   | join the next race                        |
| `!start` | mods and the broadcaster | start the race (needs at least one racer) |

Both can be renamed in the settings.

## Testing

`index.html?selftest=10` races 30 wheels down 10 fresh machines as fast as it can, with no drawing, and writes
how each race went into the page: how long the first and last wheels took, and whether any wheel needed a
nudge or a lift to get unstuck (it should be all zeros, or very nearly).
