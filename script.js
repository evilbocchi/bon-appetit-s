const BASE_BPM = 170;
const BASE_STREAM_START_MS = 10043;
const BASE_LAST_BEAT_MS = 368292;
const HIT_WINDOW_MS = 20;
const PREEMPT_MS = 800;

const song = document.getElementById('song');
const bpmSelect = document.getElementById('bpm');
const setK1Btn = document.getElementById('setK1');
const setK2Btn = document.getElementById('setK2');
const bindingHint = document.getElementById('bindingHint');
const startBtn = document.getElementById('startBtn');
const setupPanel = document.getElementById('setupPanel');
const playfield = document.getElementById('playfield');
const hud = document.getElementById('hud');
const statusEl = document.getElementById('status');
const metaEl = document.getElementById('meta');
const approachLayer = document.getElementById('approachLayer');

for (let bpm = 160; bpm <= 360; bpm += 10) {
  const option = document.createElement('option');
  option.value = String(bpm);
  option.textContent = `${bpm} BPM`;
  if (bpm === BASE_BPM) option.selected = true;
  bpmSelect.append(option);
}

const keybinds = {
  k1: 'KeyZ',
  k2: 'KeyX',
};
let waitingForBinding = null;
let game = null;

function readableKey(code) {
  if (code.startsWith('Key')) return code.replace('Key', '').toUpperCase();
  if (code.startsWith('Digit')) return code.replace('Digit', '');
  return code;
}

function updateKeyButtons() {
  setK1Btn.textContent = `K1: ${readableKey(keybinds.k1)}`;
  setK2Btn.textContent = `K2: ${readableKey(keybinds.k2)}`;
}

function beginBinding(slot) {
  waitingForBinding = slot;
  bindingHint.textContent = `Press a key for ${slot.toUpperCase()}...`;
}

setK1Btn.addEventListener('click', () => beginBinding('k1'));
setK2Btn.addEventListener('click', () => beginBinding('k2'));

window.addEventListener('keydown', (event) => {
  if (waitingForBinding) {
    event.preventDefault();
    const otherSlot = waitingForBinding === 'k1' ? 'k2' : 'k1';
    if (event.code === keybinds[otherSlot]) {
      bindingHint.textContent = 'K1 and K2 must be different keys.';
      return;
    }
    keybinds[waitingForBinding] = event.code;
    waitingForBinding = null;
    bindingHint.textContent = 'Keybind updated.';
    updateKeyButtons();
    return;
  }

  if (!game || !game.running || event.repeat) return;
  if (event.code === keybinds.k1) handleInputPress('k1');
  if (event.code === keybinds.k2) handleInputPress('k2');
});

window.addEventListener('keyup', (event) => {
  if (!game || !game.running) return;
  if (event.code === keybinds.k1) game.activeInputs.delete('k1');
  if (event.code === keybinds.k2) game.activeInputs.delete('k2');
});

playfield.addEventListener('contextmenu', (event) => event.preventDefault());
playfield.addEventListener('mousedown', (event) => {
  if (!game || !game.running) return;
  if (event.button === 0) handleInputPress('m1');
  if (event.button === 2) handleInputPress('m2');
});

window.addEventListener('mouseup', (event) => {
  if (!game || !game.running) return;
  if (event.button === 0) game.activeInputs.delete('m1');
  if (event.button === 2) game.activeInputs.delete('m2');
});

window.addEventListener('blur', () => {
  if (game) game.activeInputs.clear();
});

