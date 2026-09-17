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

// Score awarded per number of lines cleared at once
const LINE_SCORES = [0, 100, 300, 500, 800];

const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
const nextCanvas = document.getElementById('next-canvas');
const nextCtx = nextCanvas.getContext('2d');

const scoreEl = document.getElementById('score');
const levelEl = document.getElementById('level');
const linesEl = document.getElementById('lines');
const overlay = document.getElementById('overlay');
const overlayText = document.getElementById('overlay-text');
const startBtn = document.getElementById('start-btn');

// --- State ---
let board, piece, nextPiece, score, level, lines, gameOver, paused, dropInterval, lastTime;

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
  for (let r = 0; r < piece.matrix.length; r++) {
    for (let c = 0; c < piece.matrix[r].length; c++) {
      if (!piece.matrix[r][c]) continue;
      const ny = piece.y + r;
      if (ny < 0) { endGame(); return; }
      board[ny][piece.x + c] = piece.matrix[r][c];
    }
  }
  clearLines();
  piece = nextPiece;
  nextPiece = randomPiece();
  if (!isValid(piece.matrix, piece.x, piece.y)) {
    endGame();
  }
}

function clearLines() {
  let cleared = 0;
  for (let r = ROWS - 1; r >= 0; r--) {
    if (board[r].every(cell => cell !== 0)) {
      board.splice(r, 1);
      board.unshift(new Array(COLS).fill(0));
      cleared++;
      r++; // recheck same row index
    }
  }
  if (cleared > 0) {
    lines += cleared;
    score += LINE_SCORES[cleared] * level;
    level = Math.floor(lines / 10) + 1;
    dropInterval = Math.max(100, 1000 - (level - 1) * 90);
    scoreEl.textContent = score;
    levelEl.textContent = level;
    linesEl.textContent = lines;
  }
}

// --- Ghost piece ---
function ghostY() {
  let gy = piece.y;
  while (isValid(piece.matrix, piece.x, gy + 1)) gy++;
  return gy;
}

// --- Drawing ---
function drawBlock(context, x, y, colorId, alpha = 1) {
  const color = COLORS[colorId];
  context.globalAlpha = alpha;
  context.fillStyle = color;
  context.fillRect(x * BLOCK + 1, y * BLOCK + 1, BLOCK - 2, BLOCK - 2);
  // highlight
  context.fillStyle = 'rgba(255,255,255,0.25)';
  context.fillRect(x * BLOCK + 1, y * BLOCK + 1, BLOCK - 2, 4);
  context.fillStyle = 'rgba(0,0,0,0.2)';
  context.fillRect(x * BLOCK + 1, y * BLOCK + BLOCK - 5, BLOCK - 2, 4);
  context.globalAlpha = 1;
}

function drawBoard() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // grid lines
  ctx.strokeStyle = 'rgba(255,255,255,0.03)';
  ctx.lineWidth = 1;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      ctx.strokeRect(c * BLOCK, r * BLOCK, BLOCK, BLOCK);
    }
  }

  // locked blocks
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (board[r][c]) drawBlock(ctx, c, r, board[r][c]);
    }
  }

  // ghost
  const gy = ghostY();
  for (let r = 0; r < piece.matrix.length; r++) {
    for (let c = 0; c < piece.matrix[r].length; c++) {
      if (piece.matrix[r][c]) drawBlock(ctx, piece.x + c, gy + r, piece.matrix[r][c], 0.2);
    }
  }

  // active piece
  for (let r = 0; r < piece.matrix.length; r++) {
    for (let c = 0; c < piece.matrix[r].length; c++) {
      if (piece.matrix[r][c]) drawBlock(ctx, piece.x + c, piece.y + r, piece.matrix[r][c]);
    }
  }
}

function drawNext() {
  nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
  const mat = nextPiece.matrix;
  const offX = Math.floor((4 - mat[0].length) / 2);
  const offY = Math.floor((4 - mat.length) / 2);
  for (let r = 0; r < mat.length; r++) {
    for (let c = 0; c < mat[r].length; c++) {
      if (mat[r][c]) drawBlock(nextCtx, offX + c, offY + r, mat[r][c]);
    }
  }
}

// --- Game loop ---
function gameLoop(timestamp) {
  if (gameOver) return;
  if (!paused) {
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
      overlayText.textContent = 'PAUSED';
      startBtn.textContent = 'Resume';
      overlay.classList.remove('hidden');
    } else {
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
      if (isValid(piece.matrix, piece.x, piece.y + 1)) {
        piece.y++;
        score += 1;
        scoreEl.textContent = score;
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
  dropInterval = 1000;
  lastTime = 0;
  scoreEl.textContent = 0;
  levelEl.textContent = 1;
  linesEl.textContent = 0;
  overlay.classList.add('hidden');
  requestAnimationFrame(gameLoop);
}

function endGame() {
  gameOver = true;
  overlayText.textContent = 'GAME OVER';
  startBtn.textContent = 'Play Again';
  overlay.classList.remove('hidden');
}

startBtn.addEventListener('click', startGame);

// Show start screen on load
overlayText.textContent = '';
