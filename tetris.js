const COLS = 10;
const ROWS = 20;
const BLOCK = 30;

const COLORS = [
  null,
  '#00f0f0', // I - cyan
  '#f0f000', // O - yellow
  '#a000f0', // T - purple
  '#00f000', // S - green
  '#f00000', // Z - red
  '#0000f0', // J - blue
  '#f0a000', // L - orange
];

const PIECES = [
  null,
  [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]], // I
  [[2,2],[2,2]],                               // O
  [[0,3,0],[3,3,3],[0,0,0]],                  // T
  [[0,4,4],[4,4,0],[0,0,0]],                  // S
  [[5,5,0],[0,5,5],[0,0,0]],                  // Z
  [[6,0,0],[6,6,6],[0,0,0]],                  // J
  [[0,0,7],[7,7,7],[0,0,0]],                  // L
];

const LINE_SCORES = [0, 100, 300, 500, 800];

const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
const nextCanvas = document.getElementById('next-canvas');
const nextCtx = nextCanvas.getContext('2d');
const logoCanvas = document.getElementById('logo-canvas');
const logoCtx = logoCanvas.getContext('2d');
const gameArea = document.getElementById('game-area');

const scoreEl = document.getElementById('score');
const levelEl = document.getElementById('level');
const linesEl = document.getElementById('lines');
const overlay = document.getElementById('overlay');
const overlayText = document.getElementById('overlay-text');
const startBtn = document.getElementById('start-btn');
const settingsBtn = document.getElementById('settings-btn');
const settingsPanel = document.getElementById('settings-panel');
const musicToggle = document.getElementById('music-toggle');
const sfxToggle = document.getElementById('sfx-toggle');

// --- Settings ---
let musicOn = true;
let sfxOn = true;

// --- State ---
let board, piece, nextPiece, score, level, lines, gameOver, paused, dropInterval, lastTime;

// Soft drop
let softDropping = false;
let softDropTimer = 0;

// Visual effects
let particles = [];
let shake = { timer: 0 };
let screenFlash = { alpha: 0, color: '#ffffff' };
let lockFlash = { cells: [], timer: 0 };

// --- Audio ---
const NOTE = {
  A3: 220.00, E4: 329.63,
  A4: 440.00, B4: 493.88, C5: 523.25, D5: 587.33,
  E5: 659.25, F5: 698.46, G5: 783.99, A5: 880.00,
  B5: 987.77, E6: 1318.51,
};

// BPM 200: quarter=0.3s, eighth=0.15s, dotted-quarter=0.45s, half=0.6s
const Q = 0.3, E = 0.15, DQ = 0.45, H = 0.6;

// Korobeiniki main melody — 8 bars × 4 beats = 9.6s loop
const MELODY = [
  [NOTE.E5,Q],[NOTE.B4,E],[NOTE.C5,E],[NOTE.D5,Q],[NOTE.C5,E],[NOTE.B4,E],
  [NOTE.A4,Q],[NOTE.A4,E],[NOTE.C5,E],[NOTE.E5,Q],[NOTE.D5,E],[NOTE.C5,E],
  [NOTE.B4,DQ],[NOTE.C5,E],[NOTE.D5,Q],[NOTE.E5,Q],
  [NOTE.C5,Q],[NOTE.A4,Q],[NOTE.A4,H],
  [0,E],[NOTE.D5,E],[NOTE.F5,Q],[NOTE.A5,Q],[NOTE.G5,E],[NOTE.F5,E],
  [NOTE.E5,DQ],[NOTE.C5,E],[NOTE.E5,Q],[NOTE.D5,E],[NOTE.C5,E],
  [NOTE.B4,Q],[NOTE.B4,E],[NOTE.C5,E],[NOTE.D5,Q],[NOTE.E5,Q],
  [NOTE.C5,Q],[NOTE.A4,Q],[NOTE.A4,Q],[0,Q],
];

// Bass — 16 half-notes, also 9.6s loop (starts in sync with melody)
const BASS = [
  [NOTE.A3,H],[NOTE.E4,H],
  [NOTE.A3,H],[NOTE.E4,H],
  [NOTE.A3,H],[NOTE.E4,H],
  [NOTE.A3,H],[NOTE.A3,H],
  [NOTE.A3,H],[NOTE.A3,H],
  [NOTE.A3,H],[NOTE.A3,H],
  [NOTE.A3,H],[NOTE.E4,H],
  [NOTE.A3,H],[NOTE.A3,H],
];

