const FIRST_STREAM_SECONDS_AT_170 = 10;
const BASE_BPM = 170;
const HIT_WINDOW_SECONDS = 0.02;
const APPROACH_WINDOW_SECONDS = 0.8;

const setupPanel = document.getElementById('setup-panel');
const gamePanel = document.getElementById('game-panel');
const startButton = document.getElementById('start');
const bpmSelect = document.getElementById('bpm');
const keyButtons = [document.getElementById('key1'), document.getElementById('key2')];
const song = document.getElementById('song');
const statusEl = document.getElementById('status');
const nextTimingEl = document.getElementById('next-timing');
const hitCircle = document.getElementById('hit-circle');
const approachCircle = document.getElementById('approach-circle');

let keybinds = ['KeyZ', 'KeyX'];
let armingIndex = -1;

let state = {
  running: false,
  failed: false,
  won: false,
  bpm: BASE_BPM,
  quarterInterval: 60 / BASE_BPM / 4,
  startOffset: 0,
  endOffset: 0,
  nextNoteTime: 0,
  currentNoteTime: 0,
  hitRegistered: false,
  activeTick: 0,
  loopId: 0,
  sameTickInput: {
    tick: -1,
    keyboardKey: null,
    mouseButton: null,
  },
};

for (let bpm = 160; bpm <= 360; bpm += 10) {
  const option = document.createElement('option');
  option.value = String(bpm);
  option.textContent = String(bpm);
  if (bpm === BASE_BPM) option.selected = true;
  bpmSelect.appendChild(option);
}

function formatKey(code) {
  if (code.startsWith('Key')) return code.slice(3).toUpperCase();
  if (code.startsWith('Digit')) return code.slice(5);
  return code;
}

function updateKeyButtons() {
  keyButtons.forEach((button, index) => {
    button.textContent = formatKey(keybinds[index]);
    button.classList.toggle('arming', armingIndex === index);
  });
}

keyButtons.forEach((button, index) => {
  button.addEventListener('click', () => {
    armingIndex = index;
    updateKeyButtons();
  });
});

window.addEventListener('keydown', (event) => {
  if (armingIndex >= 0) {
    keybinds[armingIndex] = event.code;
    armingIndex = -1;
    updateKeyButtons();
    return;
  }

  if (!state.running || state.failed || state.won) return;
  if (event.repeat) return;

  const isMapped = event.code === keybinds[0] || event.code === keybinds[1];
  if (!isMapped) return;

  processInput({
    kind: 'keyboard',
    keyIndex: event.code === keybinds[0] ? 0 : 1,
  });
});

window.addEventListener('mousedown', (event) => {
  if (!state.running || state.failed || state.won) return;
  if (event.button !== 0 && event.button !== 2) return;
  processInput({
    kind: 'mouse',
    button: event.button,
  });
});

window.addEventListener('contextmenu', (event) => {
  if (state.running) event.preventDefault();
});

startButton.addEventListener('click', async () => {
  if (!Number.isFinite(song.duration)) {
    statusEl.textContent = 'Audio not ready yet.';
    return;
  }

  const bpm = Number(bpmSelect.value);
  state.bpm = bpm;
  state.quarterInterval = 60 / bpm / 4;

  const firstStreamQuarterNotes = (FIRST_STREAM_SECONDS_AT_170 * BASE_BPM * 4) / 60;
  state.startOffset = firstStreamQuarterNotes * state.quarterInterval;

  const totalQuarterNotes = Math.floor(song.duration / state.quarterInterval);
  state.endOffset = totalQuarterNotes * state.quarterInterval;

  if (state.endOffset <= state.startOffset + state.quarterInterval) {
    statusEl.textContent = 'Audio track too short for challenge.';
    return;
  }

  state.running = true;
  state.failed = false;
  state.won = false;
  state.hitRegistered = false;
  state.activeTick = -1;
  state.sameTickInput.tick = -1;
  state.sameTickInput.keyboardKey = null;
  state.sameTickInput.mouseButton = null;

  setupPanel.classList.add('hidden');
  gamePanel.classList.remove('hidden');

  song.currentTime = 0;
  await song.play();

  state.nextNoteTime = state.startOffset;
  statusEl.textContent = 'Play! ±20ms only';

  if (state.loopId) cancelAnimationFrame(state.loopId);
  state.loopId = requestAnimationFrame(updateLoop);
});

