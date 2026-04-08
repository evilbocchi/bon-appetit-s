import React, { useState, useEffect, useRef, useCallback } from "react";
import "./App.css";

// Game Constants
const FIRST_BEAT = 10.043;
const LAST_BEAT = 368.292;
const BASE_BPM = 170;
const MS_PER_NOTE_BASE = 60 / (BASE_BPM * 4);

export default function App() {
  const [gameState, setGameState] = useState("menu"); // menu, playing, gameover, win
  const [key1, setKey1] = useState("z");
  const [key2, setKey2] = useState("x");
  const [targetBPM, setTargetBPM] = useState(170);

  const [combo, setCombo] = useState(0);
  const [countdown, setCountdown] = useState(10.0);
  const [loading, setLoading] = useState(false);

  const canvasRef = useRef(null);
  const stateRef = useRef({
    gameState: "menu",
    key1: "z",
    key2: "x",
    targetBPM: 170,
    playbackRate: 1.0,
    keys: { k1: false, k2: false, m1: false, m2: false },
    prevLane1: false,
    prevLane2: false,
    notes: [],
    noteIndex: 0,
    combo: 0,
    approachTime: 1.2,
    audioCtx: null,
    source: null,
    startTime: 0,
    animationId: null,
  });

  // Sync state to ref
  useEffect(() => {
    stateRef.current.key1 = key1;
    stateRef.current.key2 = key2;
    stateRef.current.targetBPM = targetBPM;
    stateRef.current.playbackRate = targetBPM / BASE_BPM;
  }, [key1, key2, targetBPM]);

  useEffect(() => {
    stateRef.current.gameState = gameState;
  }, [gameState]);

  // Handle Resize
  const [windowSize, setWindowSize] = useState({
    width: window.innerWidth,
    height: window.innerHeight,
  });
  useEffect(() => {
    const handleResize = () =>
      setWindowSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const failGame = useCallback(() => {
    const st = stateRef.current;
    st.gameState = "gameover";
    setGameState("gameover");
    if (st.source) {
      st.source.stop();
    }
  }, []);

  const winGame = useCallback(() => {
    const st = stateRef.current;
    st.gameState = "win";
    setGameState("win");
  }, []);

  const getCurrentAudioTime = useCallback(() => {
    const st = stateRef.current;
    if (!st.audioCtx) return 0;
    return (st.audioCtx.currentTime - st.startTime) * st.playbackRate;
  }, []);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const width = canvas.width;
    const height = canvas.height;

    ctx.clearRect(0, 0, width, height);

    const st = stateRef.current;
    let currentTime = getCurrentAudioTime();
    let approachTimeAudio = st.approachTime * st.playbackRate;

    let visibleNotes = [];
    for (let i = st.noteIndex; i < st.notes.length; i++) {
      if (st.notes[i].time - currentTime <= approachTimeAudio) {
        visibleNotes.push(st.notes[i]);
      } else {
        break;
      }
    }

    let cx = width / 2;
    let cy = height / 2;

    for (let i = visibleNotes.length - 1; i >= 0; i--) {
      let note = visibleNotes[i];
      let timeDiff = note.time - currentTime;
      let progress = 1 - timeDiff / approachTimeAudio;

      if (progress < 0) continue;

      let nx = cx + note.x;
      let ny = cy + note.y;

      let alpha = Math.min(1, progress * 2);

      let arRadius = Math.max(0, 50 + 150 * (1 - progress));
      ctx.beginPath();
      ctx.arc(nx, ny, arRadius, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255, 255, 255, ${alpha})`;
      ctx.lineWidth = 3;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(nx, ny, 50, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(0, 150, 255, ${alpha})`;
      ctx.fill();
      ctx.strokeStyle = `rgba(255, 255, 255, ${alpha})`;
      ctx.lineWidth = 4;
      ctx.stroke();
    }
  }, [getCurrentAudioTime]);

  const gameLoop = useCallback(() => {
    const st = stateRef.current;
    if (st.gameState !== "playing") return;

    let currentTime = getCurrentAudioTime();
    let timeToFirst = (FIRST_BEAT - currentTime) / st.playbackRate;

    setCountdown(timeToFirst > 0 ? timeToFirst.toFixed(1) : 0);

    // Check misses
    for (let i = st.noteIndex; i < st.notes.length; i++) {
      let note = st.notes[i];
      if (!note.hit && !note.missed) {
        let realTimeDiff = (currentTime - note.time) / st.playbackRate;
        if (realTimeDiff > 0.02) {
          note.missed = true;
          failGame();
          return;
        } else {
          break;
        }
      }
    }

    if (st.noteIndex >= st.notes.length) {
      winGame();
      return;
    }

    draw();
    st.animationId = requestAnimationFrame(gameLoop);
  }, [getCurrentAudioTime, failGame, winGame, draw]);

  const processHit = useCallback(() => {
    const st = stateRef.current;
    if (st.gameState !== "playing") return;

    let currentTime = getCurrentAudioTime();

    let targetNote = null;
    let targetIndex = -1;
    for (let i = st.noteIndex; i < st.notes.length; i++) {
      if (!st.notes[i].hit && !st.notes[i].missed) {
        targetNote = st.notes[i];
        targetIndex = i;
        break;
      }
    }

    if (targetNote) {
      let diff = currentTime - targetNote.time;
      let realTimeDiff = Math.abs(diff) / st.playbackRate;

      if (realTimeDiff <= 0.02) {
        targetNote.hit = true;
        st.noteIndex = targetIndex + 1;
        st.combo++;
        setCombo(st.combo);
      } else if (currentTime > targetNote.time - 0.15 * st.playbackRate) {
        targetNote.missed = true;
        failGame();
      }
    }
  }, [getCurrentAudioTime, failGame]);

  const checkInputs = useCallback(() => {
    const st = stateRef.current;
    let lane1 = st.keys.k1 || st.keys.m1;
    let lane2 = st.keys.k2 || st.keys.m2;

    let hit1 = lane1 && !st.prevLane1;
    let hit2 = lane2 && !st.prevLane2;

    st.prevLane1 = lane1;
    st.prevLane2 = lane2;

    if (hit1) processHit();
    if (hit2) processHit();
  }, [processHit]);

  const startGame = async () => {
    setLoading(true);
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

    try {
      // In Vite, items in public/ are available at root
      const response = await fetch("/song.mp3");
      if (!response.ok) throw new Error("Audio file not found");
      const arrayBuffer = await response.arrayBuffer();
      const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);

      setLoading(false);
      setGameState("playing");
      setCombo(0);
      setCountdown(10.0);

      const st = stateRef.current;
      st.audioCtx = audioCtx;
      st.combo = 0;
      st.noteIndex = 0;

      const totalNotes =
        Math.round((LAST_BEAT - FIRST_BEAT) / MS_PER_NOTE_BASE) + 1;
      st.notes = [];
      for (let i = 0; i < totalNotes; i++) {
        st.notes.push({
          time: FIRST_BEAT + i * MS_PER_NOTE_BASE,
          hit: false,
          missed: false,
          x: Math.sin(i * 0.1) * 200,
          y: Math.sin(i * 0.15) * 150,
        });
      }

      st.source = audioCtx.createBufferSource();
      st.source.buffer = audioBuffer;
      st.source.playbackRate.value = st.playbackRate;
      st.source.connect(audioCtx.destination);

      st.source.start(0);
      st.startTime = audioCtx.currentTime;

      st.animationId = requestAnimationFrame(gameLoop);
    } catch (e) {
      console.error(e);
      alert(
        "Failed to load song.mp3. Ensure it is placed in the 'public' directory.",
      );
      setLoading(false);
    }
  };

  useEffect(() => {
    const handleKeyDown = (e) => {
      const st = stateRef.current;
      if (st.gameState === "menu") {
        if (document.activeElement.id === "bpm-input") return;

        let k = e.key.toLowerCase();
        if (k === " ") k = "space";

        // Ignore modifier and UI keys
        if (
          ["shift", "control", "alt", "meta", "tab", "capslock", "escape"].includes(
            k,
          ) ||
          k.startsWith("f") // F1-F12
        ) {
          return;
        }

        // Cycle keys: Key 1 becomes old Key 2, Key 2 becomes new key
        if (k !== st.key1 && k !== st.key2) {
          e.preventDefault();
          const oldKey2 = st.key2;
          // Update ref immediately for fast consecutive taps
          st.key1 = oldKey2;
          st.key2 = k;
          setKey1(oldKey2);
          setKey2(k);
        }
        return;
      }

      if (st.gameState !== "playing") return;
      let k = e.key.toLowerCase();
      if (k === " ") k = "space";
      if (k === st.key1) st.keys.k1 = true;
      if (k === st.key2) st.keys.k2 = true;
      checkInputs();
    };

    const handleKeyUp = (e) => {
      const st = stateRef.current;
      if (st.gameState !== "playing") return;
      let k = e.key.toLowerCase();
      if (k === " ") k = "space";
      if (k === st.key1) st.keys.k1 = false;
      if (k === st.key2) st.keys.k2 = false;
      checkInputs();
    };

    const handleMouseDown = (e) => {
      const st = stateRef.current;
      if (st.gameState !== "playing") return;
      if (e.button === 0) st.keys.m1 = true;
      if (e.button === 2) st.keys.m2 = true;
      checkInputs();
    };

    const handleMouseUp = (e) => {
      const st = stateRef.current;
      if (st.gameState !== "playing") return;
      if (e.button === 0) st.keys.m1 = false;
      if (e.button === 2) st.keys.m2 = false;
      checkInputs();
    };

    const handleContextMenu = (e) => e.preventDefault();

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("mousedown", handleMouseDown);
    window.addEventListener("mouseup", handleMouseUp);
    window.addEventListener("contextmenu", handleContextMenu);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("mousedown", handleMouseDown);
      window.removeEventListener("mouseup", handleMouseUp);
      window.removeEventListener("contextmenu", handleContextMenu);
    };
  }, [checkInputs]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      const st = stateRef.current;
      if (st.animationId) cancelAnimationFrame(st.animationId);
      if (st.source) st.source.stop();
      if (st.audioCtx) st.audioCtx.close();
    };
  }, []);

  return (
    <>
      {gameState === "menu" && (
        <div id="menu">
          <h1>Bon Appetit S</h1>
          <h2>Stream Challenge</h2>

          <div className="setting">
            <label>Key 1 (Left Click): </label>
            <input type="text" id="key1-input" value={key1} readOnly />
          </div>
          <div className="setting">
            <label>Key 2 (Right Click): </label>
            <input type="text" id="key2-input" value={key2} readOnly />
          </div>
          <div className="setting">
            <label>BPM (160-360): </label>
            <input
              type="number"
              id="bpm-input"
              value={targetBPM}
              min="160"
              max="360"
              step="10"
              onChange={(e) => setTargetBPM(parseInt(e.target.value) || 170)}
            />
          </div>

          <p className="hint">
            Tap any two keys on your keyboard to set your keybinds.
          </p>

          <button id="start-btn" onClick={startGame} disabled={loading}>
            {loading ? "LOADING..." : "START"}
          </button>
        </div>
      )}

      {gameState === "playing" && (
        <>
          <div id="hud">
            <div>
              Combo: <span id="combo">{combo}</span>
            </div>
          </div>
          {countdown > 0 && (
            <div id="countdown">
              Starts in: <span id="cd-time">{countdown}</span>s
            </div>
          )}
        </>
      )}

      {(gameState === "gameover" || gameState === "win") && (
        <div id="gameover">
          <div
            id="go-msg"
            style={{ color: gameState === "win" ? "#00ff00" : "red" }}
          >
            {gameState === "win" ? "YOU WIN!" : "FAILED"}
          </div>
          <div className="restart-hint">Refresh the page to try again</div>
        </div>
      )}

      <canvas
        id="gameCanvas"
        ref={canvasRef}
        width={windowSize.width}
        height={windowSize.height}
      ></canvas>
    </>
  );
}