const LOOP_DURATION = MELODY.reduce((s, [, d]) => s + d, 0); // 9.6s

let audioCtx = null;
let musicGain = null;
let sfxGain = null;
let themePlaying = false;
let themeTimer = null;
let loopStartTime = 0;

function ensureAudio() {
  if (audioCtx) return;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  musicGain = audioCtx.createGain();
  musicGain.gain.value = musicOn ? 1 : 0;
  musicGain.connect(audioCtx.destination);
  sfxGain = audioCtx.createGain();
  sfxGain.gain.value = sfxOn ? 1 : 0;
  sfxGain.connect(audioCtx.destination);
}

// Look-ahead scheduling: all notes for one loop are scheduled at once
// using absolute AudioContext time offsets — guaranteed sample-accurate sync.
function scheduleLoop(startTime) {
  if (!themePlaying) return;
  loopStartTime = startTime;

  let t = startTime;
  for (const [freq, dur] of MELODY) {
    if (freq > 0) {
      const osc = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      osc.type = 'square';
      osc.frequency.value = freq;
      g.gain.setValueAtTime(0.13, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur * 0.82);
      osc.connect(g);
      g.connect(musicGain);
      osc.start(t);
      osc.stop(t + dur * 0.85);
    }
    t += dur;
  }

  t = startTime;
  for (const [freq, dur] of BASS) {
    if (freq > 0) {
      const osc = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.value = freq;
      g.gain.setValueAtTime(0.055, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur * 0.65);
      osc.connect(g);
      g.connect(musicGain);
      osc.start(t);
      osc.stop(t + dur * 0.7);
    }
    t += dur;
  }

  // Schedule next loop 300ms before this one ends
  clearTimeout(themeTimer);
  themeTimer = setTimeout(() => scheduleLoop(startTime + LOOP_DURATION), (LOOP_DURATION - 0.3) * 1000);
}

function startTheme() {
  ensureAudio();
  audioCtx.resume();
  themePlaying = true;
  const start = audioCtx.currentTime + 0.05;
  scheduleLoop(start);
}

function stopTheme() {
  themePlaying = false;
  clearTimeout(themeTimer);
}

function pauseTheme() {
  if (!audioCtx) return;
  clearTimeout(themeTimer);
  audioCtx.suspend();
}

function resumeTheme() {
  if (!audioCtx) return;
  audioCtx.resume();
  // Reschedule next-loop timer based on where we are in the current loop
  const timeRemaining = (loopStartTime + LOOP_DURATION) - audioCtx.currentTime;
  clearTimeout(themeTimer);
  if (timeRemaining > 0.3) {
    themeTimer = setTimeout(() => scheduleLoop(loopStartTime + LOOP_DURATION), (timeRemaining - 0.3) * 1000);
  } else {
    scheduleLoop(audioCtx.currentTime + 0.05);
  }
}

// --- Sound effects ---
function playSFX(type) {
  if (!sfxOn || !audioCtx) return;
  const t = audioCtx.currentTime;

  function tone(freq, startT, dur, vol = 0.2, wave = 'square') {
    const osc = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    osc.type = wave;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(vol, startT);
    g.gain.exponentialRampToValueAtTime(0.001, startT + dur);
    osc.connect(g);
    g.connect(sfxGain);
    osc.start(startT);
    osc.stop(startT + dur + 0.01);
  }

  switch (type) {
    case 'lock':
      tone(130, t, 0.055, 0.15, 'sawtooth');
      break;
    case 'clear1':
      tone(880, t, 0.08, 0.18);
      tone(1100, t + 0.06, 0.14, 0.16);
      break;
    case 'clear2':
      tone(660, t, 0.07, 0.18);
      tone(880, t + 0.045, 0.07, 0.18);
      tone(1100, t + 0.09, 0.18, 0.2);
      break;
    case 'clear3':
      tone(660, t, 0.06, 0.18);
      tone(880, t + 0.04, 0.06, 0.18);
      tone(1100, t + 0.08, 0.06, 0.18);
      tone(1320, t + 0.12, 0.24, 0.22);
      break;
    case 'tetris':
      tone(NOTE.E5, t, 0.09, 0.22);
      tone(NOTE.G5, t + 0.08, 0.09, 0.22);
      tone(NOTE.B5, t + 0.16, 0.09, 0.22);
      tone(NOTE.E6, t + 0.24, 0.5, 0.28);
      break;
  }
}

