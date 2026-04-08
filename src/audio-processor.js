class AudioProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.leftChannel = null;
        this.rightChannel = null;
        this.state = null; // Float32Array on SharedArrayBuffer
        // state[0]: current sample index (float)
        // state[1]: playback rate
        // state[2]: is playing (0 or 1)
        // state[3]: sample rate

        this.port.onmessage = (e) => {
            if (e.data.type === "init") {
                this.leftChannel = e.data.left;
                this.rightChannel = e.data.right;
                this.state = e.data.state;
            }
        };
    }

    process(inputs, outputs) {
        if (!this.leftChannel || !this.state || this.state[2] === 0) {
            return true;
        }

        const output = outputs[0];
        const leftOut = output[0];
        const rightOut = output[1];
        const numFrames = leftOut.length;

        let currentIndex = this.state[0];
        const playbackRate = this.state[1];
        const totalSamples = this.leftChannel.length;

        for (let i = 0; i < numFrames; i++) {
            const index = Math.floor(currentIndex);
            const nextIndex = index + 1;

            if (index < totalSamples) {
                // Linear interpolation for better quality when pitch shifting
                const fraction = currentIndex - index;
                const left1 = this.leftChannel[index];
                const left2 =
                    nextIndex < totalSamples ? this.leftChannel[nextIndex] : 0;
                leftOut[i] = left1 + (left2 - left1) * fraction;

                if (this.rightChannel) {
                    const right1 = this.rightChannel[index];
                    const right2 =
                        nextIndex < totalSamples
                            ? this.rightChannel[nextIndex]
                            : 0;
                    rightOut[i] = right1 + (right2 - right1) * fraction;
                } else {
                    rightOut[i] = leftOut[i];
                }

                currentIndex += playbackRate;
            } else {
                leftOut[i] = 0;
                rightOut[i] = 0;
                this.state[2] = 0; // Stop playing
            }
        }

        this.state[0] = currentIndex;
        return true;
    }
}

registerProcessor("audio-processor", AudioProcessor);