async function startGame() {
  const bpm = Number(bpmSelect.value);
  const rate = bpm / BASE_BPM;
  const intervalMs = 60000 / (bpm * 4);
  const streamStartMs = BASE_STREAM_START_MS / rate;
  const lastBeatMs = BASE_LAST_BEAT_MS / rate;
  const totalNotes = Math.floor((lastBeatMs - streamStartMs) / intervalMs) + 1;

  setupPanel.hidden = true;
  hud.hidden = false;
  playfield.hidden = false;
  statusEl.className = '';
  statusEl.textContent = 'Playing';

  song.currentTime = 0;
  song.playbackRate = rate;
  try {
    await song.play();
  } catch (error) {
    statusEl.className = 'fail';
    statusEl.textContent = 'Could not start audio playback.';
    setupPanel.hidden = false;
    hud.hidden = true;
    playfield.hidden = true;
    return;
  }

  game = {
    running: true,
    bpm,
    rate,
    intervalMs,
    streamStartMs,
    lastBeatMs,
    totalNotes,
    nextNote: 0,
    activeInputs: new Set(),
    raf: 0,
  };

  game.raf = requestAnimationFrame(tick);
}

function lose(reason) {
  if (!game || !game.running) return;
  game.running = false;
  cancelAnimationFrame(game.raf);
  song.pause();
  approachLayer.innerHTML = '';
  statusEl.className = 'fail';
  statusEl.textContent = `Failed: ${reason}`;
}

function win() {
  if (!game || !game.running) return;
  game.running = false;
  cancelAnimationFrame(game.raf);
  song.pause();
  approachLayer.innerHTML = '';
  statusEl.className = 'success';
  statusEl.textContent = 'Clear! You streamed to the final beat.';
}

function handleInputPress(source) {
  const conflicts = {
    k1: 'm1',
    m1: 'k1',
    k2: 'm2',
    m2: 'k2',
  };

  if (game.activeInputs.has(conflicts[source])) {
    return;
  }

  game.activeInputs.add(source);

  const nowSongMs = getSongMs();
  const noteTimeMs = game.streamStartMs + game.nextNote * game.intervalMs;
  const delta = nowSongMs - noteTimeMs;

  if (Math.abs(delta) <= HIT_WINDOW_MS) {
    game.nextNote += 1;
    if (game.nextNote >= game.totalNotes) {
      win();
    }
  }
}

function renderNotes(songMs) {
  approachLayer.innerHTML = '';
  const first = Math.max(0, Math.floor((songMs - game.streamStartMs - HIT_WINDOW_MS) / game.intervalMs));
  const visibleCount = Math.ceil(PREEMPT_MS / game.intervalMs) + 3;

  for (let i = first; i < first + visibleCount && i < game.totalNotes; i += 1) {
    if (i < game.nextNote) continue;

    const noteTime = game.streamStartMs + i * game.intervalMs;
    const untilHit = noteTime - songMs;
    if (untilHit < -HIT_WINDOW_MS || untilHit > PREEMPT_MS) continue;

    const progress = Math.min(1, Math.max(0, 1 - (untilHit + HIT_WINDOW_MS) / (PREEMPT_MS + HIT_WINDOW_MS)));
    const scale = 3 - 2 * progress;

    const approach = document.createElement('div');
    approach.className = 'approach';
    approach.style.width = `${80 * scale}px`;
    approach.style.height = `${80 * scale}px`;
    approachLayer.append(approach);

    const ring = document.createElement('div');
    ring.className = 'hit-ring';
    approachLayer.append(ring);
  }
}

function tick() {
  if (!game || !game.running) return;

  const songMs = getSongMs();
  const currentTargetMs = game.streamStartMs + game.nextNote * game.intervalMs;

  metaEl.textContent = `BPM ${game.bpm} • Note ${Math.min(game.nextNote + 1, game.totalNotes)} / ${game.totalNotes}`;

  if (songMs >= currentTargetMs + HIT_WINDOW_MS) {
    lose('missed a note');
    return;
  }

  renderNotes(songMs);
  game.raf = requestAnimationFrame(tick);
}

startBtn.addEventListener('click', startGame);
updateKeyButtons();

function getSongMs() {
  if (!game) return 0;
  return (song.currentTime * 1000) / game.rate;
}
