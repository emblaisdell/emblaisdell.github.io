/* Cloud the Peacekeeper
 * A peacekeeping arcade game. You are a cloud; your only power is lightning.
 * A direct strike kills (bad); a near miss frightens citizens away (useful).
 * Keep citizens alive to build a combo, which summons builders that raise a
 * statue spelling your cloud's name. Finish the statue to win.
 *
 * Runs in any modern browser; Electron just wraps index.html.
 */
(() => {
  'use strict';

  // ---- Virtual resolution ----
  // Desktop/Electron keeps the fixed 1000×600 (5:3) field. On a phone, the width
  // is recomputed from the device's landscape aspect at game start (see chooseW),
  // so the one-lane street fills a widescreen display instead of pillar-boxing.
  // The vertical layout (H and the horizon/ground/cloud constants) never changes.
  let W = 1000;
  const H = 600;
  const HORIZON_Y = 462;      // where sky meets grass; sun/moon rise/set here
  const GROUND_Y = 545;       // citizens' feet & the statue base rest here (down on the grass)
  const CLOUD_Y = 78;         // cloud drift height

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');

  // ---------------------------------------------------------------------------
  // Chunky 3x5 pixel font for the statue (uppercase + digits + a few symbols).
  // Kept deliberately coarse so every name builds in the same blocky style.
  // ---------------------------------------------------------------------------
  const GLYPH_W = 3;
  const GLYPH_H = 5;
  const FONT = (() => {
    const raw = {
      'A': '010,101,111,101,101',
      'B': '110,101,110,101,110',
      'C': '011,100,100,100,011',
      'D': '110,101,101,101,110',
      'E': '111,100,110,100,111',
      'F': '111,100,110,100,100',
      'G': '011,100,101,101,011',
      'H': '101,101,111,101,101',
      'I': '111,010,010,010,111',
      'J': '001,001,001,101,011',
      'K': '101,101,110,101,101',
      'L': '100,100,100,100,111',
      'M': '111,111,101,101,101',
      'N': '110,101,101,101,101',
      'O': '010,101,101,101,010',
      'P': '110,101,110,100,100',
      'Q': '010,101,101,010,001',
      'R': '110,101,110,101,101',
      'S': '011,100,010,001,110',
      'T': '111,010,010,010,010',
      'U': '101,101,101,101,111',
      'V': '101,101,101,101,010',
      'W': '101,101,101,111,111',
      'X': '101,101,010,101,101',
      'Y': '101,101,010,010,010',
      'Z': '111,001,010,100,111',
      '0': '111,101,101,101,111',
      '1': '010,110,010,010,111',
      '2': '110,001,010,100,111',
      '3': '111,001,011,001,111',
      '4': '101,101,111,001,001',
      '5': '111,100,110,001,110',
      '6': '011,100,111,101,111',
      '7': '111,001,010,100,100',
      '8': '010,101,010,101,010',
      '9': '111,101,111,001,110',
      '-': '000,000,111,000,000',
      "'": '010,010,000,000,000',
      ' ': '000,000,000,000,000',
    };
    const out = {};
    for (const k in raw) out[k] = raw[k].split(',').map((r) => r.split(''));
    return out;
  })();

  // ---------------------------------------------------------------------------
  // Professions
  // ---------------------------------------------------------------------------
  const PROF = {
    NEUTRAL: 'neutral',
    MEDIC: 'medic',
    ASSASSIN: 'assassin',
    COWBOY: 'cowboy',
    KNIGHT: 'knight',
    BUILDER: 'builder',
  };

  const PROF_COLOR = {
    [PROF.NEUTRAL]: '#cfd6ec',
    [PROF.MEDIC]: '#5be0a0',
    [PROF.ASSASSIN]: '#ff5d6c',
    [PROF.COWBOY]: '#f5d021',
    [PROF.KNIGHT]: '#7fb4ff',
    [PROF.BUILDER]: '#d8b36a',
  };

  // ---------------------------------------------------------------------------
  // Difficulty presets. "length" of a game is the statue (chosen by name);
  // difficulty tunes pacing and the threat mix.
  // ---------------------------------------------------------------------------
  const DIFFS = {
    Easy: {
      label: 'Easy',
      sub: 'Calm streets',
      spawnMean: 3.4,        // mean seconds between arrivals per side
      survivalInterval: 6.5, // seconds of peace to earn a combo
      fallenDuration: 8.0,   // seconds before a fallen citizen is lost
      peaceLoss: 8,
      threat: { neutral: 46, medic: 24, knight: 12, assassin: 9, cowboy: 9 },
      cowboyFireMean: 3.2,
      citizenSpeed: 42,
    },
    Normal: {
      label: 'Medium',
      sub: 'Busy town',
      spawnMean: 2.9,
      survivalInterval: 8.0,
      fallenDuration: 7.0,
      peaceLoss: 12,
      threat: { neutral: 40, medic: 22, knight: 12, assassin: 13, cowboy: 13 },
      cowboyFireMean: 2.4,
      citizenSpeed: 46,
    },
    Hard: {
      label: 'Hard',
      sub: 'Powder keg',
      spawnMean: 2.5,
      survivalInterval: 9.5,
      fallenDuration: 6.0,
      peaceLoss: 16,
      threat: { neutral: 34, medic: 19, knight: 11, assassin: 18, cowboy: 18 },
      cowboyFireMean: 1.8,
      citizenSpeed: 50,
    },
  };

  // Preset cloud names, short-to-long. The name sets the statue (and thus the
  // length of the game), so each carries an Easy/Medium/Hard tier by that length.
  // Busyness (crowd/danger) is chosen separately.
  const CLOUD_NAMES = [
    { name: 'Bolt', tier: 'Easy' },
    { name: 'Thunder', tier: 'Medium' },
    { name: 'Cumulonimbus', tier: 'Hard' },
  ];

  // ---------------------------------------------------------------------------
  // Tunables
  // ---------------------------------------------------------------------------
  // ---- Touch / mobile adaptation ----
  // A coarse pointer with no hover ⇒ a touch device (phone/tablet). The virtual
  // resolution (1000×600) and every bit of gameplay math stay identical; mobile
  // only bumps a few tunables so the people are finger-sized, their hitboxes
  // track the bigger sprites, and the one-lane street is less crowded.
  const isMobile =
    matchMedia('(pointer: coarse)').matches && matchMedia('(hover: none)').matches;

  const HIT_RADIUS = isMobile ? 30 : 22;       // direct-hit kill radius (x distance)
  const NEAR_RADIUS = isMobile ? 100 : 84;     // near-miss scare radius
  const BODY_W = 28;
  const TOUCH_X = isMobile ? 28 : 22;          // interaction x-overlap
  const REVIVE_GRACE = 1.6;    // seconds a just-healed citizen can't be re-felled
  const ASSASSIN_COOLDOWN = 0.1; // brief recovery between an assassin's strikes
  const CITIZEN_SCALE = isMobile ? 2.0 : 1.4;  // visual size of the people
  const SPAWN_MULT = isMobile ? 1.5 : 1;       // longer gaps between arrivals on small screens
  const BULLET_SPEED = 360;
  const BOOST_STEP = 0.65;  // each near miss adds this much speed multiplier...
  const BOOST_MAX = 5;      // ...up to this cap (keeps collisions from tunnelling)
  const JUMP_DUR = 0.5;     // seconds for a builder's hop
  const JUMP_AMP = 52;      // max hop height (local px), scaled toward the block
  const JUMP_MIN_ELEV = 22; // only hop if the block sits at least this high (skips the ground row)

  // ---------------------------------------------------------------------------
  // Tiny WebAudio SFX (no asset files needed).
  // ---------------------------------------------------------------------------
  const Sound = (() => {
    let actx = null;
    let muted = false;
    // iOS treats Web Audio as "ambient" sound, so the hardware silent switch
    // mutes it. Declaring a "playback" audio session (Safari 16.4+) routes our
    // SFX through the media category, which plays even in silent mode. The API
    // is absent elsewhere, so this is a harmless no-op on other browsers.
    const usesPlaybackSession = () => {
      try {
        if (navigator.audioSession && navigator.audioSession.type !== 'playback') {
          navigator.audioSession.type = 'playback';
        }
      } catch (e) { /* ignore */ }
    };
    const ensure = () => {
      usesPlaybackSession();
      if (!actx) {
        try { actx = new (window.AudioContext || window.webkitAudioContext)(); }
        catch (e) { actx = null; }
      }
      return actx;
    };
    const tone = (freq, dur, type = 'sine', gain = 0.18, slideTo = null) => {
      if (muted) return;
      const a = ensure();
      if (!a) return;
      const t = a.currentTime;
      const osc = a.createOscillator();
      const g = a.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t);
      if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
      g.gain.setValueAtTime(gain, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(g).connect(a.destination);
      osc.start(t);
      osc.stop(t + dur + 0.02);
    };
    return {
      resume: () => { const a = ensure(); if (a && a.state === 'suspended') a.resume(); },
      toggleMute: () => { muted = !muted; return muted; },
      isMuted: () => muted,
      zap: () => { tone(140, 0.18, 'sawtooth', 0.16, 60); tone(900, 0.08, 'square', 0.06); },
      scare: () => tone(520, 0.12, 'triangle', 0.08, 760),
      heal: () => { tone(540, 0.16, 'sine', 0.14, 880); },
      // Block placed: a bright, rising major arpeggio (C–E–G) capped with a high
      // octave sparkle — a small triumphant flourish for every piece set.
      place: () => {
        [523.25, 659.25, 783.99].forEach((f, i) =>
          setTimeout(() => tone(f, i === 2 ? 0.24 : 0.11, 'triangle', 0.16), i * 60));
        setTimeout(() => tone(1046.5, 0.2, 'sine', 0.06), 165); // octave sparkle on top
      },
      combo: () => { tone(523, 0.12, 'triangle', 0.12); setTimeout(() => tone(784, 0.18, 'triangle', 0.12), 90); },
      shot: () => tone(220, 0.07, 'square', 0.08, 120),
      death: () => tone(160, 0.3, 'sawtooth', 0.12, 70),
      // (Swapped with evaporate) an assassin/bullet felling now gets the harsh,
      // sinking knell — at half its former volume.
      harm: () => {
        tone(330, 0.5, 'sawtooth', 0.09, 58);              // harsh descending body
        tone(233, 0.5, 'square', 0.055, 47);               // grinding, dissonant undertone
        setTimeout(() => tone(150, 0.34, 'sawtooth', 0.065, 42), 80); // a second downward bite
      },
      // (Swapped with harm) a citizen lost for good now gets the soft, dissonant,
      // sinking "wound" tone — queasy and mellow rather than harsh.
      evaporate: () => {
        tone(300, 0.34, 'sine', 0.13, 150);    // sinking body of the tone
        tone(212, 0.34, 'sine', 0.08, 112);    // tritone-ish undertone for unease
        tone(150, 0.22, 'triangle', 0.07, 96); // dull thud underneath
      },
      win: () => { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone(f, 0.3, 'triangle', 0.14), i * 130)); },
      lose: () => { [400, 320, 240, 160].forEach((f, i) => setTimeout(() => tone(f, 0.35, 'sawtooth', 0.14), i * 150)); },
    };
  })();

  // ---------------------------------------------------------------------------
  // Game state
  // ---------------------------------------------------------------------------
  let state = 'menu'; // menu | playing | paused | won | lost
  let G = null;       // active game object
  let hudHit = [];    // on-canvas HUD control hitboxes (mobile pause/mute), virtual coords

  function weightedProfession(weights) {
    let total = 0;
    for (const k in weights) total += weights[k];
    let r = Math.random() * total;
    for (const k in weights) {
      r -= weights[k];
      if (r <= 0) return k;
    }
    return PROF.NEUTRAL;
  }

  // Exponential inter-arrival for a Poisson process with given mean.
  function expInterval(mean) {
    return -Math.log(1 - Math.random()) * mean;
  }

  // Fixed cell size so the statue looks the same chunky size for every name.
  // Sized so even the longest preset ("Cumulo-Nimbus") fits across the screen.
  const STATUE_CELL = 17;

  function buildStatue(name) {
    const chars = name.toUpperCase().split('');
    const glyphs = chars.map((c) => FONT[c] || FONT[' ']);
    const charW = GLYPH_W, charH = GLYPH_H, gap = 1;
    const totalCols = chars.length * charW + (chars.length - 1) * gap;
    let cell = STATUE_CELL;
    // Only shrink if an unusually long custom name would overflow the screen.
    const maxW = W * 0.94;
    if (totalCols * cell > maxW) cell = Math.floor(maxW / totalCols);
    const statueW = totalCols * cell;
    const left = (W - statueW) / 2;
    const baseY = GROUND_Y - 4; // bottom row sits just above the ground line
    const targets = [];
    chars.forEach((c, ci) => {
      const g = glyphs[ci];
      const colOffset = ci * (charW + gap);
      for (let r = 0; r < charH; r++) {
        for (let col = 0; col < charW; col++) {
          if (g[r][col] === '1') {
            const cx = left + (colOffset + col) * cell + cell / 2;
            const cy = baseY - (charH - 1 - r) * cell - cell / 2;
            // dx = x offset from field centre, so the statue can be re-centred for
            // free if W changes (mobile viewport resize) by setting cx = W/2 + dx.
            targets.push({ cx, cy, r, dx: cx - W / 2 });
          }
        }
      }
    });
    // Build from the ground up: bottom rows first, then left-to-right.
    targets.sort((a, b) => (b.r - a.r) || (a.cx - b.cx));
    return { targets, cell };
  }

  // Static starfield (positions fixed for a run so stars don't twinkle-jump).
  function makeStars(n) {
    const stars = [];
    for (let i = 0; i < n; i++) {
      stars.push({
        x: Math.random() * W,
        y: Math.random() * (HORIZON_Y * 0.85),
        r: 0.6 + Math.random() * 1.4,
        phase: Math.random() * Math.PI * 2,
      });
    }
    return stars;
  }

  function newGame(name, diffKey) {
    const diff = DIFFS[diffKey];
    const statue = buildStatue(name);
    const spawnMean = diff.spawnMean * SPAWN_MULT; // fewer arrivals on small screens
    return {
      timeOfDay: 0.16,        // start mid-morning
      // Moon elongation from the sun, in radians. Random initial phase, then it
      // advances 2π per synodic month so the phase (and rise time) drift correctly.
      moonElong0: Math.random() * Math.PI * 2,
      stars: makeStars(80),
      name,
      diffKey,
      diff,
      statue,
      buildIndex: 0,
      citizens: [],
      bullets: [],
      bolts: [],     // lightning visuals
      particles: [],
      cloudX: W / 2,
      mouseX: W / 2,
      spawnMean,
      spawnTimerL: expInterval(spawnMean),
      spawnTimerR: expInterval(spawnMean),
      survivalTimer: 0,
      combo: 0,
      builderQueue: 0,
      builderSpawnTimer: 0,
      // stats
      elapsed: 0,
      casualties: 0,
      saves: 0,
      bestCombo: 0,
      idSeq: 1,
    };
  }

  function spawnCitizen(profession, fromLeft) {
    const dir = fromLeft ? 1 : -1;
    const x = fromLeft ? -BODY_W : W + BODY_W;
    G.citizens.push({
      id: G.idSeq++,
      x,
      dir,
      prevX: x,
      profession,
      speed: G.diff.citizenSpeed * (0.9 + Math.random() * 0.2),
      boost: 1,
      alive: true,
      fallen: false,
      fallenTimer: 0,
      graceTimer: 0,  // brief invulnerability to assassins/bullets after a revive
      attackCd: 0,    // assassin's recovery time between strikes
      fireTimer: profession === PROF.COWBOY ? expInterval(G.diff.cowboyFireMean) : 0,
      bob: Math.random() * Math.PI * 2,
      jumping: false, // hop animation for builders reaching an elevated build spot
      hopped: false,  // a builder hops at most once on its way to the build spot
      jumpT: 0,
      jumpY: 0,
      jumpAmp: 0,
      isBuilder: profession === PROF.BUILDER,
    });
  }

  function spawnBuilder() {
    const fromLeft = Math.random() < 0.5;
    spawnCitizen(PROF.BUILDER, fromLeft);
  }

  function currentPhantom() {
    if (!G || G.buildIndex >= G.statue.targets.length) return null;
    return G.statue.targets[G.buildIndex];
  }

  function addParticles(x, y, color, n, spd) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = spd * (0.4 + Math.random() * 0.8);
      G.particles.push({
        x, y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s - 30,
        life: 0.6 + Math.random() * 0.4,
        max: 1,
        color,
      });
    }
  }

  // Returns true if the citizen was actually felled (false if shielded/already down).
  function killCitizen(c, cause) {
    if (!c.alive || c.fallen) return false;
    // Invincible while off the visible street — the player couldn't have stopped it.
    if (c.x < 0 || c.x > W) return false;
    // A just-revived citizen is briefly shielded from blades and bullets (but the
    // player's own lightning can still strike them).
    if (c.graceTimer > 0 && (cause === 'assassin' || cause === 'bullet')) return false;
    c.alive = false;
    c.fallen = true;
    c.fallenTimer = G.diff.fallenDuration;
    c.boost = 1;
    // A felled builder drops its block and is just a body now.
    c.isBuilder = false;
    addParticles(c.x, GROUND_Y - 24, '#ff8088', 10, 120);
    if (cause === 'lightning') Sound.death();
    else if (cause === 'assassin' || cause === 'bullet') Sound.harm();
    return true;
  }

  function healCitizen(c, medic) {
    c.fallen = false;
    c.alive = true;
    c.profession = PROF.NEUTRAL;
    c.fallenTimer = 0;
    c.dir = medic.dir;     // get up and walk along with the medic
    c.boost = 1;
    c.graceTimer = REVIVE_GRACE;
    G.saves++;
    addParticles(c.x, GROUND_Y - 26, '#7dffc0', 12, 110);
    Sound.heal();
  }

  // ---------------------------------------------------------------------------
  // Lightning
  // ---------------------------------------------------------------------------
  function strike(targetX) {
    G.bolts.push({ x: targetX, life: 0.22, max: 0.22, seed: Math.random() * 1000 });
    Sound.zap();
    addParticles(targetX, GROUND_Y - 4, '#fff7c0', 14, 160);

    let scared = false;
    for (const c of G.citizens) {
      if (!c.alive || c.fallen) continue;
      const dx = c.x - targetX;
      const ad = Math.abs(dx);
      if (ad <= HIT_RADIUS) {
        killCitizen(c, 'lightning');
      } else if (ad <= NEAR_RADIUS) {
        c.dir = dx >= 0 ? 1 : -1;                       // flee away from the bolt
        c.boost = Math.min(BOOST_MAX, c.boost + BOOST_STEP); // each scare adds speed; never decays
        scared = true;
      }
    }
    if (scared) Sound.scare();
  }

  // ---------------------------------------------------------------------------
  // Update
  // ---------------------------------------------------------------------------
  const DAY_LENGTH = 60;   // seconds for a full day-night cycle (~a minute)
  const SYNODIC_DAYS = 29.53; // days per lunar phase cycle

  function update(dt) {
    G.elapsed += dt;
    G.timeOfDay = (G.timeOfDay + dt / DAY_LENGTH) % 1;

    // Cloud eases toward the pointer.
    G.cloudX += (G.mouseX - G.cloudX) * Math.min(1, dt * 9);

    // --- Spawns (Poisson per side) ---
    G.spawnTimerL -= dt;
    if (G.spawnTimerL <= 0) {
      spawnCitizen(weightedProfession(G.diff.threat), true);
      G.spawnTimerL = expInterval(G.spawnMean);
    }
    G.spawnTimerR -= dt;
    if (G.spawnTimerR <= 0) {
      spawnCitizen(weightedProfession(G.diff.threat), false);
      G.spawnTimerR = expInterval(G.spawnMean);
    }

    // --- Builder wave from combo ---
    if (G.builderQueue > 0) {
      G.builderSpawnTimer -= dt;
      if (G.builderSpawnTimer <= 0) {
        spawnBuilder();
        G.builderQueue--;
        G.builderSpawnTimer = 1.0; // one per second
      }
    }

    // --- Move citizens & handle their movement-related logic ---
    for (const c of G.citizens) {
      c.prevX = c.x;
      if (c.fallen) {
        c.fallenTimer -= dt;
        continue;
      }
      if (!c.alive) continue;

      if (c.graceTimer > 0) c.graceTimer -= dt;
      if (c.attackCd > 0) c.attackCd -= dt;

      // Scared citizens keep their boosted speed permanently (set in strike()).
      c.bob += dt * 8 * c.boost;
      c.x += c.dir * c.speed * c.boost * dt;

      // jump arc (builders hop as they reach an elevated build spot)
      if (c.jumping) {
        c.jumpT += dt / JUMP_DUR;
        if (c.jumpT >= 1) { c.jumping = false; c.jumpT = 0; c.jumpY = 0; }
        else c.jumpY = Math.sin(c.jumpT * Math.PI) * c.jumpAmp;
      }

      // cowboy fires
      if (c.profession === PROF.COWBOY) {
        c.fireTimer -= dt;
        if (c.fireTimer <= 0) {
          c.fireTimer = expInterval(G.diff.cowboyFireMean);
          G.bullets.push({ x: c.x + c.dir * BODY_W, y: GROUND_Y - 24 * CITIZEN_SCALE, dir: c.dir });
          Sound.shot();
        }
      }

      // Builders: start a little hop just before the build spot, then place the
      // block when they cross the phantom column (so the leap leads the placement).
      if (c.isBuilder) {
        const ph = currentPhantom();
        if (ph) {
          // The carried block sits ahead of the body on the leading side; the hop
          // and placement key off the block's position, not the citizen's centre.
          const blockOff = c.dir * 11 * CITIZEN_SCALE;
          const bx = c.x + blockOff;
          const bpx = c.prevX + blockOff;
          const ahead = (ph.cx - bx) * c.dir;   // distance the block still has to reach the spot
          const elev = GROUND_Y - ph.cy;         // how high the block sits above the ground
          if (elev > JUMP_MIN_ELEV) {
            // Elevated block: hop once, started half a hop's travel before the spot
            // so the *top* of the jump lines up with the block reaching the spot.
            const lead = Math.max(8, c.speed * c.boost * JUMP_DUR / 2);
            if (!c.hopped && ahead > 0 && ahead <= lead) {
              c.hopped = true;
              c.jumping = true;
              c.jumpT = 0;
              c.jumpAmp = Math.min(JUMP_AMP, elev / CITIZEN_SCALE);
            }
            // Place at the apex of the hop.
            if (c.jumping && c.jumpT >= 0.5) placeBlock(c, ph);
          } else {
            // Ground-row block: just set it down as the block passes the spot.
            if ((bpx - ph.cx) * (bx - ph.cx) <= 0) placeBlock(c, ph);
          }
        }
      }
    }

    // --- Bullets ---
    for (const b of G.bullets) {
      b.x += b.dir * BULLET_SPEED * dt;
      for (const c of G.citizens) {
        if (!c.alive || c.fallen) continue;
        if (Math.abs(c.x - b.x) <= TOUCH_X) {
          if (c.profession === PROF.KNIGHT) {
            b.dead = true;                 // knight stops the bullet
            addParticles(c.x, GROUND_Y - 30, '#bcd2ff', 6, 90);
          } else {
            killCitizen(c, 'bullet');
            b.dead = true;
          }
          break;
        }
      }
    }
    G.bullets = G.bullets.filter((b) => !b.dead && b.x > -20 && b.x < W + 20);

    // --- Assassin & medic touch interactions ---
    for (const a of G.citizens) {
      if (!a.alive || a.fallen) continue;
      if (a.profession === PROF.ASSASSIN) {
        if (a.attackCd > 0) continue;       // brief recovery between strikes
        for (const t of G.citizens) {
          if (t === a || !t.alive || t.fallen) continue;
          if (t.profession === PROF.KNIGHT) continue; // immune
          if (Math.abs(a.x - t.x) <= TOUCH_X && killCitizen(t, 'assassin')) {
            a.attackCd = ASSASSIN_COOLDOWN; // one kill, then a beat before the next
            break;
          }
        }
      } else if (a.profession === PROF.MEDIC) {
        for (const t of G.citizens) {
          if (!t.fallen) continue;
          if (Math.abs(a.x - t.x) <= TOUCH_X) healCitizen(t, a);
        }
      }
    }

    // --- Resolve fallen timeouts (irreversible deaths) & despawns ---
    const survivors = [];
    let irreversible = false;
    for (const c of G.citizens) {
      if (c.fallen && c.fallenTimer <= 0) {
        irreversible = true;
        G.casualties++;
        addParticles(c.x, GROUND_Y - 10, '#b9c2dd', 10, 60); // pale wisps drifting up
        Sound.evaporate();
        continue; // gone for good
      }
      // despawn at edges (alive citizens only; fallen stay put)
      if (!c.fallen && (c.x < -BODY_W * 2 || c.x > W + BODY_W * 2)) continue;
      survivors.push(c);
    }
    G.citizens = survivors;

    // --- Survival timer / combo ---
    if (irreversible) {
      G.survivalTimer = 0;
      G.combo = 0; // anyone falling forever breaks the combo
    } else {
      G.survivalTimer += dt;
      if (G.survivalTimer >= G.diff.survivalInterval) {
        G.survivalTimer = 0;
        G.combo += 1;
        G.bestCombo = Math.max(G.bestCombo, G.combo);
        G.builderQueue += G.combo;     // summon `combo` builders, one per second
        if (G.builderSpawnTimer <= 0) G.builderSpawnTimer = 0.2;
        Sound.combo();
      }
    }

    // --- Particles ---
    for (const p of G.particles) {
      p.life -= dt;
      p.vy += 220 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    G.particles = G.particles.filter((p) => p.life > 0);

    // --- Bolts ---
    for (const bl of G.bolts) bl.life -= dt;
    G.bolts = G.bolts.filter((bl) => bl.life > 0);

    // --- Win ---
    // The peace/lose mechanic is disabled for now, so nothing calls endGame(false)
    // yet; the lose screen in endGame() is left intact for when it's re-enabled.
    if (G.buildIndex >= G.statue.targets.length) {
      endGame(true);
    }
  }

  function placeBlock(builder, phantom) {
    G.buildIndex++;
    builder.isBuilder = false;
    builder.profession = PROF.NEUTRAL;
    // the hop was already triggered as it approached; let it finish naturally
    addParticles(phantom.cx, phantom.cy, '#e8d6a6', 12, 120);
    Sound.place();
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------
  // --- Day-night cycle helpers ---
  const SKY_KEYS = [
    { t: 0.00, sky: ['#3b3f7a', '#e0926a', '#ffd9a0'] }, // dawn
    { t: 0.25, sky: ['#2a3f8f', '#5478c9', '#a9c4e8'] }, // midday
    { t: 0.50, sky: ['#2a2a5a', '#d9705a', '#ffb583'] }, // dusk
    { t: 0.75, sky: ['#070b22', '#141d48', '#28315e'] }, // night
  ];
  function hexRGB(c) {
    const n = parseInt(c.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function lerpColor(a, b, f) {
    const A = hexRGB(a), B = hexRGB(b);
    return `rgb(${Math.round(A[0] + (B[0] - A[0]) * f)},${Math.round(A[1] + (B[1] - A[1]) * f)},${Math.round(A[2] + (B[2] - A[2]) * f)})`;
  }
  function skyAt(t) {
    const k = SKY_KEYS, n = k.length;
    let i = 0;
    for (let j = 0; j < n; j++) if (t >= k[j].t) i = j;
    const a = k[i], b = k[(i + 1) % n];
    let span = b.t - a.t; if (span <= 0) span += 1;
    let local = t - a.t; if (local < 0) local += 1;
    const f = local / span;
    return a.sky.map((c, idx) => lerpColor(c, b.sky[idx], f));
  }

  function drawBackground() {
    const t = G.timeOfDay;
    const [top, mid, horizon] = skyAt(t);
    const day = 0.5 + 0.5 * Math.cos(2 * Math.PI * (t - 0.25)); // 1 midday, 0 midnight

    // --- Sun & moon positions (computed before the stars so the moon can occlude
    // them). Hour angle h: 0 = transit (top centre), ±π/2 = the horizons. The sun
    // transits at midday (t = 0.25). The moon lags the sun by its elongation E, so
    // a new moon shares the sun's place and a full moon is opposite it — the rise
    // time drifts across the month, never simply alternating with the sun.
    const hSun = 2 * Math.PI * (t - 0.25);
    const totalDays = G.elapsed / DAY_LENGTH;
    const E = G.moonElong0 + 2 * Math.PI * (totalDays / SYNODIC_DAYS);
    const hMoon = hSun - E;
    const skyXY = (h) => { // true (unclamped) sky position at hour angle h
      let hh = h % (2 * Math.PI);
      if (hh > Math.PI) hh -= 2 * Math.PI;
      if (hh < -Math.PI) hh += 2 * Math.PI;
      return { x: W * (0.5 + hh / Math.PI), y: HORIZON_Y - Math.cos(hh) * 340, hh };
    };
    const bodyPos = (h) => {
      const p = skyXY(h);
      return { x: p.x, y: HORIZON_Y - Math.max(0, Math.cos(p.hh)) * 340, above: Math.abs(p.hh) < Math.PI / 2 };
    };
    const MOON_R = 30;
    const mp = bodyPos(hMoon);

    const sky = ctx.createLinearGradient(0, 0, 0, HORIZON_Y);
    sky.addColorStop(0, top);
    sky.addColorStop(0.55, mid);
    sky.addColorStop(1, horizon);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, HORIZON_Y);

    // stars (visible when it's dark; any hidden behind the moon's disk are skipped)
    const starA = Math.max(0, 1 - day * 1.7);
    if (starA > 0.01) {
      ctx.save();
      const occR = (MOON_R + 1) * (MOON_R + 1);
      for (const s of G.stars) {
        if (mp.above) {
          const dx = s.x - mp.x, dy = s.y - mp.y;
          if (dx * dx + dy * dy < occR) continue; // behind the moon
        }
        const tw = 0.6 + 0.4 * Math.sin(G.elapsed * 2 + s.phase);
        ctx.globalAlpha = starA * tw;
        ctx.fillStyle = '#fdf7e0';
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    // Moon (drawn after the stars so it sits in front; the lit limb points at the
    // sun's *true* position, even when the sun is below the horizon).
    if (mp.above) {
      const sunU = skyXY(hSun);
      const moonU = skyXY(hMoon);
      const sunAngle = Math.atan2(sunU.y - moonU.y, sunU.x - moonU.x);
      drawMoon(mp.x, mp.y, MOON_R, E, day, sunAngle);
    }

    // Sun
    const sp = bodyPos(hSun);
    if (sp.above) {
      const glow = ctx.createRadialGradient(sp.x, sp.y, 8, sp.x, sp.y, 90);
      glow.addColorStop(0, 'rgba(255,246,210,0.95)');
      glow.addColorStop(1, 'rgba(255,246,210,0)');
      ctx.fillStyle = glow;
      ctx.beginPath(); ctx.arc(sp.x, sp.y, 90, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff4c8';
      ctx.beginPath(); ctx.arc(sp.x, sp.y, 44, 0, Math.PI * 2); ctx.fill();
    }

    // grass, darkened at night
    const gd = 0.45 + 0.55 * day; // ground daylight multiplier
    const shade = (c) => lerpColor('#0a1018', c, gd);
    const gr = ctx.createLinearGradient(0, HORIZON_Y, 0, H);
    gr.addColorStop(0, shade('#6b8f4e'));
    gr.addColorStop(0.18, shade('#4f6f3a'));
    gr.addColorStop(1, shade('#37502a'));
    ctx.fillStyle = gr;
    ctx.fillRect(0, HORIZON_Y, W, H - HORIZON_Y);
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(0, HORIZON_Y, W, 3);

    // a soft night veil over the whole playfield for mood
    if (day < 0.6) {
      ctx.fillStyle = `rgba(8,10,30,${(0.6 - day) * 0.5})`;
      ctx.fillRect(0, 0, W, H);
    }
  }

  // Draw the moon at (cx,cy) with elongation E (radians from the sun). The phase
  // shape follows the illuminated fraction (1-cos E)/2; the whole figure is rotated
  // so the bright limb points at the sun (sunAngle = screen angle moon→sun), which
  // gives the correct terminator orientation (e.g. a tilted low-evening crescent).
  function drawMoon(cx, cy, R, E, day, sunAngle) {
    const Emod = ((E % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    const f = (1 - Math.cos(Emod)) / 2;       // 0 = new, 1 = full
    const tw = R * Math.cos(Emod);            // terminator half-width (signed)
    const night = 1 - day;                    // 1 at midnight, 0 at noon

    ctx.save();
    ctx.translate(cx, cy);

    // soft halo at night
    if (night > 0.3 && f > 0.04) {
      const halo = ctx.createRadialGradient(0, 0, R * 0.6, 0, 0, R * 2.2);
      halo.addColorStop(0, `rgba(225,230,255,${0.18 * night * Math.min(1, f + 0.3)})`);
      halo.addColorStop(1, 'rgba(225,230,255,0)');
      ctx.fillStyle = halo;
      ctx.beginPath(); ctx.arc(0, 0, R * 2.2, 0, Math.PI * 2); ctx.fill();
    }

    // unlit disk only reads at night (a daytime new moon is invisible)
    if (night > 0.15) {
      ctx.fillStyle = `rgba(70,76,104,${0.55 * night})`;
      ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.fill();
    }

    // lit portion: rotate so +x points at the sun, then draw the bright limb (a
    // semicircle on the sun side) closed off by the terminator ellipse.
    ctx.save();
    ctx.rotate(sunAngle);
    ctx.fillStyle = `rgba(238,240,255,${0.85 + 0.15 * night})`;
    ctx.beginPath();
    ctx.arc(0, 0, R, -Math.PI / 2, Math.PI / 2, false);                  // bright limb toward sun
    ctx.ellipse(0, 0, Math.abs(tw), R, 0, Math.PI / 2, -Math.PI / 2, tw > 0); // terminator
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // a few cute surface craters (night only), as fixed features on the disk
    if (night > 0.2 && f > 0.08) {
      ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.clip();
      ctx.globalAlpha = 0.12 * Math.max(0.4, f);
      ctx.fillStyle = '#9aa0c0';
      [[0.32, -0.28, 0.18], [-0.1, 0.34, 0.13], [0.5, 0.18, 0.1]].forEach(([dx, dy, rr]) => {
        ctx.beginPath(); ctx.arc(dx * R, dy * R, rr * R, 0, Math.PI * 2); ctx.fill();
      });
      ctx.globalAlpha = 1;
    }

    ctx.restore();
  }

  function drawStatue() {
    const { targets, cell } = G.statue;
    const half = cell / 2;
    // placed blocks
    for (let i = 0; i < G.buildIndex; i++) {
      const t = targets[i];
      drawBlock(t.cx - half, t.cy - half, cell, false);
    }
    // phantom (flashing) at the current build location
    const phantom = currentPhantom();
    if (phantom) {
      const pulse = 0.4 + 0.35 * (0.5 + 0.5 * Math.sin(G.elapsed * 6));
      ctx.save();
      ctx.globalAlpha = pulse;
      ctx.fillStyle = '#ffe9a8';
      ctx.fillRect(phantom.cx - half, phantom.cy - half, cell, cell);
      ctx.globalAlpha = Math.min(1, pulse + 0.3);
      ctx.strokeStyle = '#fff4cf';
      ctx.lineWidth = 2;
      ctx.strokeRect(phantom.cx - half + 1, phantom.cy - half + 1, cell - 2, cell - 2);
      ctx.restore();
    }
  }

  function drawBlock(x, y, s, ghost) {
    ctx.fillStyle = ghost ? 'rgba(220,210,180,0.4)' : '#b9a878';
    ctx.fillRect(x, y, s, s);
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.fillRect(x, y, s, Math.max(2, s * 0.18));
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.fillRect(x, y + s - Math.max(2, s * 0.18), s, Math.max(2, s * 0.18));
    ctx.strokeStyle = 'rgba(60,48,30,0.5)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, s - 1, s - 1);
  }

  // All citizen drawing happens in a local frame anchored at the feet (0,0),
  // up = negative y, then uniformly scaled by CITIZEN_SCALE so the people are big.
  function drawCitizen(c) {
    const S = CITIZEN_SCALE;
    ctx.save();
    ctx.translate(c.x, GROUND_Y);
    ctx.scale(S, S);

    if (c.fallen) {
      // fade out over the final stretch as they're about to evaporate
      ctx.globalAlpha = Math.min(1, c.fallenTimer / 1.4);
      ctx.fillStyle = '#9aa0bb';
      ctx.beginPath(); ctx.ellipse(0, -6, 18, 7, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#c2c7dd';
      ctx.beginPath(); ctx.arc(-14, -8, 6, 0, Math.PI * 2); ctx.fill();
      // life ring (time left to be healed)
      const frac = Math.max(0, c.fallenTimer / G.diff.fallenDuration);
      ctx.beginPath();
      ctx.strokeStyle = frac > 0.4 ? '#ffd166' : '#ff6b6b';
      ctx.lineWidth = 3;
      ctx.arc(0, -26, 10, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      return;
    }
    if (!c.alive) { ctx.restore(); return; }

    const color = PROF_COLOR[c.profession];
    const bobY = Math.sin(c.bob) * 2;
    const jumpY = c.jumpY || 0;        // builder hop height (local px)
    const cy = -28 - bobY - jumpY;     // torso anchor

    // shadow stays on the ground (shrinks a touch when the builder hops)
    ctx.fillStyle = `rgba(0,0,0,${0.18 - jumpY * 0.002})`;
    ctx.beginPath(); ctx.ellipse(0, -2, 11, 4, 0, 0, Math.PI * 2); ctx.fill();

    // legs (simple walk; tuck up during a hop)
    const stride = Math.sin(c.bob) * 4;
    ctx.strokeStyle = '#3a3f5a';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, -16 - jumpY);
    ctx.lineTo(stride, -2 - jumpY * 0.6);
    ctx.moveTo(0, -16 - jumpY);
    ctx.lineTo(-stride, -2 - jumpY * 0.6);
    ctx.stroke();

    // body
    ctx.fillStyle = color;
    ctx.beginPath(); roundRect(ctx, -8, cy + 4, 16, 18, 4); ctx.fill();

    // head
    ctx.fillStyle = '#f3e3c8';
    ctx.beginPath(); ctx.arc(0, cy - 2, 7, 0, Math.PI * 2); ctx.fill();

    // facing nose
    ctx.fillStyle = '#d9c4a0';
    ctx.fillRect(c.dir > 0 ? 5 : -7, cy - 4, 2, 3);

    drawItem(c, color, cy, jumpY);
    ctx.restore();
  }

  // Held item, in the same feet-anchored local frame (up = negative y).
  // Items sit at a fixed height (they don't bob with the walk), but the builder's
  // block rides up with the hop so it's lifted into place at the top of the jump.
  function drawItem(c, color, cy, jumpY) {
    const side = c.dir > 0 ? 11 : -11;
    ctx.save();
    switch (c.profession) {
      case PROF.MEDIC: // first-aid kit
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(side - 5, -20, 10, 8);
        ctx.fillStyle = '#e23b3b';
        ctx.fillRect(side - 1, -19, 2, 6);
        ctx.fillRect(side - 4, -17, 8, 2);
        break;
      case PROF.ASSASSIN: // sword
        ctx.strokeStyle = '#e9eefc';
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(side, -30); ctx.lineTo(side, -12); ctx.stroke();
        ctx.strokeStyle = '#c9a24a';
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(side - 4, -16); ctx.lineTo(side + 4, -16); ctx.stroke();
        break;
      case PROF.COWBOY: // gun
        ctx.fillStyle = '#3b3b3b';
        ctx.fillRect(c.dir > 0 ? 8 : -16, -24, 9, 3);
        ctx.fillRect(c.dir > 0 ? 8 : -8, -24, 3, 6);
        break;
      case PROF.KNIGHT: { // shield
        const w = c.dir > 0 ? 7 : -7;
        ctx.fillStyle = '#cfe0ff';
        ctx.beginPath();
        ctx.moveTo(side, -30);
        ctx.lineTo(side + w, -26);
        ctx.lineTo(side + w, -16);
        ctx.lineTo(side, -12);
        ctx.lineTo(side - w, -16);
        ctx.lineTo(side - w, -26);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = '#7fb4ff';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        break;
      }
      case PROF.BUILDER: // carried block — rises with the builder during the hop
        drawBlock(side - 6, -26 - jumpY, 12, false);
        break;
      default:
        break;
    }
    ctx.restore();
  }

  function drawCloud() {
    const x = G.cloudX;
    const y = CLOUD_Y;
    ctx.save();
    ctx.fillStyle = '#f4f8ff';
    const puffs = [[-34, 6, 20], [-12, -6, 24], [14, -4, 22], [34, 8, 18], [0, 12, 26]];
    for (const [dx, dy, r] of puffs) {
      ctx.beginPath();
      ctx.arc(x + dx, y + dy, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#dbe6f7';
    ctx.beginPath();
    ctx.ellipse(x, y + 18, 44, 12, 0, 0, Math.PI * 2);
    ctx.fill();
    // tiny eyes
    ctx.fillStyle = '#33405f';
    ctx.beginPath();
    ctx.arc(x - 8, y + 2, 2.4, 0, Math.PI * 2);
    ctx.arc(x + 8, y + 2, 2.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawBolt(bl) {
    const a = bl.life / bl.max;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.strokeStyle = '#fdfbe6';
    ctx.shadowColor = '#bfe0ff';
    ctx.shadowBlur = 16;
    ctx.lineWidth = 3;
    ctx.beginPath();
    // From the cloud over to the strike column, then straight down to the ground.
    // Anchor the top to the cloud's *current* position so the bolt trails it as it drifts.
    const topY = CLOUD_Y + 18;
    ctx.moveTo(G.cloudX, topY);
    const segs = 8;
    for (let i = 1; i <= segs; i++) {
      const ty = topY + (GROUND_Y - topY) * (i / segs);
      const jitter = Math.sin(bl.seed + i * 2.3) * 12;
      ctx.lineTo(bl.x + jitter, ty); // vertical at the strike point
    }
    ctx.stroke();
    ctx.restore();
  }

  // HUD skin — the same storybook-almanac palette as the menu (styles.css).
  // The readouts are little cream paper tags pinned to the sky with ink
  // linework and a hard dropped shadow, so they stay legible day or night.
  const HUD = {
    paper: '#f3e7c9', paperDeep: '#ecdcb6',
    ink: '#2b2c46', inkSoft: '#565576',
    sun: '#e3a127', grass: '#5a7d42', storm: '#d1413f',
    serif: '"Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif',
    sans: 'ui-sans-serif,"Segoe UI",system-ui,sans-serif',
  };

  function tw(text, font) { ctx.font = font; return ctx.measureText(text).width; }

  // A pinned paper tag: hard shadow, cream fill, ink edge.
  function paperTag(x, y, w, h, r = 9) {
    ctx.fillStyle = 'rgba(20,22,42,0.40)';
    roundRectPath(x + 2.5, y + 3.5, w, h, r); ctx.fill();
    ctx.fillStyle = HUD.paper;
    roundRectPath(x, y, w, h, r); ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = HUD.ink;
    roundRectPath(x, y, w, h, r); ctx.stroke();
  }

  function drawHUD() {
    ctx.save();
    ctx.textBaseline = 'middle';
    // On a phone the readouts are magnified so they stay legible at arm's length.
    const k = isMobile ? 1.5 : 1;
    const pad = 12 * k, tagH = 40 * k, tagY = 12 * k, edge = 14 * k;
    const labelFont = `italic ${13 * k}px ${HUD.serif}`;
    const numFont = `700 ${22 * k}px ${HUD.serif}`;
    const nameFont = `700 ${18 * k}px ${HUD.serif}`;
    const statFont = `${12 * k}px ${HUD.sans}`;

    // --- Tag A: combo count -------------------------------------------------
    const comboLabel = 'Combo';
    const comboNum = `${G.combo}×`;
    const lw = tw(comboLabel, labelFont);
    const nw = tw(comboNum, numFont);
    const aW = pad * 2 + lw + 8 * k + nw, aX = edge;
    paperTag(aX, tagY, aW, tagH);
    const aMid = tagY + tagH / 2;
    ctx.textAlign = 'left';
    ctx.font = labelFont; ctx.fillStyle = HUD.inkSoft;
    ctx.fillText(comboLabel, aX + pad, aMid);
    ctx.font = numFont;
    ctx.fillStyle = G.combo > 0 ? HUD.sun : HUD.inkSoft;
    ctx.fillText(comboNum, aX + pad + lw + 8 * k, aMid + 1);

    // --- Tag B: peace-streak gauge -----------------------------------------
    const gaugeW = 150 * k, bW = pad * 2 + gaugeW, bX = aX + aW + 10 * k;
    paperTag(bX, tagY, bW, tagH);
    ctx.font = labelFont; ctx.fillStyle = HUD.inkSoft;
    ctx.fillText('peace streak', bX + pad, tagY + 13 * k);
    // gauge track + grass fill, both ink-outlined like the menu chips
    const gx = bX + pad, gy = tagY + 23 * k, gh = 9 * k;
    ctx.fillStyle = HUD.paperDeep;
    roundRectPath(gx, gy, gaugeW, gh, 4); ctx.fill();
    const fw = gaugeW * Math.min(1, G.survivalTimer / G.diff.survivalInterval);
    if (fw > 2) {
      ctx.fillStyle = HUD.grass;
      roundRectPath(gx, gy, fw, gh, 4); ctx.fill();
    }
    ctx.lineWidth = 1.5; ctx.strokeStyle = HUD.ink;
    roundRectPath(gx, gy, gaugeW, gh, 4); ctx.stroke();

    // --- Control tags (mobile): pause + mute, far right ---------------------
    // Drawn as the same paper tags as the rest of the HUD (one coordinate space,
    // one scale) and tap-tested in the pointerdown handler via hudHit.
    let rightEdge = W - edge;          // where the name tag's right edge lands
    if (isMobile) {
      const btn = tagH, gap = 8 * k;   // square tags, same height as the readouts
      const muteX = W - edge - btn;
      const pauseX = muteX - gap - btn;
      drawControlTag(pauseX, tagY, btn, 'pause');
      drawControlTag(muteX, tagY, btn, 'mute');
      hudHit = [
        { id: 'pause', x: pauseX, y: tagY, w: btn, h: btn },
        { id: 'mute', x: muteX, y: tagY, w: btn, h: btn },
      ];
      rightEdge = pauseX - gap;
    }

    // --- Tag C: cloud name + tally (right) ----------------------------------
    // The verbose saved/lost line is dropped on mobile to keep the tag compact.
    const total = G.statue.targets.length;
    const statStr = isMobile
      ? `statue ${G.buildIndex}/${total}`
      : `statue ${G.buildIndex}/${total}  ·  saved ${G.saves}  ·  lost ${G.casualties}`;
    const cW = pad * 2 + Math.max(tw(G.name, nameFont), tw(statStr, statFont));
    const cX = rightEdge - cW;
    paperTag(cX, tagY, cW, tagH);
    const cRight = cX + cW - pad;
    ctx.textAlign = 'right';
    ctx.font = nameFont; ctx.fillStyle = HUD.ink;
    ctx.fillText(G.name, cRight, tagY + 13 * k);
    ctx.font = statFont; ctx.fillStyle = HUD.inkSoft;
    ctx.fillText(statStr, cRight, tagY + 28 * k);

    // --- muted: a small centre tag for desktop (mobile shows it on the ♪ tag) -
    if (Sound.isMuted() && !isMobile) {
      const mLabel = '♪ muted';
      const mW = pad * 2 + tw(mLabel, labelFont);
      const mX = (W - mW) / 2;
      paperTag(mX, tagY, mW, tagH);
      ctx.textAlign = 'center';
      ctx.font = labelFont; ctx.fillStyle = HUD.storm;
      ctx.fillText(mLabel, mX + mW / 2, tagY + tagH / 2);
    }
    ctx.restore();
  }

  // A square HUD control tag with a drawn glyph (no emoji, stays crisp at scale).
  // 'pause' shows ❚❚ while playing and ▶ while paused; 'mute' shows ♪ with a red
  // slash when muted.
  function drawControlTag(x, y, sz, kind) {
    paperTag(x, y, sz, sz);
    const cx = x + sz / 2, cy = y + sz / 2;
    ctx.save();
    if (kind === 'pause') {
      ctx.fillStyle = HUD.ink;
      if (state === 'paused') {
        const r = sz * 0.2;
        ctx.beginPath();
        ctx.moveTo(cx - r * 0.7, cy - r);
        ctx.lineTo(cx - r * 0.7, cy + r);
        ctx.lineTo(cx + r, cy);
        ctx.closePath(); ctx.fill();
      } else {
        const bw = sz * 0.12, bh = sz * 0.36, g = sz * 0.09;
        ctx.fillRect(cx - g - bw, cy - bh / 2, bw, bh);
        ctx.fillRect(cx + g, cy - bh / 2, bw, bh);
      }
    } else { // mute
      const muted = Sound.isMuted();
      ctx.globalAlpha = muted ? 0.45 : 1;
      ctx.fillStyle = HUD.ink;
      ctx.font = `${Math.round(sz * 0.5)}px ${HUD.serif}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('♪', cx, cy + sz * 0.04);
      if (muted) {
        ctx.globalAlpha = 1;
        ctx.strokeStyle = HUD.storm;
        ctx.lineWidth = Math.max(2, sz * 0.06);
        ctx.beginPath();
        ctx.moveTo(x + sz * 0.24, y + sz * 0.24);
        ctx.lineTo(x + sz * 0.76, y + sz * 0.76);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  // Rounded-rectangle path helper (leaves the path ready to fill/stroke).
  function roundRectPath(x, y, w, h, r) {
    r = Math.min(r, h / 2, w / 2);
    ctx.beginPath();
    roundRect(ctx, x, y, w, h, r);
  }

  function render() {
    ctx.clearRect(0, 0, W, H);
    drawBackground();
    drawStatue();

    // bullets behind people
    for (const b of G.bullets) {
      ctx.fillStyle = '#ffe08a';
      ctx.beginPath();
      ctx.arc(b.x, b.y, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,224,138,0.35)';
      ctx.fillRect(b.x - b.dir * 12, b.y - 1.5, 12, 3);
    }

    // citizens: fallen first (under), then standing
    for (const c of G.citizens) if (c.fallen) drawCitizen(c);
    for (const c of G.citizens) if (!c.fallen) drawCitizen(c);

    // particles
    for (const p of G.particles) {
      ctx.globalAlpha = Math.max(0, p.life / p.max);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
    }
    ctx.globalAlpha = 1;

    for (const bl of G.bolts) drawBolt(bl);

    drawCloud();

    drawHUD();
  }

  function roundRect(c, x, y, w, h, r) {
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
  }

  // ---------------------------------------------------------------------------
  // Main loop
  // ---------------------------------------------------------------------------
  let lastT = 0;
  function frame(t) {
    requestAnimationFrame(frame);
    const now = t / 1000;
    let dt = now - lastT;
    lastT = now;
    if (!Number.isFinite(dt)) dt = 0;
    dt = Math.min(dt, 0.05); // clamp big stalls

    if (state === 'playing') {
      update(dt);
      if (state === 'playing') render(); // update() may have ended the game
    } else if (state === 'paused' && G) {
      render();
    }
  }
  requestAnimationFrame(frame);

  // ---------------------------------------------------------------------------
  // Input
  // ---------------------------------------------------------------------------
  function canvasX(evt) {
    const rect = canvas.getBoundingClientRect();
    return ((evt.clientX - rect.left) / rect.width) * W;
  }
  function canvasY(evt) {
    const rect = canvas.getBoundingClientRect();
    return ((evt.clientY - rect.top) / rect.height) * H;
  }

  // Pointer Events unify mouse and touch: the cloud drifts to the pointer
  // (hover on desktop, finger-drag on a phone) and a press/tap strikes lightning.
  canvas.addEventListener('pointermove', (e) => {
    if (G) G.mouseX = Math.max(0, Math.min(W, canvasX(e)));
  });
  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();           // suppress synthetic mouse events / scrolling on touch
    Sound.resume();
    goFullscreen();               // best-effort, once, on touch (Android in-browser)
    // On-canvas HUD controls take the tap before it becomes a lightning strike.
    if (isMobile && hudHit.length) {
      const vx = canvasX(e), vy = canvasY(e);
      for (const b of hudHit) {
        if (vx >= b.x && vx <= b.x + b.w && vy >= b.y && vy <= b.y + b.h) {
          if (b.id === 'pause') togglePause();
          else Sound.toggleMute();
          return;
        }
      }
    }
    if (state === 'playing') {
      G.mouseX = Math.max(0, Math.min(W, canvasX(e)));
      strike(G.mouseX);
    }
  });

  // On a phone, try to hide the browser chrome on the first tap. iOS Safari has
  // no element Fullscreen API (use Add to Home Screen instead), so this is a
  // silent no-op there; on Android Chrome it goes edge-to-edge. Desktop is left
  // alone so a click never yanks the whole page into fullscreen.
  let fsTried = false;
  function goFullscreen() {
    if (fsTried || !isMobile) return;
    fsTried = true;
    const el = document.documentElement;
    const req = el.requestFullscreen || el.webkitRequestFullscreen;
    if (req) { try { req.call(el); } catch (_) { /* ignore */ } }
  }
  // No long-press context menu interrupting play on touch.
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
      e.preventDefault();
      if (state === 'playing') strike(G.cloudX);
    } else if (e.key === 'm' || e.key === 'M') {
      Sound.toggleMute();
    } else if (e.key === 'p' || e.key === 'P') {
      if (state === 'playing') { state = 'paused'; show('pauseVeil', true); }
      else if (state === 'paused') { state = 'playing'; show('pauseVeil', false); }
    }
  });

  // ---------------------------------------------------------------------------
  // Menus / UI wiring
  // ---------------------------------------------------------------------------
  const els = {
    menu: document.getElementById('menu'),
    end: document.getElementById('endScreen'),
    pause: document.getElementById('pauseVeil'),
    nameChoices: document.getElementById('nameChoices'),
    customName: document.getElementById('customName'),
    diffChoices: document.getElementById('diffChoices'),
    startBtn: document.getElementById('startBtn'),
    againBtn: document.getElementById('againBtn'),
    endTitle: document.getElementById('endTitle'),
    endBlurb: document.getElementById('endBlurb'),
    endStats: document.getElementById('endStats'),
    rotate: document.getElementById('rotateNudge'),
  };

  function show(id, on) {
    const map = { pauseVeil: els.pause, menu: els.menu, endScreen: els.end };
    const el = map[id];
    if (el) el.classList.toggle('hidden', !on);
  }

  // Name and busyness are chosen independently; both default to the easy choice.
  let selectedName = 0;        // default: Bolt (Easy)
  let chosenName = CLOUD_NAMES[selectedName].name;
  let chosenDiff = 'Easy';     // default busyness: Easy (Calm streets)

  CLOUD_NAMES.forEach((entry, i) => {
    const b = document.createElement('div');
    b.className = 'choice' + (i === selectedName ? ' active' : '');
    b.innerHTML = `${entry.name}<span class="sub">${entry.tier}</span>`;
    b.onclick = () => {
      selectedName = i;
      chosenName = entry.name;
      els.customName.value = '';
      [...els.nameChoices.children].forEach((c) => c.classList.toggle('active', c === b));
    };
    els.nameChoices.appendChild(b);
  });

  // Custom name overrides the preset; clearing it falls back to the selected preset.
  els.customName.addEventListener('input', () => {
    const v = els.customName.value.trim();
    if (v) {
      chosenName = v;
      [...els.nameChoices.children].forEach((c) => c.classList.remove('active'));
    } else {
      chosenName = CLOUD_NAMES[selectedName].name;
      [...els.nameChoices.children].forEach((c, i) => c.classList.toggle('active', i === selectedName));
    }
  });

  // Busyness selector — the flavour is the title, the Easy/Medium/Hard is the subtitle.
  Object.keys(DIFFS).forEach((k) => {
    const d = DIFFS[k];
    const b = document.createElement('div');
    b.className = 'choice' + (k === chosenDiff ? ' active' : '');
    b.innerHTML = `${d.sub}<span class="sub">${d.label}</span>`;
    b.onclick = () => {
      chosenDiff = k;
      [...els.diffChoices.children].forEach((c) => c.classList.toggle('active', c === b));
    };
    els.diffChoices.appendChild(b);
  });

  function startGame() {
    const name = (els.customName.value.trim() || chosenName || 'Cirrus').slice(0, 16);
    chosenName = name;
    // On a phone, widen the field to the screen's landscape aspect before the
    // statue is laid out, and size the backing store to match.
    if (isMobile) {
      W = chooseW();
      canvas.width = W;
      canvas.height = H;
    }
    G = newGame(name, chosenDiff);
    fitCanvas();
    state = 'playing';
    show('menu', false);
    show('endScreen', false);
    show('pauseVeil', false);
    Sound.resume();
  }

  function endGame(won) {
    if (state !== 'playing') return;
    state = won ? 'won' : 'lost';
    if (won) Sound.win(); else Sound.lose();
    els.endTitle.textContent = won ? 'Statue complete!' : 'The peace was broken';
    els.endTitle.className = won ? 'win' : 'lose';
    els.endBlurb.textContent = won
      ? `The people of the town raised "${G.name}" in your honor. Not one needless death went unanswered.`
      : `Too many citizens were lost for good. "${G.name}" will have to wait for a calmer sky.`;
    // Report the time the cloud drifted in in-game days/hours (a day = DAY_LENGTH).
    const totalHours = (G.elapsed / DAY_LENGTH) * 24;
    const days = Math.floor(totalHours / 24);
    const hours = Math.floor(totalHours % 24);
    const timeStr = days > 0 ? `${days}d ${hours}h` : `${hours}h`;
    const rows = [
      ['Time adrift', timeStr],
      ['Statue blocks', `${G.buildIndex}/${G.statue.targets.length}`],
      ['Best combo', `${G.bestCombo}×`],
      ['Citizens saved', `${G.saves}`],
      ['Lost forever', `${G.casualties}`],
    ];
    els.endStats.innerHTML = rows
      .map(([k, v]) => `<div class="k">${k}</div><div class="v">${v}</div>`)
      .join('');
    show('endScreen', true);
  }

  els.startBtn.onclick = startGame;
  els.againBtn.onclick = () => { show('endScreen', false); show('menu', true); state = 'menu'; };

  // ---------------------------------------------------------------------------
  // Mobile canvas fit (fill a landscape phone; clear of chrome & notches)
  // ---------------------------------------------------------------------------
  // Read the live safe-area insets (exposed as CSS vars in styles.css).
  function safeInsets() {
    const cs = getComputedStyle(document.documentElement);
    const px = (v) => parseFloat(cs.getPropertyValue(v)) || 0;
    return { t: px('--sa-top'), r: px('--sa-right'), b: px('--sa-bottom'), l: px('--sa-left') };
  }

  // The usable visible rectangle = visual viewport minus the safe-area insets.
  // visualViewport tracks the URL bar collapsing/expanding; insets dodge the notch.
  function usableSize() {
    const vv = window.visualViewport;
    const s = safeInsets();
    return {
      w: Math.max(1, (vv ? vv.width : window.innerWidth) - s.l - s.r),
      h: Math.max(1, (vv ? vv.height : window.innerHeight) - s.t - s.b),
    };
  }

  // Pick a virtual width so the field's aspect matches the device's *landscape*
  // aspect (long/short side), keeping H fixed. Clamped so it never gets narrower
  // than the desktop field or absurdly wide on ultratall phones.
  function chooseW() {
    const { w, h } = usableSize();
    return Math.round(H * Math.max(w, h) / Math.min(w, h)); // landscape aspect
  }

  // Fill the *entire* usable area — the visible viewport minus the URL bar and
  // safe-area insets — with no letterbox and no distortion. H is fixed; the
  // virtual width tracks the live aspect, and the statue (which stores an offset
  // from centre) is re-centred for free when W changes.
  function fitCanvas() {
    if (!isMobile) return;
    const vv = window.visualViewport;
    const s = safeInsets();
    const { w, h } = usableSize();
    if (w <= h) return; // portrait: covered by the rotate nudge — leave as-is

    const newW = Math.round(H * (w / h)); // backing-store aspect == visible aspect
    if (newW !== W) {
      W = newW;
      canvas.width = W;
      canvas.height = H;
      if (G) {
        for (const t of G.statue.targets) t.cx = W / 2 + t.dx; // keep it centred
        G.stars = makeStars(G.stars.length);                   // refill across new width
      }
    }
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    canvas.style.left = ((vv ? vv.offsetLeft : 0) + s.l) + 'px';
    canvas.style.top = ((vv ? vv.offsetTop : 0) + s.t) + 'px';
  }

  // ---------------------------------------------------------------------------
  // Touch controls & landscape nudge (mobile only)
  // ---------------------------------------------------------------------------
  function togglePause() {
    if (state === 'playing') { state = 'paused'; show('pauseVeil', true); }
    else if (state === 'paused' && !resumeAfterRotate) { state = 'playing'; show('pauseVeil', false); }
  }

  // When a phone is held upright, the lane is too narrow to play: nudge the
  // player to turn sideways and auto-pause until they do (then resume).
  let resumeAfterRotate = false;
  function checkOrientation() {
    if (!isMobile) return;
    const portrait = matchMedia('(orientation: portrait)').matches;
    els.rotate.classList.toggle('hidden', !portrait);
    if (portrait && state === 'playing') {
      state = 'paused';
      resumeAfterRotate = true;
    } else if (!portrait && state === 'paused' && resumeAfterRotate) {
      state = 'playing';
      resumeAfterRotate = false;
    }
  }

  if (isMobile) {
    // Tapping the pause veil resumes (there's no P key on a phone; pause/mute now
    // live on the canvas HUD itself — see drawControlTag / the pointerdown hit-test).
    els.pause.addEventListener('pointerdown', () => { if (!resumeAfterRotate) togglePause(); });

    const onViewportChange = () => { checkOrientation(); fitCanvas(); };
    matchMedia('(orientation: portrait)').addEventListener('change', onViewportChange);
    window.addEventListener('resize', onViewportChange);
    window.addEventListener('orientationchange', onViewportChange);
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', fitCanvas);
      window.visualViewport.addEventListener('scroll', fitCanvas);
    }
    checkOrientation();
  }
})();
