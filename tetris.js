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
const gameArea = document.getElementById('game-area');

const scoreEl = document.getElementById('score');
const levelEl = document.getElementById('level');
const linesEl = document.getElementById('lines');
const overlay = document.getElementById('overlay');
const overlayText = document.getElementById('overlay-text');
const startBtn = document.getElementById('start-btn');

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

// --- Audio: Korobeiniki (Tetris A-theme) via Web Audio API ---
const NOTE = {
  A3: 220.00, E4: 329.63,
  A4: 440.00, B4: 493.88, C5: 523.25, D5: 587.33,
  E5: 659.25, F5: 698.46, G5: 783.99, A5: 880.00,
};

// BPM 160: quarter = 0.375s, eighth = 0.1875s, dotted-quarter = 0.5625s, half = 0.75s
const Q = 0.375, E = 0.1875, DQ = 0.5625, H = 0.75;

// Main melody — 8 bars of 4 beats, loops every 12 seconds
const MELODY = [
  // Bar 1
  [NOTE.E5,Q],[NOTE.B4,E],[NOTE.C5,E],[NOTE.D5,Q],[NOTE.C5,E],[NOTE.B4,E],
  // Bar 2
  [NOTE.A4,Q],[NOTE.A4,E],[NOTE.C5,E],[NOTE.E5,Q],[NOTE.D5,E],[NOTE.C5,E],
  // Bar 3
  [NOTE.B4,DQ],[NOTE.C5,E],[NOTE.D5,Q],[NOTE.E5,Q],
  // Bar 4
  [NOTE.C5,Q],[NOTE.A4,Q],[NOTE.A4,H],
  // Bar 5
  [0,E],[NOTE.D5,E],[NOTE.F5,Q],[NOTE.A5,Q],[NOTE.G5,E],[NOTE.F5,E],
  // Bar 6
  [NOTE.E5,DQ],[NOTE.C5,E],[NOTE.E5,Q],[NOTE.D5,E],[NOTE.C5,E],
  // Bar 7
  [NOTE.B4,Q],[NOTE.B4,E],[NOTE.C5,E],[NOTE.D5,Q],[NOTE.E5,Q],
  // Bar 8
  [NOTE.C5,Q],[NOTE.A4,Q],[NOTE.A4,Q],[0,Q],
];

// Bass — 16 half-notes (2 per bar × 8 bars), also loops every 12 seconds
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

let audioCtx = null;
let themePlaying = false;
let noteIdx = 0;
let bassIdx = 0;
let themeTimer = null;
let bassTimer = null;

function scheduleNote() {
  if (!themePlaying) return;
  const [freq, dur] = MELODY[noteIdx % MELODY.length];
  noteIdx++;
  if (freq > 0) {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'square';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.12, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur * 0.85);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(audioCtx.currentTime);
    osc.stop(audioCtx.currentTime + dur * 0.88);
  }
  themeTimer = setTimeout(scheduleNote, dur * 1000);
}

function scheduleBass() {
  if (!themePlaying) return;
  const [freq, dur] = BASS[bassIdx % BASS.length];
  bassIdx++;
  if (freq > 0) {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.07, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur * 0.7);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(audioCtx.currentTime);
    osc.stop(audioCtx.currentTime + dur * 0.75);
  }
  bassTimer = setTimeout(scheduleBass, dur * 1000);
}

function startTheme() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  themePlaying = true;
  noteIdx = 0;
  bassIdx = 0;
  scheduleNote();
  scheduleBass();
}

function stopTheme() {
  themePlaying = false;
  clearTimeout(themeTimer);
  clearTimeout(bassTimer);
}

function pauseTheme() {
  if (audioCtx) audioCtx.suspend();
}

function resumeTheme() {
  if (audioCtx) audioCtx.resume();
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

// --- Screen shake ---
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
  lockFlash.timer = 8;
  clearLines();
  piece = nextPiece;
  nextPiece = randomPiece();
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
      screenFlash = { alpha: 0.85, color: '#ffff00' };
      triggerShake(18);
    } else if (cleared >= 2) {
      screenFlash = { alpha: 0.55, color: '#ffffff' };
      triggerShake(9);
    } else {
      screenFlash = { alpha: 0.35, color: '#ffffff' };
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

  // Screen shake
  const sx = shake.timer > 0 ? (Math.random() - 0.5) * shake.timer * 0.9 : 0;
  const sy = shake.timer > 0 ? (Math.random() - 0.5) * shake.timer * 0.9 : 0;
  if (shake.timer > 0) shake.timer--;

  ctx.save();
  ctx.translate(sx, sy);

  // Grid
  ctx.strokeStyle = 'rgba(255,255,255,0.04)';
  ctx.lineWidth = 1;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      ctx.strokeRect(c * BLOCK, r * BLOCK, BLOCK, BLOCK);
    }
  }

  // Locked blocks
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (board[r][c]) drawBlock(ctx, c, r, board[r][c], 1, false);
    }
  }

  // Lock flash
  if (lockFlash.timer > 0) {
    const fa = (lockFlash.timer / 8) * 0.9;
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

  // Ghost
  const gy = ghostY();
  for (let r = 0; r < piece.matrix.length; r++) {
    for (let c = 0; c < piece.matrix[r].length; c++) {
      if (piece.matrix[r][c]) drawBlock(ctx, piece.x + c, gy + r, piece.matrix[r][c], 0.18, false);
    }
  }

  // Active piece (with neon glow)
  for (let r = 0; r < piece.matrix.length; r++) {
    for (let c = 0; c < piece.matrix[r].length; c++) {
      if (piece.matrix[r][c]) drawBlock(ctx, piece.x + c, piece.y + r, piece.matrix[r][c], 1, true);
    }
  }

  // Particles
  updateDrawParticles();

  ctx.restore();

  // Screen flash overlay (outside shake so it covers full canvas)
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
    // Soft drop: move piece down every 50ms while key is held
    if (softDropping && timestamp - softDropTimer >= 50) {
      softDropTimer = timestamp;
      if (isValid(piece.matrix, piece.x, piece.y + 1)) {
        piece.y++;
        score += 1;
        scoreEl.textContent = score;
        lastTime = timestamp; // reset gravity to avoid double-drop
      }
    }

    // Gravity
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
      softDropping = true;
      e.preventDefault();
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

// --- Start / restart ---
function startGame() {
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

overlayText.textContent = '';
