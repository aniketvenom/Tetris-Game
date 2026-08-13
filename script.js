(() => {
  "use strict";

  const COLS = 10, ROWS = 20;
  const CELL = 30;
  const TYPES = ["I", "O", "T", "S", "Z", "J", "L"];
  const COLORS = {
    I: "#27e8ff", O: "#ffe45b", T: "#b16cff",
    S: "#54e57b", Z: "#ff5270", J: "#5b8cff", L: "#ff9c4a"
  };
  const SHAPES = {
    I: [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]],
    O: [[1,1],[1,1]],
    T: [[0,1,0],[1,1,1],[0,0,0]],
    S: [[0,1,1],[1,1,0],[0,0,0]],
    Z: [[1,1,0],[0,1,1],[0,0,0]],
    J: [[1,0,0],[1,1,1],[0,0,0]],
    L: [[0,0,1],[1,1,1],[0,0,0]]
  };

  const canvas = document.getElementById("gameCanvas");
  const ctx = canvas.getContext("2d");
  const overlay = document.getElementById("statusOverlay");
  const overlayTitle = document.getElementById("overlayTitle");
  const overlayText = document.getElementById("overlayText");
  const startBtn = document.getElementById("startBtn");
  const pauseBtn = document.getElementById("pauseBtn");
  const restartBtn = document.getElementById("restartBtn");
  const soundBtn = document.getElementById("soundBtn");
  const flashText = document.getElementById("flashText");

  const scoreEl = document.getElementById("score");
  const highEl = document.getElementById("highScore");
  const levelEl = document.getElementById("level");
  const linesEl = document.getElementById("lines");
  const comboEl = document.getElementById("combo");
  const holdPreview = document.getElementById("holdPreview");
  const nextPreview = document.getElementById("nextPreview");

  let board, current, holdType, canHold, queue;
  let score = 0, lines = 0, level = 1, combo = -1, b2b = false;
  let running = false, paused = false, gameOver = false;
  let lastTime = 0, dropCounter = 0, lockCounter = 0;
  let lastActionWasRotate = false, lastRotateKick = false;
  let muted = false, audioCtx = null;

  let highScore = Number(localStorage.getItem("neonTetrisHighScore") || 0);
  highEl.textContent = highScore.toLocaleString();

  function createBoard() {
    return Array.from({ length: ROWS }, () => Array(COLS).fill(null));
  }

  function cloneMatrix(m) {
    return m.map(row => row.slice());
  }

  function newBag() {
    const bag = TYPES.slice();
    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [bag[i], bag[j]] = [bag[j], bag[i]];
    }
    return bag;
  }

  function refillQueue() {
    while (queue.length < 7) queue.push(...newBag());
  }

  function createPiece(type) {
    const matrix = cloneMatrix(SHAPES[type]);
    const piece = {
      type, matrix,
      x: Math.floor((COLS - matrix[0].length) / 2),
      y: type === "I" ? -1 : 0,
      rotation: 0
    };
    return piece;
  }

  function resetGame() {
    board = createBoard();
    queue = [];
    refillQueue();
    holdType = null;
    canHold = true;
    score = 0; lines = 0; level = 1; combo = -1; b2b = false;
    paused = false; gameOver = false; running = false;
    current = null;
    updateStats();
    draw();
    showOverlay("READY?", "Stack blocks, clear lines, chase the high score.", "START GAME");
  }

  function startGame() {
    initAudio();
    board = createBoard();
    queue = [];
    refillQueue();
    holdType = null;
    canHold = true;
    score = 0; lines = 0; level = 1; combo = -1; b2b = false;
    paused = false; gameOver = false; running = true;
    dropCounter = 0; lockCounter = 0;
    spawnPiece();
    hideOverlay();
    updateStats();
    lastTime = performance.now();
    requestAnimationFrame(loop);
  }

  function spawnPiece(type = null) {
    refillQueue();
    current = createPiece(type || queue.shift());
    refillQueue();
    canHold = true;
    lastActionWasRotate = false;
    lastRotateKick = false;
    lockCounter = 0;

    if (collides(current, 0, 0, current.matrix)) {
      gameOver = true;
      running = false;
      updateHighScore();
      showOverlay("GAME OVER", `Final score: ${score.toLocaleString()}`, "PLAY AGAIN");
      playSound("gameover");
    }
  }

  function collides(piece, dx = 0, dy = 0, matrix = piece.matrix) {
    for (let y = 0; y < matrix.length; y++) {
      for (let x = 0; x < matrix[y].length; x++) {
        if (!matrix[y][x]) continue;
        const nx = piece.x + x + dx;
        const ny = piece.y + y + dy;
        if (nx < 0 || nx >= COLS || ny >= ROWS) return true;
        if (ny >= 0 && board[ny][nx]) return true;
      }
    }
    return false;
  }

  function merge() {
    current.matrix.forEach((row, y) => row.forEach((v, x) => {
      if (v && current.y + y >= 0) board[current.y + y][current.x + x] = current.type;
    }));
  }

  function move(dx) {
    if (!running || paused || gameOver) return false;
    if (!collides(current, dx, 0)) {
      current.x += dx;
      lastActionWasRotate = false;
      playSound("move");
      return true;
    }
    return false;
  }

  function softDrop(manual = true) {
    if (!running || paused || gameOver) return false;
    if (!collides(current, 0, 1)) {
      current.y++;
      if (manual) score += 1;
      dropCounter = 0;
      lastActionWasRotate = false;
      if (manual) playSound("move");
      updateStats();
      return true;
    }
    return false;
  }

  function hardDrop() {
    if (!running || paused || gameOver) return;
    let distance = 0;
    while (!collides(current, 0, 1)) {
      current.y++;
      distance++;
    }
    score += distance * 2;
    dropCounter = 0;
    updateStats();
    playSound("drop");
    lockPiece();
  }

  function rotateMatrix(matrix, dir) {
    const n = matrix.length;
    const res = Array.from({ length: n }, () => Array(n).fill(0));
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        res[y][x] = dir > 0 ? matrix[n - 1 - x][y] : matrix[x][n - 1 - y];
      }
    }
    return res;
  }

  function rotate(dir) {
    if (!running || paused || gameOver || current.type === "O") return;
    const old = current.matrix;
    const rotated = rotateMatrix(old, dir);
    // Lightweight SRS-style wall kicks.
    const kicks = [
      [0,0], [-1,0], [1,0], [-2,0], [2,0], [0,-1], [0,-2], [0,1]
    ];
    for (const [kx, ky] of kicks) {
      if (!collides(current, kx, ky, rotated)) {
        current.x += kx;
        current.y += ky;
        current.matrix = rotated;
        current.rotation = (current.rotation + (dir > 0 ? 1 : 3)) % 4;
        lastActionWasRotate = true;
        lastRotateKick = (kx !== 0 || ky !== 0);
        playSound("rotate");
        return true;
      }
    }
    return false;
  }

  function hold() {
    if (!running || paused || gameOver || !canHold) return;
    const type = current.type;
    if (holdType === null) {
      holdType = type;
      spawnPiece();
    } else {
      const swap = holdType;
      holdType = type;
      current = createPiece(swap);
      if (collides(current)) {
        gameOver = true; running = false;
        showOverlay("GAME OVER", `Final score: ${score.toLocaleString()}`, "PLAY AGAIN");
      }
    }
    canHold = false;
    lastActionWasRotate = false;
    updatePreviews();
    playSound("hold");
  }

  function isTSpin() {
    if (current.type !== "T" || !lastActionWasRotate) return false;
    const cx = current.x + 1;
    const cy = current.y + 1;
    let corners = 0;
    [[-1,-1],[1,-1],[-1,1],[1,1]].forEach(([dx,dy]) => {
      const x = cx + dx, y = cy + dy;
      if (x < 0 || x >= COLS || y < 0 || y >= ROWS || board[y][x]) corners++;
    });
    return corners >= 3;
  }

  function clearLines() {
    const full = [];
    for (let y = 0; y < ROWS; y++) {
      if (board[y].every(Boolean)) full.push(y);
    }
    if (!full.length) {
      combo = -1;
      b2b = false;
      return { count: 0, tspin: false };
    }

    const tspin = isTSpin();
    const count = full.length;
    full.forEach(y => board.splice(y, 1));
    while (board.length < ROWS) board.unshift(Array(COLS).fill(null));

    const difficult = tspin || count === 4;
    const base = tspin
      ? ([0, 400, 700, 1200][count] || 0)
      : ([0, 100, 300, 500, 800][count] || 0);

    let multiplier = level;
    if (difficult && b2b) multiplier *= 1.5;
    score += Math.floor(base * multiplier);

    combo++;
    if (combo > 0) score += 50 * combo * level;

    b2b = difficult;
    lines += count;
    const oldLevel = level;
    level = Math.floor(lines / 10) + 1;

    if (level > oldLevel) {
      flash("LEVEL UP!", "#b18cff");
      playSound("level");
    }
    flash(tspin ? "T-SPIN!" : count === 4 ? "TETRIS!" : `${count} LINE${count > 1 ? "S" : ""}!`,
      difficult ? "#ffcf58" : "#67e8ff");
    playSound(tspin ? "tspin" : count === 4 ? "tetris" : "clear");
    return { count, tspin };
  }

  function lockPiece() {
    if (!running || paused || gameOver) return;
    merge();
    playSound("lock");
    const result = clearLines();
    updateStats();
    updateHighScore();
    spawnPiece();
  }

  function getDropInterval() {
    // Smoothly approaches faster fall speeds without becoming unusable.
    return Math.max(70, 850 * Math.pow(0.82, level - 1));
  }

  function getGhostY() {
    let y = current.y;
    while (!collides({ ...current, y }, 0, 1, current.matrix)) y++;
    return y;
  }

  function drawCell(context, x, y, type, alpha = 1, size = CELL, ghost = false) {
    if (y < 0) return;
    const px = x * size, py = y * size;
    context.save();
    context.globalAlpha = alpha;
    const c = COLORS[type];
    if (ghost) {
      context.strokeStyle = c;
      context.globalAlpha = .25;
      context.lineWidth = 2;
      context.strokeRect(px + 3, py + 3, size - 6, size - 6);
      context.restore();
      return;
    }
    const grad = context.createLinearGradient(px, py, px + size, py + size);
    grad.addColorStop(0, c);
    grad.addColorStop(1, c + "88");
    context.fillStyle = grad;
    context.fillRect(px + 2, py + 2, size - 4, size - 4);
    context.fillStyle = "rgba(255,255,255,.2)";
    context.fillRect(px + 4, py + 4, size - 8, 3);
    context.fillStyle = "rgba(0,0,0,.2)";
    context.fillRect(px + 4, py + size - 7, size - 8, 3);
    context.shadowColor = c;
    context.shadowBlur = 9;
    context.strokeStyle = "rgba(255,255,255,.13)";
    context.strokeRect(px + 2, py + 2, size - 4, size - 4);
    context.restore();
  }

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const bg = ctx.createLinearGradient(0,0,0,canvas.height);
    bg.addColorStop(0, "#0a0d17");
    bg.addColorStop(1, "#060811");
    ctx.fillStyle = bg;
    ctx.fillRect(0,0,canvas.width,canvas.height);

    // Grid.
    ctx.strokeStyle = "rgba(255,255,255,.035)";
    ctx.lineWidth = 1;
    for (let x = 0; x <= COLS; x++) {
      ctx.beginPath(); ctx.moveTo(x*CELL+.5,0); ctx.lineTo(x*CELL+.5,canvas.height); ctx.stroke();
    }
    for (let y = 0; y <= ROWS; y++) {
      ctx.beginPath(); ctx.moveTo(0,y*CELL+.5); ctx.lineTo(canvas.width,y*CELL+.5); ctx.stroke();
    }

    board.forEach((row,y) => row.forEach((type,x) => {
      if (type) drawCell(ctx,x,y,type);
    }));

    if (current) {
      const gy = getGhostY();
      current.matrix.forEach((row,y) => row.forEach((v,x) => {
        if (v) drawCell(ctx,current.x+x,gy+y,current.type,.8,CELL,true);
      }));
      current.matrix.forEach((row,y) => row.forEach((v,x) => {
        if (v) drawCell(ctx,current.x+x,current.y+y,current.type);
      }));
    }
  }

  function drawMini(context, type, width, height) {
    context.clearRect(0,0,width,height);
    if (!type) return;
    const matrix = SHAPES[type];
    const cell = Math.min(width / (matrix[0].length + 2), height / (matrix.length + 2));
    const ox = (width - matrix[0].length * cell) / 2;
    const oy = (height - matrix.length * cell) / 2;
    matrix.forEach((row,y) => row.forEach((v,x) => {
      if (!v) return;
      drawCell(context, x + ox/cell, y + oy/cell, type, 1, cell);
    }));
  }

  function updatePreviews() {
    holdPreview.innerHTML = "";
    const hc = document.createElement("canvas");
    hc.width = 190; hc.height = 92;
    holdPreview.appendChild(hc);
    drawMini(hc.getContext("2d"), holdType, hc.width, hc.height);

    nextPreview.innerHTML = "";
    queue.slice(0,5).forEach(type => {
      const slot = document.createElement("div");
      slot.className = "next-slot";
      const c = document.createElement("canvas");
      c.width = 190; c.height = 65;
      slot.appendChild(c);
      nextPreview.appendChild(slot);
      drawMini(c.getContext("2d"), type, c.width, c.height);
    });
  }

  function updateStats() {
    scoreEl.textContent = score.toLocaleString();
    highEl.textContent = highScore.toLocaleString();
    levelEl.textContent = level;
    linesEl.textContent = lines;
    comboEl.textContent = combo > 0 ? `×${combo}` : "—";
    updatePreviews();
  }

  function updateHighScore() {
    if (score > highScore) {
      highScore = score;
      localStorage.setItem("neonTetrisHighScore", String(highScore));
      highEl.textContent = highScore.toLocaleString();
    }
  }

  function flash(text, color) {
    flashText.textContent = text;
    flashText.style.color = color;
    flashText.classList.remove("show");
    void flashText.offsetWidth;
    flashText.classList.add("show");
  }

  function showOverlay(title, text, buttonText) {
    overlayTitle.textContent = title;
    overlayText.textContent = text;
    startBtn.textContent = buttonText;
    overlay.classList.add("visible");
  }

  function hideOverlay() {
    overlay.classList.remove("visible");
  }

  function togglePause() {
    if (!running || gameOver) return;
    paused = !paused;
    if (paused) {
      showOverlay("PAUSED", "Take a breath. Your stack is waiting.", "RESUME");
      pauseBtn.textContent = "▶";
    } else {
      hideOverlay();
      pauseBtn.textContent = "Ⅱ";
      lastTime = performance.now();
      requestAnimationFrame(loop);
    }
  }

  function loop(time = performance.now()) {
    if (!running) {
      draw();
      return;
    }
    if (paused) {
      draw();
      return;
    }
    const delta = Math.min(100, time - lastTime);
    lastTime = time;
    dropCounter += delta;

    if (dropCounter >= getDropInterval()) {
      if (!softDrop(false)) {
        lockCounter += dropCounter;
        if (lockCounter > 350) lockPiece();
      }
      dropCounter = 0;
    }
    draw();
    requestAnimationFrame(loop);
  }

  function initAudio() {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === "suspended") audioCtx.resume();
  }

  function playSound(kind) {
    if (muted) return;
    try {
      initAudio();
      const now = audioCtx.currentTime;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      const frequencies = {
        move: 180, rotate: 330, drop: 95, lock: 130,
        clear: 500, tetris: 740, tspin: 610, level: 880,
        gameover: 70, hold: 260
      };
      osc.type = kind === "gameover" ? "sawtooth" : "square";
      osc.frequency.setValueAtTime(frequencies[kind] || 220, now);
      if (kind === "tetris" || kind === "level") {
        osc.frequency.exponentialRampToValueAtTime((frequencies[kind] || 500) * 1.5, now + .13);
      }
      gain.gain.setValueAtTime(.0001, now);
      gain.gain.exponentialRampToValueAtTime(.055, now + .008);
      gain.gain.exponentialRampToValueAtTime(.0001, now + (kind === "gameover" ? .5 : .09));
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(now);
      osc.stop(now + (kind === "gameover" ? .52 : .1));
    } catch (_) {}
  }

  function handleKey(e) {
    const keys = ["ArrowLeft","ArrowRight","ArrowDown","ArrowUp"," ","z","Z","c","C","p","P","r","R"];
    if (keys.includes(e.key)) e.preventDefault();
    if (e.repeat && [" ","z","Z","c","C","p","P","r","R"].includes(e.key)) return;

    switch (e.key) {
      case "ArrowLeft": move(-1); break;
      case "ArrowRight": move(1); break;
      case "ArrowDown": softDrop(true); break;
      case "ArrowUp": rotate(1); break;
      case "z": case "Z": rotate(-1); break;
      case " ": hardDrop(); break;
      case "c": case "C": hold(); break;
      case "p": case "P": togglePause(); break;
      case "r": case "R": startGame(); break;
    }
  }

  function bindTouch() {
    document.querySelectorAll("[data-control]").forEach(btn => {
      const action = btn.dataset.control;
      const run = (e) => {
        e.preventDefault();
        initAudio();
        if (action === "left") move(-1);
        if (action === "right") move(1);
        if (action === "down") softDrop(true);
        if (action === "rotate") rotate(1);
        if (action === "drop") hardDrop();
        if (action === "hold") hold();
        if (action === "pause") togglePause();
      };
      btn.addEventListener("pointerdown", run);
    });
  }

  startBtn.addEventListener("click", () => {
    if (paused) togglePause();
    else startGame();
  });
  pauseBtn.addEventListener("click", togglePause);
  restartBtn.addEventListener("click", startGame);
  soundBtn.addEventListener("click", () => {
    muted = !muted;
    soundBtn.textContent = muted ? "🔇" : "🔊";
    if (!muted) playSound("level");
  });
  document.addEventListener("keydown", handleKey);
  bindTouch();

  resetGame();
})();
