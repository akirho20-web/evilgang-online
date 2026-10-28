[README.md](https://github.com/user-attachments/files/34095313/README.md)
# Evilgang the Game: online server

This folder is the whole online setup. One small Node.js program serves the game as a website and runs the private lobbies over WebSockets. It has **no dependencies**, so there's no `npm install` and nothing to break.

```
server/
  server.js      ← lobby + match server (Node 18+)
  public/        ← the game (index.html = the full game incl. football, arena.html = fighting/racing only, used for tests)
  package.json
  render.yaml    ← one-click config for Render.com
```

## Try it locally first (2 minutes)

1. Install Node.js 18 or newer from nodejs.org.
2. Open a terminal in this `server` folder and run `node server.js`.
3. Open `http://localhost:8080` in two browser windows. GAME MODES → ONLINE → nickname → one window creates a room and the other joins with the code.

Friends on the same Wi-Fi can join at `http://YOUR-PC-IP:8080` (Windows: run `ipconfig` and use the IPv4 address).

## Put it online for free (Render.com)

1. Create a free GitHub account and make a **private** repository, e.g. `evilgang-online`.
2. Upload the *contents* of this `server` folder (server.js, package.json, render.yaml, public/) to that repository.
3. Create a free account at render.com and choose **New → Blueprint**. Pick the repository and Render reads `render.yaml`.
   - Or do it by hand: **New → Web Service**, Runtime *Node*, Build command `echo ok`, Start command `node server.js`, Instance type **Free**, Region **Frankfurt** (closest to Turkey).
4. After about a minute you get a link like `https://evilgang-online.onrender.com`. Send that link to your friends. That's the whole install.

**Free-tier note:** Render puts a free service to sleep after about 15 minutes with no visitors. The first visit after that takes 30–60 seconds to wake up, and after that it's fast. Matches in progress keep it awake.

## Updating the game later

Replace `public/index.html` and `public/arena.html` with the new build and push to GitHub. Render redeploys automatically.

## How to play online

Main menu → **OYUN MODLARI / GAME MODES** → **ÇEVRİMİÇİ / ONLINE** → enter a nickname. When a match ends, everyone goes back to the main menu.

- **1 · Create room** shows a 6-letter code. Send it to your friend.
- **2 · Join room**: type the code, or paste it with Ctrl+V.
- In the lobby:
  - **A/D** changes your character and **W/S** your skin (only skins you own).
  - **Space** marks you ready.
- The host also has these keys:
  - **Enter** starts the match.
  - **O** switches the mode between Fight and Race (or click the mode buttons).
  - **M/N** changes the arena (Fight) or the race length (Race).
  - **L** locks the room.
  - **2–8** kicks a player.
- During a match, **Esc** asks before leaving.
- **Fight:** the host and the first ready player fight, and anyone else in the room watches. Leaving counts as a forfeit.
- **Race (Grand Continental Race):** the host plus up to 5 ready players race, and AI riders fill the empty spots.
  - Each player's camera follows their own rider.
  - A live standings list shows top-right.
  - With 3 or more racers, the race continues if someone leaves. In a 2-player race, leaving is a forfeit.

Football (GAME MODES → FOOTBALL) is not online yet. It's a separate game with its own engine, so it needs separate work.

## How the netcode works (short version)

- **Deterministic lockstep with input delay.** Both browsers run the exact same simulation from the same random seed. Only key presses travel over the network, so a whole match is a few KB.
- **The server owns the timeline.** It decides the start, the delay, the order and completeness of inputs, disconnects, forfeits and the final result. A result only counts when both clients report the same winner.
- **Input delay** is set automatically from the players' ping (3 frames on a good connection, up to 12). Ping is shown in the lobby and bottom-left during the match.
- **Desync safety.** Every second the clients compare a fingerprint of the full fighter state. If they ever differ, the host's state is sent to the other player.
- **Connection drops.**
  - The match pauses with "Reconnecting…" and the client reconnects by itself.
  - Within 30 seconds it resumes exactly where it was.
  - After 30 seconds the remaining player wins by forfeit.
  - If the host leaves the lobby, the host role moves to the next player.
- **Protections:**
  - Unguessable room codes.
  - A join rate limit per IP.
  - Rooms are capped at 8 players.
  - The host can lock the room and kick players.
  - Nicknames are cleaned up.
  - No accounts and no stored personal data.

Chrome or Edge is recommended for everyone in a match (same JavaScript engine).