// --- Logo ---
const LOGO_MAPS = {
  T: [[1,1,1,1,1],[0,0,1,0,0],[0,0,1,0,0],[0,0,1,0,0],[0,0,1,0,0],[0,0,1,0,0],[0,0,1,0,0]],
  E: [[1,1,1,1,1],[1,0,0,0,0],[1,0,0,0,0],[1,1,1,1,0],[1,0,0,0,0],[1,0,0,0,0],[1,1,1,1,1]],
  R: [[1,1,1,1,0],[1,0,0,0,1],[1,0,0,0,1],[1,1,1,1,0],[1,0,1,0,0],[1,0,0,1,0],[1,0,0,0,1]],
  I: [[1,1,1,1,1],[0,0,1,0,0],[0,0,1,0,0],[0,0,1,0,0],[0,0,1,0,0],[0,0,1,0,0],[1,1,1,1,1]],
  S: [[0,1,1,1,1],[1,0,0,0,0],[1,0,0,0,0],[0,1,1,1,0],[0,0,0,0,1],[0,0,0,0,1],[1,1,1,1,0]],
};

function drawLogo() {
  const bs = 8;
  const lw = 5 * bs;
  const lh = 7 * bs;
  const gap = 5;
  const letters = ['T','E','T','R','I','S'];
  const colors = ['#00f0f0','#f0f000','#a000f0','#00f000','#f00000','#f0a000'];
  const totalW = letters.length * lw + (letters.length - 1) * gap;
  const ox0 = (logoCanvas.width - totalW) / 2;
  const oy0 = (logoCanvas.height - lh) / 2;

  logoCtx.clearRect(0, 0, logoCanvas.width, logoCanvas.height);

  letters.forEach((letter, i) => {
    const color = colors[i];
    const map = LOGO_MAPS[letter];
    const ox = ox0 + i * (lw + gap);
    logoCtx.shadowBlur = 14;
    logoCtx.shadowColor = color;
    logoCtx.fillStyle = color;
    for (let r = 0; r < map.length; r++) {
      for (let c = 0; c < map[r].length; c++) {
        if (map[r][c]) {
          logoCtx.fillRect(ox + c * bs + 1, oy0 + r * bs + 1, bs - 2, bs - 2);
        }
      }
    }
    // Highlight strip
    logoCtx.shadowBlur = 0;
    logoCtx.fillStyle = 'rgba(255,255,255,0.3)';
    for (let r = 0; r < map.length; r++) {
      for (let c = 0; c < map[r].length; c++) {
        if (map[r][c]) {
          logoCtx.fillRect(ox + c * bs + 1, oy0 + r * bs + 1, bs - 2, 2);
        }
      }
    }
  });
}

// --- Particle system ---
function spawnParticles(clearedRowColors) {
  for (const { row, colors } of clearedRowColors) {
    for (let col = 0; col < COLS; col++) {
      const color = colors[col];
      if (!color) continue;
      for (let i = 0; i < 4; i++) {
        particles.push({
          x: (col + 0.5) * BLOCK,
          y: (row + 0.5) * BLOCK,
          vx: (Math.random() - 0.5) * 12,
          vy: (Math.random() - 1.8) * 8,
          color,
          life: 1.0,
          decay: 0.022 + Math.random() * 0.022,
          size: 3 + Math.random() * 5,
        });
      }
    }
  }
}

function updateDrawParticles() {
  particles = particles.filter(p => p.life > 0);
  for (const p of particles) {
    p.x += p.vx;
    p.y += p.vy;
    p.vy += 0.35;
    p.life -= p.decay;
    ctx.save();
    ctx.globalAlpha = Math.max(0, p.life);
    ctx.fillStyle = p.color;
    ctx.shadowBlur = 8;
    ctx.shadowColor = p.color;
    ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    ctx.restore();
  }
}

function triggerShake(intensity) {
  shake.timer = intensity;
}

