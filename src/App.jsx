import React, { useState, useEffect, useRef, useCallback } from "react";
import "./App.css";

// Game Constants
const BASE_BPM = 170;

import { parseOsuFile } from "./osuParser";
import processorUrl from "./audio-processor.js?url";

export default function App() {
    const [gameState, setGameState] = useState("playing"); // menu, playing, gameover, win
    const [key1, setKey1] = useState("z");
    const [key2, setKey2] = useState("x");
    const [targetBPM, setTargetBPM] = useState(170);
    const [babyMode, setBabyMode] = useState(true);

    const [combo, setCombo] = useState(0);
    const [countdown, setCountdown] = useState(0);
    const [totalNotes, setTotalNotes] = useState(0);

    const canvasRef = useRef(null);
    const stateRef = useRef({
        gameState: "playing",
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
        babyMode: false,
        approachTime: 1.2,
        audioCtx: null,
        workletNode: null,
        sharedState: null, // Float32Array on SharedArrayBuffer
        startTime: 0,
        animationId: null,
        initialTime: 0,
        audioStarted: false,
        arrayBuffer: null,
        hitOffsets: [],
    });

    // Sync state to ref
    useEffect(() => {
        const st = stateRef.current;
        st.key1 = key1;
        st.key2 = key2;
        st.targetBPM = targetBPM;
        st.playbackRate = targetBPM / BASE_BPM;
        if (st.sharedState) {
            st.sharedState[1] = st.playbackRate;
        }
    }, [key1, key2, targetBPM]);

    useEffect(() => {
        stateRef.current.gameState = gameState;
    }, [gameState]);

    useEffect(() => {
        stateRef.current.babyMode = babyMode;
    }, [babyMode]);

    // Handle Resize
    const [windowSize, setWindowSize] = useState({
        width: window.innerWidth,
        height: window.innerHeight,
    });
    useEffect(() => {
        const handleResize = () =>
            setWindowSize({
                width: window.innerWidth,
                height: window.innerHeight,
            });
        window.addEventListener("resize", handleResize);
        return () => window.removeEventListener("resize", handleResize);
    }, []);

    const failGame = useCallback(() => {
        const st = stateRef.current;
        st.gameState = "gameover";
        setGameState("gameover");
        if (st.sharedState) {
            st.sharedState[2] = 0; // Stop
        }
    }, []);

    const winGame = useCallback(() => {
        const st = stateRef.current;
        st.gameState = "win";
        setGameState("win");
    }, []);

    const playHitSound = useCallback((hitSound) => {
        const st = stateRef.current;
        if (!st.audioCtx || !st.hitSounds) return;

        let soundFile = "normal-hitnormal.wav"; // fallback

        // osu hitSounds: 0=normal, 2=whistle, 4=finish, 8=clap
        // Some simple mapping depending on what samples we have:
        if (hitSound & 8) {
            soundFile = "soft-hitclap.wav";
        } else if (hitSound & 4) {
            soundFile = "soft-hitfinish.wav";
        } else if (hitSound & 2) {
            // No whistle provided, maybe fallback to drum
            soundFile = "drum-hitnormal.wav";
        }

        const buffer = st.decodedHitSounds?.[soundFile];
        if (buffer) {
            const src = st.audioCtx.createBufferSource();
            src.buffer = buffer;
            src.connect(st.audioCtx.destination);
            src.start(0);
        }
    }, []);

    const getCurrentAudioTime = useCallback(() => {
        const st = stateRef.current;
        if (!st.sharedState) {
            return 0;
        }
        // index / sampleRate = time in seconds
        return st.sharedState[0] / st.sharedState[3];
    }, []);

    const initAudio = useCallback(async () => {
        const st = stateRef.current;
        if (st.audioStarted || !st.arrayBuffer) return;
        st.audioStarted = true;

        const audioCtx = new (window.AudioContext || window.webkitAudioContext)(
            { latencyHint: "interactive" },
        );
        st.audioCtx = audioCtx;

        if (typeof SharedArrayBuffer === "undefined") {
            console.error(
                "SharedArrayBuffer is not supported. Check COOP/COEP headers.",
            );
            st.audioStarted = false;
            return;
        }

        try {
            const audioBuffer = await audioCtx.decodeAudioData(st.arrayBuffer);

            // Prepare SharedArrayBuffers for main track
            const left = audioBuffer.getChannelData(0);
            const sabLeft = new SharedArrayBuffer(left.byteLength);
            const sharedLeft = new Float32Array(sabLeft);
            sharedLeft.set(left);

            let sharedRight = null;
            if (audioBuffer.numberOfChannels > 1) {
                const right = audioBuffer.getChannelData(1);
                const sabRight = new SharedArrayBuffer(right.byteLength);
                sharedRight = new Float32Array(sabRight);
                sharedRight.set(right);
            }

            const sabState = new SharedArrayBuffer(4 * 4);
            const sharedState = new Float32Array(sabState);
            sharedState[0] = 0; // index
            sharedState[1] = st.playbackRate;
            sharedState[2] = 1; // isPlaying
            sharedState[3] = audioCtx.sampleRate;
            st.sharedState = sharedState;

            await audioCtx.audioWorklet.addModule(processorUrl);
            const workletNode = new AudioWorkletNode(
                audioCtx,
                "audio-processor",
                {
                    outputChannelCount: [audioBuffer.numberOfChannels],
                },
            );
            workletNode.port.postMessage({
                type: "init",
                left: sharedLeft,
                right: sharedRight,
                state: sharedState,
            });
            workletNode.connect(audioCtx.destination);
            st.workletNode = workletNode;

            st.decodedHitSounds = {};
            if (st.hitSounds) {
                for (const [key, ab] of Object.entries(st.hitSounds)) {
                    try {
                        const cloned = ab.slice(0);
                        st.decodedHitSounds[key] =
                            await audioCtx.decodeAudioData(cloned);
                    } catch (e) {
                        console.error("Failed to decode hitsound", key, e);
                    }
                }
            }

            st.startTime = audioCtx.currentTime;
        } catch (e) {
            console.error("Audio init failed", e);
            st.audioStarted = false;
        }
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
        // Scale approach rate with BPM
        let approachTimeAudio = st.approachTime;

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
            ctx.fillStyle = `rgba(0, 0, 0, ${alpha})`;
            ctx.fill();
            ctx.strokeStyle = `rgba(255, 255, 255, ${alpha})`;
            ctx.lineWidth = 4;
            ctx.stroke();
        }

        // Draw Error Bar
        const barWidth = Math.min(width * 0.8, 400);
        const barHeight = 8;
        const bx = width / 2 - barWidth / 2;
        const by = height - 60;

        // Bar Background
        ctx.fillStyle = "rgba(0, 0, 0, 0.4)";
        ctx.fillRect(bx, by, barWidth, barHeight);

        // Timing Windows (Visual Guides)
        const maxOffset = 0.15; // 150ms scale

        // 50ms Good window (only in baby mode)
        if (st.babyMode) {
            const goodWidth = (0.05 / maxOffset) * (barWidth / 2) * 2;
            ctx.fillStyle = "rgba(255, 255, 0, 0.15)";
            ctx.fillRect(width / 2 - goodWidth / 2, by, goodWidth, barHeight);
        }

        // 20ms Great window
        const greatWidth = (0.02 / maxOffset) * (barWidth / 2) * 2;
        ctx.fillStyle = "rgba(0, 255, 0, 0.2)";
        ctx.fillRect(width / 2 - greatWidth / 2, by, greatWidth, barHeight);

        // Center Line (Perfect)
        ctx.strokeStyle = "rgba(255, 255, 255, 0.8)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(width / 2, by - 5);
        ctx.lineTo(width / 2, by + barHeight + 5);
        ctx.stroke();

        // Markers
        const now = performance.now();
        st.hitOffsets.forEach((h) => {
            const age = (now - h.time) / 1000;
            if (age > 1.5) return;

            const alpha = 1 - age / 1.5;
            const xOffset = (h.offset / maxOffset) * (barWidth / 2);
            const mx = width / 2 + xOffset;

            if (mx >= bx && mx <= bx + barWidth) {
                if (h.hit) {
                    ctx.fillStyle = `rgba(0, 255, 255, ${alpha})`;
                } else if (h.isGood) {
                    ctx.fillStyle = `rgba(255, 255, 0, ${alpha})`;
                } else {
                    ctx.fillStyle = `rgba(255, 50, 50, ${alpha})`;
                }
                ctx.fillRect(mx - 2, by - 4, 4, barHeight + 8);
            }
        });

        // Labels
        ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
        ctx.font = "12px Arial";
        ctx.textAlign = "right";
        ctx.fillText("EARLY", bx - 10, by + barHeight);
        ctx.textAlign = "left";
        ctx.fillText("LATE", bx + barWidth + 10, by + barHeight);
    }, [getCurrentAudioTime]);

    const gameLoop = useCallback(() => {
        const st = stateRef.current;
        if (st.gameState !== "playing") return;

        let currentTime = getCurrentAudioTime();
        let timeToFirst = (st.firstBeat - currentTime) / st.playbackRate;

        setCountdown(timeToFirst > 0 ? timeToFirst.toFixed(1) : 0);

        // Check misses
        for (let i = st.noteIndex; i < st.notes.length; i++) {
            let note = st.notes[i];
            if (!note.hit && !note.missed) {
                let realTimeDiff = (currentTime - note.time) / st.playbackRate;
                let missThreshold = st.babyMode ? 0.05 : 0.02;
                if (realTimeDiff > missThreshold) {
                    note.missed = true;
                    if (!st.babyMode) {
                        failGame();
                        return;
                    } else {
                        // In baby mode, just move to next note
                        st.noteIndex = i + 1;
                    }
                } else {
                    break;
                }
            }
        }

        if (st.notes.length > 0 && st.noteIndex >= st.notes.length) {
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

            const isGreat = realTimeDiff <= 0.02;
            const isGood = st.babyMode && realTimeDiff <= 0.05;

            if (
                st.noteIndex === 0 &&
                currentTime < targetNote.time - 0.15 * st.playbackRate
            ) {
                if (st.beatDuration) {
                    let streamInterval = st.beatDuration / 4 / 1000;
                    let k = Math.round(
                        (targetNote.time - currentTime) / streamInterval,
                    );
                    let nearestTick = targetNote.time - k * streamInterval;
                    let tickDiff = currentTime - nearestTick;
                    let realTickDiff = Math.abs(tickDiff) / st.playbackRate;

                    const tickIsGreat = realTickDiff <= 0.02;
                    const tickIsGood = st.babyMode && realTickDiff <= 0.05;

                    st.hitOffsets.push({
                        offset: tickDiff,
                        time: performance.now(),
                        hit: tickIsGreat,
                        isGood: tickIsGood && !tickIsGreat,
                    });
                    if (st.hitOffsets.length > 30) st.hitOffsets.shift();
                    playHitSound(0);
                }
                return;
            }

            // Record hit offset for the error bar
            st.hitOffsets.push({
                offset: diff,
                time: performance.now(),
                hit: isGreat,
                isGood: isGood && !isGreat,
            });
            if (st.hitOffsets.length > 30) st.hitOffsets.shift();

            if (isGreat || isGood) {
                targetNote.hit = true;
                st.noteIndex = targetIndex + 1;
                st.combo++;
                setCombo(st.combo);
                playHitSound(targetNote.hitSound);
            } else if (currentTime > targetNote.time - 0.15 * st.playbackRate) {
                // Don't fail for hitting early on the first note
                if (st.noteIndex === 0 && diff < 0) {
                    playHitSound(0);
                    return;
                }

                targetNote.missed = true;
                if (!st.babyMode) {
                    failGame();
                } else {
                    st.noteIndex = targetIndex + 1;
                }
            }
        }
    }, [getCurrentAudioTime, failGame, playHitSound]);

    const checkInputs = useCallback(() => {
        const st = stateRef.current;
        if (!st.audioStarted) initAudio();

        let lane1 = st.keys.k1 || st.keys.m1;
        let lane2 = st.keys.k2 || st.keys.m2;

        let hit1 = lane1 && !st.prevLane1;
        let hit2 = lane2 && !st.prevLane2;

        st.prevLane1 = lane1;
        st.prevLane2 = lane2;

        if (hit1) processHit();
        if (hit2) processHit();
    }, [processHit, initAudio]);

    useEffect(() => {
        const st = stateRef.current;
        st.initialTime = performance.now();
        st.combo = 0;
        st.noteIndex = 0;
        st.hitOffsets = [];
        st.firstBeat = 0;

        const fetchData = async () => {
            try {
                const osuRes = await fetch(
                    "/K A Z M A S A - Bon Appetit S (Oldskool HappyHardcore Remix) (BarkingMadDog) [Blend S].osu",
                );
                const osuText = await osuRes.text();
                const { notes, beatDuration } = await parseOsuFile(osuText);
                st.notes = notes;
                st.beatDuration = beatDuration;
                if (notes.length > 0) st.firstBeat = notes[0].time;
                setTotalNotes(notes.length);

                const response = await fetch("/audio.mp3");
                if (!response.ok) throw new Error("Audio file not found");
                st.arrayBuffer = await response.arrayBuffer();

                // Prefetch hitsounds
                st.hitSounds = {};
                const hitSoundFiles = [
                    "normal-hitnormal.wav",
                    "drum-hitnormal.wav",
                    "soft-hitclap.wav",
                    "soft-hitfinish.wav",
                    "soft-sliderslide.wav",
                ];
                for (const file of hitSoundFiles) {
                    const hsRes = await fetch("/" + file);
                    st.hitSounds[file] = await hsRes.arrayBuffer();
                }
            } catch (e) {
                console.error("Failed to pre-fetch files", e);
            }
        };
        fetchData();

        st.animationId = requestAnimationFrame(gameLoop);
    }, [gameLoop]);

    useEffect(() => {
        const handleKeyDown = (e) => {
            const st = stateRef.current;

            // Prevent browser shortcuts (Ctrl+S, Ctrl+P, Ctrl+F, etc.)
            if (e.ctrlKey || e.metaKey) {
                const k = e.key.toLowerCase();
                if (["s", "p", "f", "g", "u", "r"].includes(k)) {
                    e.preventDefault();
                }
            }

            // Prevent Tab from moving focus
            if (e.key === "Tab") {
                e.preventDefault();
            }

            if (!st.audioStarted) initAudio();

            if (
                st.gameState === "playing" &&
                getCurrentAudioTime() < st.firstBeat
            ) {
                let k = e.key.toLowerCase();
                if (k === " ") k = "space";

                // Skip logic
                if (k === "space" && st.sharedState) {
                    const currentTime = getCurrentAudioTime();
                    const skipTarget = st.firstBeat - 1.5 * st.playbackRate;
                    if (currentTime < skipTarget - 0.1) {
                        st.sharedState[0] = skipTarget * st.sharedState[3];
                        e.preventDefault();
                        return;
                    }
                }

                // Ignore modifier and UI keys
                if (
                    [
                        "shift",
                        "control",
                        "alt",
                        "meta",
                        "tab",
                        "capslock",
                        "escape",
                    ].includes(k) ||
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
                    return;
                }
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
            if (!st.audioStarted) initAudio();
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
            if (st.workletNode) st.workletNode.disconnect();
            if (st.audioCtx) st.audioCtx.close();
        };
    }, []);

    return (
        <>
            {gameState === "playing" && (
                <>
                    <div id="hud">
                        <div>
                            Combo: <span id="combo">{combo}</span>
                        </div>
                        <button
                            className="baby-mode-btn"
                            onClick={() => setBabyMode(!babyMode)}
                        >
                            Baby Mode: {babyMode ? "ON" : "OFF"}
                        </button>
                    </div>
                    {countdown > 0 && (
                        <div id="countdown">
                            <div id="cd-time">Starts in: {countdown}s</div>
                            <div
                                className={`instructions ${parseFloat(countdown) <= 1.5 ? "fade-out" : ""}`}
                            >
                                {countdown > 2 && (
                                    <p className="skip-hint">
                                        Press SPACE to skip
                                    </p>
                                )}
                                <p>
                                    How to play: Tap consistently at{" "}
                                    <b>{targetBPM}</b> bpm for{" "}
                                    <b>{totalNotes}</b> notes.
                                </p>
                                <p>
                                    No aim is required, the hit objects are
                                    purely for visual effect.
                                </p>
                                <p>
                                    There is no pattern. It is just one
                                    continuous deathstream.
                                </p>
                            </div>
                            <div
                                className={`settings-overlay ${parseFloat(countdown) <= 1.5 ? "fade-out" : ""}`}
                            >
                                <div className="setting">
                                    <label>Keys: </label>
                                    <input
                                        type="text"
                                        value={`${key1.toUpperCase()}, ${key2.toUpperCase()}`}
                                        readOnly
                                    />
                                </div>
                                <div className="setting">
                                    <label>BPM: </label>
                                    <div className="bpm-buttons">
                                        {Array.from(
                                            { length: 21 },
                                            (_, i) => 160 + i * 10,
                                        ).map((bpm) => {
                                            let style = {};
                                            if (bpm >= 300) {
                                                const ratio =
                                                    (bpm - 300) / (360 - 300);
                                                const green = Math.floor(
                                                    255 * (1 - ratio),
                                                );
                                                const blue = Math.floor(
                                                    255 * ratio,
                                                );
                                                const glowColor = `rgb(255, ${green}, ${blue})`;
                                                style = {
                                                    background: "black",
                                                    color: "white",
                                                    border: `2px solid ${glowColor}`,
                                                    boxShadow: `inset 0 0 10px ${glowColor}`,
                                                };
                                            } else if (bpm >= 240) {
                                                const darkness =
                                                    (bpm - 240) / (300 - 240);
                                                style = {
                                                    background: `rgb(${Math.floor(255 * (1 - darkness))}, 0, 0)`,
                                                    color: "white",
                                                };
                                            } else {
                                                const hue =
                                                    240 -
                                                    ((bpm - 160) /
                                                        (240 - 160)) *
                                                        240;
                                                style = {
                                                    background: `hsl(${hue}, 80%, 50%)`,
                                                    color: "white",
                                                };
                                            }

                                            return (
                                                <button
                                                    key={bpm}
                                                    className={`bpm-btn ${targetBPM === bpm ? "active" : ""}`}
                                                    style={style}
                                                    onClick={() =>
                                                        setTargetBPM(bpm)
                                                    }
                                                >
                                                    {bpm}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                                <p className="hint">
                                    A stamina challenge by{" "}
                                    <a href="https://osu.ppy.sh/users/13510304">
                                        ohtsuki
                                    </a>
                                </p>
                            </div>
                        </div>
                    )}
                </>
            )}

            {(gameState === "gameover" || gameState === "win") && (
                <div id="gameover">
                    <div
                        id="go-msg"
                        style={{
                            color: gameState === "win" ? "#00ff00" : "red",
                        }}
                    >
                        {gameState === "win" ? "YOU WIN!" : "FAILED"}
                    </div>
                    <div className="restart-hint">
                        Refresh the page to try again
                    </div>
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
