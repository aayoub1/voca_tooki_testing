// "Tooki's Word Run": a small runner to play on the loading screen. Tap / Space to jump
// (tap again in the air to flap once more), hop over rocks and crabs, and collect the
// letters of the word shown at the top, in order. Plain canvas, no libraries.
// Art: TemplateData/g-*.webp, cut from ChatGPT sheets at 2x the game's 640x300 units.
var vtGame = (function () {
  // GROUND is where feet touch: inside the sand band (it starts at y 238), not on its far edge.
  var W = 640, H = 300, GROUND = 260;
  var GRAVITY = 1900, JUMP = -660, FLAP = -540;
  var WORDS = ["SUN", "CAT", "MAP", "SEA", "DOG", "BOOK", "STAR", "FISH", "TREE", "BIRD", "SHIP", "MOON", "LEAF", "CAKE"];
  var FONT = "'Fredoka One', ui-rounded, 'Arial Rounded MT Bold', sans-serif";
  var NAVY = "#1d2a4d";

  // Sprite sheets: frame boxes match the cut script (frames are bottom-aligned with 4px padding).
  var RUN = { frameW: 111, frameH: 148, frames: 6 };
  var POSE = { frameW: 136, frameH: 168, frames: 5, takeoff: 0, air: 1, flap: 2, land: 3, dizzy: 4 };
  var BG = { w: 1800, h: 600, ground: 477 };
  var TOOKI_SCALE = 0.62;   // of the sprite-sheet size
  var OBSTACLES = {   // drawn at half the sprite size; hit boxes are a bit smaller than the art
    rock:    { w: 43, h: 20, hit: [6, 4] },
    rock2:   { w: 62, h: 22, hit: [8, 4] },
    crab:    { w: 47, h: 34, hit: [8, 8] },
    pillar:  { w: 45, h: 41, hit: [9, 4] },
    coconut: { w: 31, h: 30, hit: [4, 4], rolls: true },
    urchin:  { w: 46, h: 37, hit: [8, 8] }
  };

  var card = document.getElementById("vt-game");
  var canvas = document.getElementById("vt-game-canvas");
  var ctx = canvas.getContext("2d");
  var img = {};
  ["tooki-run", "tooki-poses", "bg", "coin", "sparkle", "puff"].concat(Object.keys(OBSTACLES)).forEach(function (n) {
    img[n] = new Image(); img[n].src = "TemplateData/g-" + n + ".webp";
  });
  function ready(i) { return i.complete && i.naturalWidth > 0; }

  // The canvas matches the on-screen pixel size exactly: a canvas the browser has to resample
  // again makes moving sprites shimmer.
  var scale = 1;
  function resize() {
    var w = Math.round(Math.min(W * 3, canvas.clientWidth * (window.devicePixelRatio || 1))) || W;
    if (canvas.width !== w) { canvas.width = w; canvas.height = Math.round(w * H / W); scale = w / W; coinCache = {}; }
  }

  var state = "idle", running = true, overAt = 0;
  var t = 0, speed, distance, score, best = 0, scrollFar = 0, scrollNear = 0;
  var bird, obstacles, letters, effects, spawnObstacleIn, spawnLetterIn;
  var word, wordIndex, banner, bannerUntil = 0, wordsDone;
  try { best = +localStorage.getItem("vtRunBest") || 0; } catch (e) {}

  // ---------- sound ----------
  // Short effects synthesised with Web Audio, so there are no sound files to download. The context is
  // created on the first tap (browsers only allow audio after a user gesture). M or the speaker toggles mute.
  var audioCtx = null, muted = false;
  try { muted = localStorage.getItem("vtRunMuted") === "1"; } catch (e) {}
  function tone(freq, toFreq, dur, type, vol, delay) {
    if (muted) return;
    if (!audioCtx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      audioCtx = new AC();
    }
    if (audioCtx.state === "suspended") audioCtx.resume();
    var t0 = audioCtx.currentTime + (delay || 0), osc = audioCtx.createOscillator(), gain = audioCtx.createGain();
    osc.type = type; osc.frequency.setValueAtTime(freq, t0);
    if (toFreq) osc.frequency.exponentialRampToValueAtTime(toFreq, t0 + dur);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain); gain.connect(audioCtx.destination);
    osc.start(t0); osc.stop(t0 + dur + 0.03);
  }
  var sfx = {
    jump: function () { tone(330, 640, 0.16, "sine", 0.16); },
    flap: function () { tone(560, 820, 0.07, "triangle", 0.1); tone(640, 940, 0.07, "triangle", 0.08, 0.06); },
    coin: function () { tone(988, 0, 0.08, "square", 0.05); tone(1319, 0, 0.2, "square", 0.05, 0.07); },
    miss: function () { tone(240, 190, 0.07, "triangle", 0.07); },
    word: function () { [523, 659, 784, 1047].forEach(function (f, i) { tone(f, 0, 0.18, "triangle", 0.11, i * 0.09); }); },
    crash: function () { tone(320, 80, 0.32, "sawtooth", 0.07); tone(170, 60, 0.3, "sine", 0.18); }
  };
  function toggleMute() {
    muted = !muted;
    try { localStorage.setItem("vtRunMuted", muted ? "1" : "0"); } catch (e) {}
    if (!muted) sfx.coin();
  }
  var MUTE = { x: W - 26, y: H - 24, r: 15 };   // speaker button, bottom-right of the game

  // Moving things are drawn on whole screen pixels: at sub-pixel positions their edges turn soft
  // and sharp from frame to frame, which reads as shaking on a 100%-scaled screen.
  function px(v) { return Math.round(v * scale) / scale; }
  // Things that move with the sand start a whole number of pixels from its scroll position, so
  // snapping both keeps them in step instead of wobbling by a pixel against the ground.
  function withGround(x) { return scrollNear + px(x - scrollNear); }

  function rand(a, b) { return a + Math.random() * (b - a); }
  function pick(list) { return list[Math.floor(Math.random() * list.length)]; }

  function newWord() {
    var next;
    do { next = pick(WORDS); } while (next === word);
    word = next; wordIndex = 0;
  }

  function reset() {
    speed = 280; distance = 0; score = 0; wordsDone = 0;
    bird = { y: GROUND, vy: 0, flaps: 0, flapUntil: 0, jumpAt: -1 };
    obstacles = []; letters = []; effects = [];
    spawnObstacleIn = 1.2; spawnLetterIn = 0.6;
    newWord();
  }

  function effect(kind, x, y) { effects.push({ kind: kind, x: x, y: y, born: t }); }

  function jump() {
    if (state === "idle") { state = "run"; reset(); }
    if (state === "over") { if (t - overAt > 0.5) { state = "run"; reset(); } return; }
    if (bird.y >= GROUND - 0.5) { bird.vy = JUMP; bird.flaps = 1; bird.jumpAt = t; effect("puff", 92, GROUND - 6); sfx.jump(); }
    else if (bird.flaps < 2) { bird.vy = FLAP; bird.flaps++; bird.flapUntil = t + 0.22; sfx.flap(); }
  }

  function spawnObstacle() {
    var kinds = speed > 380 ? ["rock", "rock2", "crab", "pillar", "coconut", "urchin"] : ["rock", "rock2", "crab", "coconut"];
    var kind = pick(kinds), o = OBSTACLES[kind];
    obstacles.push({ kind: kind, x: withGround(W + 20), w: o.w, h: o.h, spin: 0 });
  }

  function spawnLetter() {
    var need = word.charAt(wordIndex);
    var ch = Math.random() < 0.7 ? need : pick("ABCDEFGHIKLMNOPRSTUW".replace(need, "").split(""));
    var y = pick([GROUND - 30, GROUND - 100, GROUND - 145]);
    // Keep low letters away from obstacles so every letter can be reached.
    for (var i = 0; i < obstacles.length; i++)
      if (Math.abs(obstacles[i].x - (W + 20)) < 80 && y > GROUND - 60) y = GROUND - 105;
    letters.push({ ch: ch, x: withGround(W + 20), y: y, bob: rand(0, 6) });
  }

  function update(dt) {
    t += dt;
    effects = effects.filter(function (e) { return t - e.born < 0.45; });
    if (state === "idle") { scrollFar -= 12 * dt; return; }
    if (state !== "run") return;
    speed = Math.min(560, speed + 7 * dt);
    distance += speed * dt;
    score = Math.floor(distance / 40) + wordsDone * 50;
    scrollNear -= speed * dt; scrollFar -= speed * 0.3 * dt;

    var wasAir = bird.y < GROUND;
    bird.vy += GRAVITY * dt; bird.y += bird.vy * dt;
    if (bird.y >= GROUND) {
      bird.y = GROUND; bird.vy = 0; bird.flaps = 0;
      if (wasAir) effect("puff", 92, GROUND - 6);
    }

    spawnObstacleIn -= dt; spawnLetterIn -= dt;
    if (spawnObstacleIn <= 0) { spawnObstacle(); spawnObstacleIn = rand(0.95, 1.8) * 300 / speed + 0.4; }
    if (spawnLetterIn <= 0) { spawnLetter(); spawnLetterIn = rand(0.9, 1.6); }

    var bx = 98, bw = 40, bh = 62, by = bird.y - bh;
    obstacles.forEach(function (o) {
      var def = OBSTACLES[o.kind];
      o.x -= speed * dt * (def.rolls ? 1.25 : 1); o.spin -= speed * dt / 15;
      var ox = o.x + def.hit[0], ow = o.w - def.hit[0] * 2, oh = o.h - def.hit[1];
      if (state === "run" && ox < bx + bw && ox + ow > bx && GROUND - oh < by + bh) {
        state = "over"; overAt = t; bird.y = GROUND; effect("puff", bx + 20, GROUND - 10); sfx.crash();
        if (score > best) { best = score; try { localStorage.setItem("vtRunBest", best); } catch (e) {} }
      }
    });
    letters.forEach(function (l) {
      l.x -= speed * dt;
      if (!l.taken && Math.abs(l.x - (bx + bw / 2)) < 30 && Math.abs(l.y - (by + bh / 2)) < 38) {
        l.taken = true;
        if (l.ch === word.charAt(wordIndex)) {
          wordIndex++; effect("sparkle", l.x, l.y);
          if (wordIndex === word.length) { wordsDone++; banner = word + "!"; bannerUntil = t + 1.4; newWord(); sfx.word(); }
          else sfx.coin();
        } else { effect("puff", l.x, l.y); sfx.miss(); }
      }
    });
    obstacles = obstacles.filter(function (o) { return o.x > -80; });
    letters = letters.filter(function (l) { return l.x > -40 && !l.taken; });
  }

  // ---------- drawing ----------
  function roundRect(x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  // The backdrop is drawn in two bands (scenery slow, sand at running speed). Every other copy is
  // mirrored, so the copies meet edge to edge without a seam.
  function drawBand(offset, sy, sh, dy, dh) {
    var k = BG.ground ? H / BG.h : 1, tileW = BG.w * k;
    var start = Math.floor(-offset / tileW);
    for (var i = start; i * tileW + offset < W; i++) {
      var x = px(i * tileW) + px(offset), w = px((i + 1) * tileW) - px(i * tileW);
      if (i % 2) { ctx.save(); ctx.translate(x + w, 0); ctx.scale(-1, 1); ctx.drawImage(img.bg, 0, sy, BG.w, sh, 0, dy, w, dh); ctx.restore(); }
      else ctx.drawImage(img.bg, 0, sy, BG.w, sh, x, dy, w, dh);
    }
  }
  function drawBackground() {
    if (!ready(img.bg)) { ctx.fillStyle = "#8fd3f4"; ctx.fillRect(0, 0, W, H); ctx.fillStyle = "#f1c977"; ctx.fillRect(0, GROUND, W, H - GROUND); return; }
    var k = H / BG.h, groundY = BG.ground * k;
    drawBand(scrollFar, 0, BG.ground, 0, groundY);
    drawBand(scrollNear, BG.ground, BG.h - BG.ground, groundY, H - groundY);
  }

  function drawSheet(sheet, def, frame, x, groundY) {
    var w = def.frameW * TOOKI_SCALE, h = def.frameH * TOOKI_SCALE;
    ctx.drawImage(sheet, frame * def.frameW, 0, def.frameW, def.frameH, px(x - w / 2), px(groundY - h + 2), w, h);
  }

  function drawBird() {
    var x = 118, y = bird.y;
    ctx.fillStyle = "rgba(60,40,10,.18)";
    ctx.beginPath(); ctx.ellipse(x, GROUND + 2, 20 * Math.max(0.4, 1 - (GROUND - y) / 220), 4, 0, 0, 7); ctx.fill();
    if (state === "over") return drawSheet(img["tooki-poses"], POSE, POSE.dizzy, x, GROUND);
    if (state === "idle") return drawSheet(img["tooki-run"], RUN, 0, x, GROUND - Math.abs(Math.sin(t * 3)) * 3);
    if (y >= GROUND) return drawSheet(img["tooki-run"], RUN, Math.floor(t * 14) % RUN.frames, x, y);
    var pose = t < bird.flapUntil ? POSE.flap : t - bird.jumpAt < 0.09 ? POSE.takeoff : bird.vy < 120 ? POSE.air : POSE.land;
    drawSheet(img["tooki-poses"], POSE, pose, x, y);
  }

  function drawObstacle(o) {
    var def = OBSTACLES[o.kind], i = img[o.kind];
    if (!ready(i)) return;
    if (def.rolls) {
      ctx.save(); ctx.translate(px(o.x + o.w / 2), GROUND - o.h / 2 + 1); ctx.rotate(o.spin);
      ctx.drawImage(i, -o.w / 2, -o.h / 2, o.w, o.h); ctx.restore();
    } else ctx.drawImage(i, px(o.x), GROUND - o.h + 2, o.w, o.h);
  }

  // Each lettered coin is rendered once into a small canvas and moved as one image. Drawn live, the
  // browser snaps the text to whole pixels while the coin moves smoothly, so the letter shook on it.
  var COIN_R = 18, coinCache = {}, halo = null;
  function coinSprite(ch) {
    if (coinCache[ch]) return coinCache[ch];
    if (!ready(img.coin) || (document.fonts && !document.fonts.check("19px 'Fredoka One'"))) return null;
    var c = document.createElement("canvas"), g = c.getContext("2d");
    c.width = c.height = Math.ceil(COIN_R * 2 * scale);
    g.imageSmoothingQuality = "high";
    g.scale(scale, scale);
    g.drawImage(img.coin, 0, 0, COIN_R * 2, COIN_R * 2);
    g.fillStyle = NAVY; g.font = "19px " + FONT; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(ch, COIN_R, COIN_R + 1);
    return (coinCache[ch] = c);
  }
  // Soft glow behind the letter that's needed next; pulsing its opacity is far cheaper than shadowBlur.
  function haloSprite() {
    if (halo) return halo;
    var R = 34;
    halo = document.createElement("canvas"); halo.width = halo.height = R * 2;
    var g = halo.getContext("2d"), grad = g.createRadialGradient(R, R, COIN_R * 0.8, R, R, R);
    grad.addColorStop(0, "rgba(255,214,64,.95)"); grad.addColorStop(1, "rgba(255,214,64,0)");
    g.fillStyle = grad; g.fillRect(0, 0, R * 2, R * 2);
    return halo;
  }

  function drawLetter(l) {
    var x = px(l.x), y = px(l.y + Math.sin(t * 4 + l.bob) * 4), r = COIN_R;
    if (l.ch === word.charAt(wordIndex)) {
      ctx.globalAlpha = 0.75 + Math.sin(t * 8) * 0.25;
      ctx.drawImage(haloSprite(), x - 34, y - 34, 68, 68);
      ctx.globalAlpha = 1;
    }
    var sprite = coinSprite(l.ch);
    if (sprite) { ctx.drawImage(sprite, x - r, y - r, r * 2, r * 2); return; }
    if (ready(img.coin)) ctx.drawImage(img.coin, x - r, y - r, r * 2, r * 2);
    else { ctx.fillStyle = "#ffcc33"; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); }
    ctx.fillStyle = NAVY; ctx.font = "19px " + FONT;
    ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(l.ch, x, y + 1);
  }

  function drawEffect(e) {
    var a = Math.min(1, (t - e.born) / 0.45), i = img[e.kind];
    if (!ready(i)) return;
    ctx.globalAlpha = 1 - a;
    var w = e.kind === "puff" ? 30 + a * 14 : 26 + a * 18, h = w * i.naturalHeight / i.naturalWidth;
    ctx.drawImage(i, e.x - w / 2 - (e.kind === "puff" ? a * 18 : 0), e.y - h / 2 - a * 6, w, h);
    ctx.globalAlpha = 1;
  }

  function drawHud() {
    ctx.textBaseline = "middle";
    var size = 26, gap = 5, x0 = 12, y0 = 10, wordW = 58 + word.length * (size + gap);
    ctx.fillStyle = "rgba(255,255,255,.85)"; roundRect(x0, y0 - 4, wordW, size + 8, 10); ctx.fill();
    ctx.textAlign = "left"; ctx.fillStyle = NAVY; ctx.font = "14px " + FONT; ctx.fillText("Spell", x0 + 10, y0 + size / 2);
    for (var i = 0; i < word.length; i++) {
      var x = x0 + 52 + i * (size + gap);
      roundRect(x, y0, size, size, 7); ctx.fillStyle = i < wordIndex ? "#3fb26b" : "#e8eef5"; ctx.fill();
      ctx.fillStyle = i < wordIndex ? "#fff" : "rgba(29,42,77,.4)";
      ctx.textAlign = "center"; ctx.font = "16px " + FONT;
      ctx.fillText(word.charAt(i), x + size / 2, y0 + size / 2 + 1);
    }
    var label = "Score " + score + "  ·  Best " + best;
    ctx.font = "14px " + FONT; var lw = ctx.measureText(label).width + 22;
    ctx.fillStyle = "rgba(255,255,255,.85)"; roundRect(W - 12 - lw, y0 - 4, lw, size + 8, 10); ctx.fill();
    ctx.textAlign = "center"; ctx.fillStyle = NAVY; ctx.fillText(label, W - 12 - lw / 2, y0 + size / 2);
    if (t < bannerUntil) {
      var s = 1 + Math.max(0, bannerUntil - t - 1.1) * 1.5;
      ctx.save(); ctx.translate(W / 2, 92); ctx.scale(s, s);
      ctx.textAlign = "center"; ctx.font = "36px " + FONT;
      ctx.lineWidth = 7; ctx.strokeStyle = "#fff"; ctx.lineJoin = "round"; ctx.strokeText(banner, 0, 0);
      ctx.fillStyle = "#2f9e5b"; ctx.fillText(banner, 0, 0); ctx.restore();
    }
  }

  function drawMessage(title, sub) {
    ctx.fillStyle = "rgba(255,255,255,.88)"; roundRect(W / 2 - 190, 66, 380, 92, 18); ctx.fill();
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillStyle = NAVY; ctx.font = "28px " + FONT; ctx.fillText(title, W / 2, 98);
    ctx.font = "15px " + FONT; ctx.fillStyle = "#4a5578"; ctx.fillText(sub, W / 2, 132);
  }

  function drawMuteButton() {
    ctx.fillStyle = "rgba(255,255,255,.85)"; ctx.beginPath(); ctx.arc(MUTE.x, MUTE.y, MUTE.r, 0, 7); ctx.fill();
    ctx.save(); ctx.translate(MUTE.x - 2, MUTE.y);
    ctx.fillStyle = NAVY; ctx.beginPath();
    ctx.moveTo(-7, -3); ctx.lineTo(-3, -3); ctx.lineTo(2, -8); ctx.lineTo(2, 8); ctx.lineTo(-3, 3); ctx.lineTo(-7, 3); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = NAVY; ctx.lineWidth = 2; ctx.lineCap = "round";
    if (muted) {
      ctx.beginPath(); ctx.moveTo(5, -4); ctx.lineTo(11, 4); ctx.moveTo(11, -4); ctx.lineTo(5, 4); ctx.stroke();
    } else {
      ctx.beginPath(); ctx.arc(3, 0, 5, -0.8, 0.8); ctx.stroke();
      ctx.beginPath(); ctx.arc(3, 0, 9, -0.8, 0.8); ctx.stroke();
    }
    ctx.restore();
  }

  function draw() {
    resize();
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.imageSmoothingQuality = "high";   // the 2x art is shrunk; low quality flickers on moving edges
    drawBackground();
    obstacles.forEach(drawObstacle);
    letters.forEach(drawLetter);
    drawBird();
    effects.forEach(drawEffect);
    if (state !== "idle") drawHud();
    if (state === "idle") drawMessage("Tooki's Word Run", "Tap or press Space to jump · collect the letters");
    if (state === "over") drawMessage("Oops!", "Score " + score + "  ·  tap to try again");
    drawMuteButton();
  }

  // Frame timestamps wobble by a few ms around the display's refresh interval while the screen
  // still shows frames evenly, so moving by the raw time made everything shake. Steps are whole
  // refresh intervals (learnt from the timestamps); a dropped frame still counts as two.
  var last = 0, frameDt = 1 / 60, frames = 0;
  function frame(now) {
    if (!running) return;
    var raw = last ? (now - last) / 1000 : 0; last = now;
    if (raw > 0 && raw < frameDt * 1.5) frameDt += (raw - frameDt) * (frames++ < 30 ? 0.3 : 0.05);
    var dt = raw > 0 ? Math.min(0.05, Math.max(1, Math.round(raw / frameDt)) * frameDt) : 0;
    update(dt); draw();
    requestAnimationFrame(frame);
  }

  function onKey(e) {
    if (e.code === "Space" || e.code === "ArrowUp" || e.code === "KeyW") { e.preventDefault(); jump(); }
    else if (e.code === "KeyM") toggleMute();
  }
  // A tap anywhere on the loading screen jumps (the frame alone is a small target on phones);
  // real buttons like "Let's go!" keep their own clicks.
  var tapArea = document.getElementById("vt-loader") || card;
  function onTap(e) {
    if (e.button > 0 || e.target.closest("button, a")) return;
    e.preventDefault();
    var r = canvas.getBoundingClientRect(), x = (e.clientX - r.left) * W / r.width, y = (e.clientY - r.top) * H / r.height;
    if (Math.hypot(x - MUTE.x, y - MUTE.y) <= MUTE.r + 6) toggleMute(); else jump();
  }
  tapArea.addEventListener("pointerdown", onTap);
  document.addEventListener("keydown", onKey);

  reset(); state = "idle";
  requestAnimationFrame(frame);

  return {
    stop: function () {
      running = false; document.removeEventListener("keydown", onKey);
      tapArea.removeEventListener("pointerdown", onTap);
      if (audioCtx) audioCtx.close();
    }
  };
})();