// --- Score/level popups ---
function showScorePopup(points, cleared) {
  const popup = document.createElement('div');
  popup.className = 'score-popup';
  if (cleared === 4) {
    popup.style.color = '#ffff00';
    popup.textContent = `TETRIS! +${points}`;
  } else if (cleared === 3) {
    popup.style.color = '#00ffff';
    popup.textContent = `TRIPLE! +${points}`;
  } else if (cleared === 2) {
    popup.style.color = '#00ff88';
    popup.textContent = `DOUBLE! +${points}`;
  } else {
    popup.style.color = '#ffffff';
    popup.textContent = `+${points}`;
  }
  popup.style.left = '50%';
  popup.style.top = '35%';
  gameArea.appendChild(popup);
  popup.addEventListener('animationend', () => popup.remove());
}

function showLevelUpPopup(lv) {
  const popup = document.createElement('div');
  popup.className = 'score-popup level-up-popup';
  popup.style.color = '#ffd700';
  popup.textContent = `LEVEL ${lv}!`;
  popup.style.left = '50%';
  popup.style.top = '48%';
  gameArea.appendChild(popup);
  popup.addEventListener('animationend', () => popup.remove());
}

// --- Board ---
function createBoard() {
  return Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
}

function randomPiece() {
  const id = Math.floor(Math.random() * 7) + 1;
  const matrix = PIECES[id].map(row => [...row]);
  return {
    id,
    matrix,
    x: Math.floor(COLS / 2) - Math.ceil(matrix[0].length / 2),
    y: 0,
  };
}

// --- Collision ---
function isValid(mat, ox, oy) {
  for (let r = 0; r < mat.length; r++) {
    for (let c = 0; c < mat[r].length; c++) {
      if (!mat[r][c]) continue;
      const nx = ox + c;
      const ny = oy + r;
      if (nx < 0 || nx >= COLS || ny >= ROWS) return false;
      if (ny >= 0 && board[ny][nx]) return false;
    }
  }
  return true;
}

// --- Rotation (wall-kick aware) ---
function rotate(matrix) {
  const n = matrix.length;
  const m = matrix[0].length;
  const result = Array.from({ length: m }, () => new Array(n).fill(0));
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < m; c++) {
      result[c][n - 1 - r] = matrix[r][c];
    }
  }
  return result;
}

function tryRotate() {
  const rotated = rotate(piece.matrix);
  const kicks = [0, 1, -1, 2, -2];
  for (const kick of kicks) {
    if (isValid(rotated, piece.x + kick, piece.y)) {
      piece.matrix = rotated;
      piece.x += kick;
      return;
    }
  }
}

// --- Lock & clear lines ---
function lock() {
  lockFlash.cells = [];
  for (let r = 0; r < piece.matrix.length; r++) {
    for (let c = 0; c < piece.matrix[r].length; c++) {
      if (!piece.matrix[r][c]) continue;
      const ny = piece.y + r;
      if (ny < 0) { endGame(); return; }
      board[ny][piece.x + c] = piece.matrix[r][c];
      lockFlash.cells.push({ x: piece.x + c, y: ny });
    }
  }
  lockFlash.timer = 6;
  playSFX('lock');
  clearLines();
  piece = nextPiece;
  nextPiece = randomPiece();
  softDropTimer = performance.now(); // give new piece a fresh interval
  if (!isValid(piece.matrix, piece.x, piece.y)) {
    endGame();
  }
}