function processInput(input) {
  const now = song.currentTime;
  const tickStamp = Math.floor(now * 1000);

  if (state.sameTickInput.tick !== tickStamp) {
    state.sameTickInput.tick = tickStamp;
    state.sameTickInput.keyboardKey = null;
    state.sameTickInput.mouseButton = null;
  }

  if (input.kind === 'keyboard') {
    if (state.sameTickInput.keyboardKey === input.keyIndex) return;
    if (
      (input.keyIndex === 0 && state.sameTickInput.mouseButton === 0) ||
      (input.keyIndex === 1 && state.sameTickInput.mouseButton === 2)
    ) {
      return;
    }
    state.sameTickInput.keyboardKey = input.keyIndex;
  } else {
    if (state.sameTickInput.mouseButton === input.button) return;
    if (
      (input.button === 0 && state.sameTickInput.keyboardKey === 0) ||
      (input.button === 2 && state.sameTickInput.keyboardKey === 1)
    ) {
      return;
    }
    state.sameTickInput.mouseButton = input.button;
  }

  if (state.hitRegistered) return;

  const delta = now - state.currentNoteTime;
  if (Math.abs(delta) <= HIT_WINDOW_SECONDS) {
    state.hitRegistered = true;
    statusEl.textContent = 'Perfect stream...';
    hitCircle.style.boxShadow = 'inset 0 0 0 4px #3fb950';
  }
}

function failRun(reason) {
  state.failed = true;
  state.running = false;
  statusEl.textContent = `FAILED: ${reason}`;
  song.pause();
  hitCircle.classList.add('hidden');
  approachCircle.classList.add('hidden');
}

function winRun() {
  state.won = true;
  state.running = false;
  statusEl.textContent = 'CLEARED!';
  song.pause();
  hitCircle.classList.add('hidden');
  approachCircle.classList.add('hidden');
}

function showCircles() {
  hitCircle.classList.remove('hidden');
  approachCircle.classList.remove('hidden');
  approachCircle.style.animation = 'none';
  void approachCircle.offsetWidth;
  approachCircle.style.animation = `approachShrink ${APPROACH_WINDOW_SECONDS}s linear forwards`;
  hitCircle.style.boxShadow = 'inset 0 0 0 4px #58a6ff';
}

function updateLoop() {
  if (!state.running) return;

  const now = song.currentTime;

  if (now >= state.endOffset) {
    winRun();
    return;
  }

  while (now >= state.nextNoteTime - APPROACH_WINDOW_SECONDS) {
    const tick = Math.round(state.nextNoteTime / state.quarterInterval);

    if (tick !== state.activeTick) {
      if (state.activeTick >= 0 && !state.hitRegistered) {
        failRun('Missed a note');
        return;
      }

      state.activeTick = tick;
      state.currentNoteTime = state.nextNoteTime;
      state.hitRegistered = false;
      showCircles();
      state.nextNoteTime += state.quarterInterval;
    } else {
      break;
    }
  }

  if (now > state.currentNoteTime + HIT_WINDOW_SECONDS && !state.hitRegistered && state.activeTick >= 0) {
    failRun('Outside ±20ms window');
    return;
  }

  const msToNext = Math.max(0, (state.currentNoteTime - now) * 1000);
  nextTimingEl.textContent = `Target in ${msToNext.toFixed(0)}ms`;

  state.loopId = requestAnimationFrame(updateLoop);
}

song.addEventListener('loadedmetadata', () => {
  statusEl.textContent = `Audio loaded: ${song.duration.toFixed(2)}s`;
});

song.addEventListener('error', () => {
  statusEl.textContent = 'Could not load local audio file.';
});

updateKeyButtons();
