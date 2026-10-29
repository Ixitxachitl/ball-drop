# Ball Drop

A pachinko-style race for chat, as an OBS browser source. Viewers type `!join` and get a little pixel wheel in
their chat color on the starting line at the top of the screen. When a mod or the broadcaster types `!start`,
the trapdoors drop and every wheel races down a machine that's thrown together fresh for each race. Whoever
reaches the goal at the bottom first wins.

The machine is a random Rube Goldberg contraption built from the Stunt Wheel's track, casino and pinball
pieces: ramps that roll the pack back and forth across the screen, peaks that split it, valleys, glass coin
funnels, pinball flippers, pachinko pins and pop bumpers, springs, loops, trapdoors, jumps only the fast wheels
clear, and glass pipes that take a shortcut a few floors down. Things move, too: windmills and paddle wheels
that bat the wheels along, bats that swing down at one going under, catapults in the floor, see-saws,
escalators, spinning drums, rollers and humps, bars riding along slots that push the wheels on, and bumpy
stretches of cobbles and gravel. Nothing spins or flashes fast. However it's put together there's always a way
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

## 3D view

Set **View** to **3D** in the settings (or add `?view=3d`) for a 3D race instead: down one long, wide,
continuous track that winds through space, built fresh every race (`course3d.js`) and drawn with three.js
(`view3d.js`, loaded from jsDelivr). It has banked turns and switchbacks, helixes spiralling down, corkscrew
loops, jumps fed by a conveyor, glass funnels the balls spiral down through onto the track below,
roulette wheels they spin round and settle into a pocket of (red's a boost, green 0 a bigger one),
halfpipes they swing from wall to wall down, whack-a-mole stretches where moles pop up and bonk them into
the air, a pachinko slope of pins, a pinball table with bumpers, slingshots and flippers, posts of dice, chips and
bumpers to weave between, lane splits with a boost pad down one side and a slow conveyor down the other,
bumpers along the rails that knock balls back into the action, dominoes and traffic cones the balls knock
flying (and that bump into everything else on the track), slot machines whose levers the
balls pull as they pass (7-7-7 pays out a boost), and moving things: turnstiles, paddle wheels, hammers
swinging across the track, see-saws that are giant playing cards, escalators, beds of spinning rollers, spinning drums, pistons punching
out of the rails, and flipper gauntlets with flippers at all sorts of angles that flick at a ball coming by.
And marble runs, where the track splits into three narrow lanes that wind round each other and come back
together: walled lanes that corkscrew round the middle one, a wire-track maze where the outer two cross
over and under the middle one to the other side, or a knot where all three twist round each other like the
strands of a rope. Each ball takes whichever lane it reaches. Plus tornado spirals, round and round three
times or so, spinning turntables set into the track that sweep the balls round, swaying rope bridges,
lottery drums (turning wire cages the balls tumble through), berms round the outside of some turns, and
patches of cobbles, gravel and rumble strips. Mahjong tables tip slowly from side to side, with rows of
big tiles across them to roll along and find the gap in, and craps tables have two giant dice tumbling
across the felt that every so often are thrown, and the table calls the roll (a 7 or 11 boosts everyone on it).
Every curve ends in pop bumpers (one in the middle, one against each rail) that knock the balls it's flung
outward somewhere new, and deflectors along the rails of the obstacle stretches mean no ball gets past along
the sides. Finished balls roll on into a tray past the checkered line.
The racers are glossy balls in their chat colors with their initial on them, rolling along and across the
track. It's all under a night sky with a city on the horizon and searchlights, so unlike the 2D view the
source isn't see-through. Joining, starting, the signs, names and emote bubbles work the same as in 2D. OBS
needs its browser hardware acceleration on (the default).

The camera starts on **auto**: the starting line in the lobby, the leader during the race, and the winner
coming home. In OBS's Interact window you can take over:

- **Drag** to orbit, **mouse wheel** to zoom, **right-drag** to pan.
- **Click a racer** to follow them; **double-click** empty space to go back to auto.
- The **2D / 3D** buttons at the top right (they show while the mouse is over it, like the other buttons)
  switch views; it reloads in the other one.
- Keys: **A** auto, **O** the whole course, **F** leave the camera where it is, **← / →** follow the next racer.

## Chat commands

| Command       | Who                      | What                                                        |
| ------------- | ------------------------ | ----------------------------------------------------------- |
| `!join`       | anyone                   | join the next race                                          |
| `!start`      | mods and the broadcaster | start the race (needs at least one racer)                   |
| `!cam name`   | mods and the broadcaster | 3D view: follow that racer (`!cam all`: the whole course; `!cam`: auto) |

All three can be renamed in the settings.

**Auto mode** (`?auto=1`) needs no commands: anyone who chats is in the race, and races start by themselves
(`autowait` seconds after the first racer is in, default 20) and run one after another. Someone who hasn't
chatted for `autoidle` minutes (default 10) isn't in the next race.

## Testing

`index.html?selftest=10` (add `&view=3d` for the 3D course, which needs serving over http) races 30 wheels down 10 fresh machines as fast as it can, with no drawing, and writes
how each race went into the page: how long the first and last wheels took, and whether any wheel needed a
nudge or a lift to get unstuck (it should be all zeros, or very nearly).