function clearLines() {
  let cleared = 0;
  const clearedRowColors = [];

  for (let r = ROWS - 1; r >= 0; r--) {
    if (board[r].every(cell => cell !== 0)) {
      clearedRowColors.push({ row: r, colors: board[r].map(id => COLORS[id]) });
      board.splice(r, 1);
      board.unshift(new Array(COLS).fill(0));
      cleared++;
      r++;
    }
  }

  if (cleared > 0) {
    lines += cleared;
    const pts = LINE_SCORES[cleared] * level;
    score += pts;
    const newLevel = Math.floor(lines / 10) + 1;
    const didLevelUp = newLevel > level;
    level = newLevel;
    dropInterval = Math.max(100, 1000 - (level - 1) * 90);
    scoreEl.textContent = score;
    levelEl.textContent = level;
    linesEl.textContent = lines;

    spawnParticles(clearedRowColors);
    showScorePopup(pts, cleared);

    if (cleared === 4) {
      playSFX('tetris');
      screenFlash = { alpha: 0.85, color: '#ffff00' };
      triggerShake(18);
    } else if (cleared === 3) {
      playSFX('clear3');
      screenFlash = { alpha: 0.6, color: '#00ffff' };
      triggerShake(10);
    } else if (cleared === 2) {
      playSFX('clear2');
      screenFlash = { alpha: 0.5, color: '#ffffff' };
      triggerShake(7);
    } else {
      playSFX('clear1');
      screenFlash = { alpha: 0.3, color: '#ffffff' };
    }

    if (didLevelUp) {
      screenFlash = { alpha: 0.5, color: '#ffd700' };
      showLevelUpPopup(level);
    }
  }
}

// --- Ghost piece ---
function ghostY() {
  let gy = piece.y;
  while (isValid(piece.matrix, piece.x, gy + 1)) gy++;
  return gy;
}

// --- Drawing ---
function drawBlock(context, x, y, colorId, alpha = 1, glow = false) {
  const color = COLORS[colorId];
  context.save();
  context.globalAlpha = alpha;
  if (glow) {
    context.shadowBlur = 18;
    context.shadowColor = color;
  }
  context.fillStyle = color;
  context.fillRect(x * BLOCK + 1, y * BLOCK + 1, BLOCK - 2, BLOCK - 2);
  context.shadowBlur = 0;
  context.fillStyle = 'rgba(255,255,255,0.3)';
  context.fillRect(x * BLOCK + 1, y * BLOCK + 1, BLOCK - 2, 4);
  context.fillStyle = 'rgba(0,0,0,0.25)';
  context.fillRect(x * BLOCK + 1, y * BLOCK + BLOCK - 5, BLOCK - 2, 4);
  context.restore();
}

function drawBoard() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const sx = shake.timer > 0 ? (Math.random() - 0.5) * shake.timer * 0.9 : 0;
  const sy = shake.timer > 0 ? (Math.random() - 0.5) * shake.timer * 0.9 : 0;
  if (shake.timer > 0) shake.timer--;

  ctx.save();
  ctx.translate(sx, sy);

  ctx.strokeStyle = 'rgba(255,255,255,0.04)';
  ctx.lineWidth = 1;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      ctx.strokeRect(c * BLOCK, r * BLOCK, BLOCK, BLOCK);
    }
  }

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (board[r][c]) drawBlock(ctx, c, r, board[r][c], 1, false);
    }
  }

  if (lockFlash.timer > 0) {
    const fa = (lockFlash.timer / 6) * 0.85;
    ctx.save();
    ctx.globalAlpha = fa;
    ctx.fillStyle = '#ffffff';
    ctx.shadowBlur = 24;
    ctx.shadowColor = '#ffffff';
    for (const { x, y } of lockFlash.cells) {
      ctx.fillRect(x * BLOCK + 1, y * BLOCK + 1, BLOCK - 2, BLOCK - 2);
    }
    ctx.restore();
    lockFlash.timer--;
  }

  const gy = ghostY();
  for (let r = 0; r < piece.matrix.length; r++) {
    for (let c = 0; c < piece.matrix[r].length; c++) {
      if (piece.matrix[r][c]) drawBlock(ctx, piece.x + c, gy + r, piece.matrix[r][c], 0.18, false);
    }
  }

  for (let r = 0; r < piece.matrix.length; r++) {
    for (let c = 0; c < piece.matrix[r].length; c++) {
      if (piece.matrix[r][c]) drawBlock(ctx, piece.x + c, piece.y + r, piece.matrix[r][c], 1, true);
    }
  }

  updateDrawParticles();
  ctx.restore();

  if (screenFlash.alpha > 0) {
    ctx.save();
    ctx.globalAlpha = screenFlash.alpha;
    ctx.fillStyle = screenFlash.color;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    screenFlash.alpha = Math.max(0, screenFlash.alpha - 0.055);
  }
}

