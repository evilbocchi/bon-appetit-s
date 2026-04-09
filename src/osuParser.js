export async function parseOsuFile(text) {
    const lines = text.split("\n");
    let sliderMultiplier = 1;
    let beatDuration = 500;
    let mode = "";
    const keyframes = [];

    for (let l of lines) {
        const line = l.trim();
        if (line.startsWith("[")) {
            mode = line;
            continue;
        }
        if (!line) continue;

        if (mode === "[Difficulty]" && line.startsWith("SliderMultiplier:")) {
            sliderMultiplier = parseFloat(line.split(":")[1]);
        } else if (mode === "[TimingPoints]") {
            const parts = line.split(",");
            if (parts.length >= 2) {
                const val = parseFloat(parts[1]);
                if (val > 0) beatDuration = val;
            }
        } else if (mode === "[HitObjects]") {
            const parts = line.split(",");
            const x = parseFloat(parts[0]);
            const y = parseFloat(parts[1]);
            const time = parseFloat(parts[2]);
            const type = parseInt(parts[3]);
            const hitSound = parseInt(parts[4]);

            // Center around 0,0 and scale up
            const cx = (x - 256) * 1.5;
            const cy = (y - 192) * 1.5;

            keyframes.push({ time, x: cx, y: cy, hitSound });

            if ((type & 2) !== 0) {
                // Slider
                const length = parseFloat(parts[7]);
                const pts = parts[5].split("|");
                const lastPt = pts[pts.length - 1];
                let ex = x,
                    ey = y;
                if (lastPt.includes(":")) {
                    ex = parseFloat(lastPt.split(":")[0]);
                    ey = parseFloat(lastPt.split(":")[1]);
                }
                const ecx = (ex - 256) * 1.5;
                const ecy = (ey - 192) * 1.5;
                const duration =
                    (length / (100 * sliderMultiplier)) * beatDuration;

                keyframes.push({
                    time: time + duration,
                    x: ecx,
                    y: ecy,
                    hitSound,
                });
            }
        }
    }

    keyframes.sort((a, b) => a.time - b.time);

    const notes = [];
    if (keyframes.length === 0) return { notes, beatDuration };

    const firstTime = keyframes[0].time;
    const lastTime = keyframes[keyframes.length - 1].time;
    const streamInterval = beatDuration / 4;
    const streamIntervalMicros = Math.round(streamInterval * 1000);
    const firstTimeMicros = Math.round(firstTime * 1000);
    const noteCount = Math.floor((lastTime - firstTime) / streamInterval) + 1;

    let currentKeyframeIdx = 0;

    for (let i = 0; i < noteCount; i++) {
        const tMicros = firstTimeMicros + i * streamIntervalMicros;
        const t = tMicros / 1000;
        while (
            currentKeyframeIdx < keyframes.length - 1 &&
            keyframes[currentKeyframeIdx + 1].time < t
        ) {
            currentKeyframeIdx++;
        }

        const kf1 = keyframes[currentKeyframeIdx];
        const kf2 =
            currentKeyframeIdx + 1 < keyframes.length
                ? keyframes[currentKeyframeIdx + 1]
                : kf1;

        let x, y, hitSound;
        if (kf1 === kf2 || kf1.time === kf2.time) {
            x = kf1.x;
            y = kf1.y;
            hitSound = kf1.hitSound;
        } else {
            const progress = (t - kf1.time) / (kf2.time - kf1.time);
            x = kf1.x + (kf2.x - kf1.x) * progress;
            y = kf1.y + (kf2.y - kf1.y) * progress;
            hitSound = progress < 0.5 ? kf1.hitSound : kf2.hitSound;
        }

        notes.push({
            time: tMicros / 1000000, // convert microseconds to seconds
            hit: false,
            missed: false,
            x,
            y,
            hitSound,
        });
    }

    return { notes, beatDuration };
}