function drawNext() {
  nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
  const mat = nextPiece.matrix;
  const offX = Math.floor((4 - mat[0].length) / 2);
  const offY = Math.floor((4 - mat.length) / 2);
  for (let r = 0; r < mat.length; r++) {
    for (let c = 0; c < mat[r].length; c++) {
      if (mat[r][c]) drawBlock(nextCtx, offX + c, offY + r, mat[r][c], 1, true);
    }
  }
}

// --- Game loop ---
function gameLoop(timestamp) {
  if (gameOver) return;
  if (!paused) {
    // Soft drop: 16ms interval, auto-locks when at bottom
    if (softDropping && timestamp - softDropTimer >= 16) {
      softDropTimer = timestamp;
      if (isValid(piece.matrix, piece.x, piece.y + 1)) {
        piece.y++;
        score += 1;
        scoreEl.textContent = score;
        lastTime = timestamp;
      } else {
        lock();
      }
    }

    const delta = timestamp - lastTime;
    if (delta >= dropInterval) {
      lastTime = timestamp;
      if (isValid(piece.matrix, piece.x, piece.y + 1)) {
        piece.y++;
      } else {
        lock();
      }
    }

    drawBoard();
    drawNext();
  }
  requestAnimationFrame(gameLoop);
}

// --- Controls ---
document.addEventListener('keydown', e => {
  if (gameOver) return;
  if (e.key === 'p' || e.key === 'P') {
    paused = !paused;
    if (paused) {
      pauseTheme();
      overlayText.textContent = 'PAUSED';
      startBtn.textContent = 'Resume';
      overlay.classList.remove('hidden');
    } else {
      resumeTheme();
      overlay.classList.add('hidden');
    }
    return;
  }
  if (paused) return;
  switch (e.key) {
    case 'ArrowLeft':
      if (isValid(piece.matrix, piece.x - 1, piece.y)) piece.x--;
      break;
    case 'ArrowRight':
      if (isValid(piece.matrix, piece.x + 1, piece.y)) piece.x++;
      break;
    case 'ArrowDown':
      e.preventDefault();
      if (!softDropping) {
        softDropping = true;
        softDropTimer = performance.now();
        // Immediate first step
        if (isValid(piece.matrix, piece.x, piece.y + 1)) {
          piece.y++;
          score += 1;
          scoreEl.textContent = score;
        } else {
          lock();
        }
      }
      break;
    case 'ArrowUp':
      tryRotate();
      break;
    case ' ':
      e.preventDefault();
      let dropped = 0;
      while (isValid(piece.matrix, piece.x, piece.y + 1)) { piece.y++; dropped++; }
      score += dropped * 2;
      scoreEl.textContent = score;
      lock();
      break;
  }
  drawBoard();
});

document.addEventListener('keyup', e => {
  if (e.key === 'ArrowDown') softDropping = false;
});

// --- Settings ---
settingsBtn.addEventListener('click', () => {
  settingsPanel.classList.toggle('hidden');
});

musicToggle.addEventListener('change', e => {
  musicOn = e.target.checked;
  if (musicGain) musicGain.gain.value = musicOn ? 1 : 0;
});

sfxToggle.addEventListener('change', e => {
  sfxOn = e.target.checked;
  if (sfxGain) sfxGain.gain.value = sfxOn ? 1 : 0;
});

// --- Start / restart ---
function startGame() {
  settingsPanel.classList.add('hidden');
  board = createBoard();
  piece = randomPiece();
  nextPiece = randomPiece();
  score = 0;
  level = 1;
  lines = 0;
  gameOver = false;
  paused = false;
  softDropping = false;
  softDropTimer = 0;
  particles = [];
  shake.timer = 0;
  screenFlash = { alpha: 0, color: '#ffffff' };
  lockFlash = { cells: [], timer: 0 };
  dropInterval = 1000;
  lastTime = 0;
  scoreEl.textContent = 0;
  levelEl.textContent = 1;
  linesEl.textContent = 0;
  overlay.classList.add('hidden');
  stopTheme();
  startTheme();
  requestAnimationFrame(gameLoop);
}

function endGame() {
  gameOver = true;
  stopTheme();
  overlayText.textContent = 'GAME OVER';
  startBtn.textContent = 'Play Again';
  overlay.classList.remove('hidden');
}

startBtn.addEventListener('click', startGame);

// Draw static logo on load
drawLogo();
overlayText.textContent = '';
