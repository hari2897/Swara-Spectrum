/**
 * audio.js — Web Audio API setup, microphone input, analyser node
 */

export class AudioEngine {
    constructor() {
        this.audioContext = null;
        this.analyserNode = null;
        this.sourceNode = null;
        this.stream = null;
        this.isRunning = false;

        // Config
        this.sampleRate = 44100;
        this.fftSize = 8192;

        // Buffers (allocated on init)
        this.timeDomainData = null;   // Float32Array for pitch detection
        this.frequencyData = null;    // Float32Array for spectrogram (dB)
        this.frequencyDataRaw = null; // Uint8Array for fast spectrogram color

        // Features
        this.drone = null;
        this.recorder = null;
    }

    async start() {
        if (this.isRunning) return;

        try {
            // Request microphone
            this.stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: false,
                    noiseSuppression: false,
                    autoGainControl: false,
                    sampleRate: this.sampleRate
                }
            });

            // Create audio context
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
                sampleRate: this.sampleRate
            });

            // Create analyser
            this.analyserNode = this.audioContext.createAnalyser();
            this.analyserNode.fftSize = this.fftSize;
            this.analyserNode.smoothingTimeConstant = 0.3;
            this.analyserNode.minDecibels = -100;
            this.analyserNode.maxDecibels = -10;

            // Connect mic → analyser
            this.sourceNode = this.audioContext.createMediaStreamSource(this.stream);
            this.sourceNode.connect(this.analyserNode);

            // Allocate buffers
            this.timeDomainData = new Float32Array(this.fftSize);
            this.frequencyData = new Float32Array(this.analyserNode.frequencyBinCount);
            this.frequencyDataRaw = new Uint8Array(this.analyserNode.frequencyBinCount);

            // Initialize extensions
            this.drone = new DroneSynth(this.audioContext);
            this.recorder = new AudioRecorder(this.stream);

            this.isRunning = true;
            return true;
        } catch (err) {
            console.error('Failed to start audio:', err);
            return false;
        }
    }

    stop() {
        if (!this.isRunning) return;

        if (this.drone) {
            this.drone.stop();
            this.drone = null;
        }
        if (this.recorder) {
            this.recorder.stop();
            this.recorder = null;
        }

        if (this.sourceNode) {
            this.sourceNode.disconnect();
            this.sourceNode = null;
        }
        if (this.stream) {
            this.stream.getTracks().forEach(t => t.stop());
            this.stream = null;
        }
        if (this.audioContext) {
            this.audioContext.close();
            this.audioContext = null;
        }

        this.isRunning = false;
    }

    /** Get time-domain samples for pitch detection */
    getTimeDomainData() {
        if (!this.isRunning) return null;
        this.analyserNode.getFloatTimeDomainData(this.timeDomainData);
        return this.timeDomainData;
    }

    /** Get frequency data in dB (Float32) for harmonic analysis */
    getFrequencyData() {
        if (!this.isRunning) return null;
        this.analyserNode.getFloatFrequencyData(this.frequencyData);
        return this.frequencyData;
    }

    /** Get frequency data as bytes (0–255) for fast spectrogram rendering */
    getFrequencyDataBytes() {
        if (!this.isRunning) return null;
        this.analyserNode.getByteFrequencyData(this.frequencyDataRaw);
        return this.frequencyDataRaw;
    }

    /** Frequency resolution: Hz per FFT bin */
    get binResolution() {
        return this.sampleRate / this.fftSize;
    }

    /** Number of frequency bins */
    get binCount() {
        return this.fftSize / 2;
    }

    /** Convert frequency in Hz to FFT bin index */
    freqToBin(freq) {
        return Math.round(freq / this.binResolution);
    }

    /** Convert FFT bin index to frequency in Hz */
    binToFreq(bin) {
        return bin * this.binResolution;
    }
}

/**
 * Synthesizes a Tanpura-like drone using Web Audio oscillators.
 * Uses a fundamental (Sa) and a 5th (Pa), with a subtle detuned chorus.
 */
class DroneSynth {
    constructor(ctx) {
        this.ctx = ctx;
        this.masterGain = ctx.createGain();
        this.masterGain.gain.value = 0;
        this.masterGain.connect(ctx.destination);

        this.oscillators = [];
        this.gains = [];
        this.isPlaying = false;
        this.baseFreq = 130.81; // default Sa
        this.volume = 0.5;

        // Warm low-pass filter to make it sound acoustic
        this.filter = ctx.createBiquadFilter();
        this.filter.type = 'lowpass';
        this.filter.frequency.value = 1200;
        this.filter.Q.value = 0.5;
        this.filter.connect(this.masterGain);
    }

    _createOsc(freq, type, gainVal, panVal) {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        const pan = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;

        osc.type = type;
        osc.frequency.value = freq;
        gain.gain.value = gainVal;

        if (pan) {
            pan.pan.value = panVal;
            osc.connect(gain).connect(pan).connect(this.filter);
        } else {
            osc.connect(gain).connect(this.filter);
        }

        osc.start();
        this.oscillators.push(osc);
        this.gains.push(gain);
    }

    start() {
        if (this.isPlaying) return;
        this.isPlaying = true;

        const sa = this.baseFreq;
        const pa = sa * 1.5; // Perfect 5th

        // Sa (Fundamental) - Sawtooth for rich harmonics
        this._createOsc(sa, 'sawtooth', 0.15, -0.3);
        // Sa (Detuned chorus for beating)
        this._createOsc(sa + 0.5, 'sawtooth', 0.1, 0.3);
        
        // Pa (5th)
        this._createOsc(pa, 'sawtooth', 0.08, -0.2);
        // Pa (Detuned)
        this._createOsc(pa - 0.3, 'sawtooth', 0.06, 0.4);

        // Sub octave Sa for depth
        this._createOsc(sa / 2, 'triangle', 0.3, 0);

        this.masterGain.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.5);
    }

    stop() {
        if (!this.isPlaying) return;
        this.isPlaying = false;

        this.masterGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1);
        
        setTimeout(() => {
            this.oscillators.forEach(osc => osc.stop());
            this.oscillators.forEach(osc => osc.disconnect());
            this.gains.forEach(g => g.disconnect());
            this.oscillators = [];
            this.gains = [];
        }, 300);
    }

    setTonic(saFreq) {
        this.baseFreq = saFreq;
        if (!this.isPlaying) return;
        
        const sa = this.baseFreq;
        const pa = sa * 1.5;
        const freqs = [sa, sa + 0.5, pa, pa - 0.3, sa / 2];
        const time = this.ctx.currentTime + 0.1;

        this.oscillators.forEach((osc, i) => {
            osc.frequency.linearRampToValueAtTime(freqs[i], time);
        });
    }

    setVolume(pct) {
        this.volume = (pct / 100) * 0.8; // Cap master at 80% to avoid clipping
        if (this.isPlaying) {
            this.masterGain.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.1);
        }
    }
}

/**
 * Handles recording the MediaStream to an audio file (WebM).
 */
class AudioRecorder {
    constructor(stream) {
        this.stream = stream;
        this.mediaRecorder = null;
        this.chunks = [];
        this.isRecording = false;

        if (window.MediaRecorder) {
            this.mediaRecorder = new MediaRecorder(stream);
            this.mediaRecorder.ondataavailable = e => {
                if (e.data.size > 0) this.chunks.push(e.data);
            };
            this.mediaRecorder.onstop = () => this._saveRecording();
        }
    }

    start() {
        if (!this.mediaRecorder || this.isRecording) return;
        this.chunks = [];
        this.mediaRecorder.start();
        this.isRecording = true;
    }

    stop() {
        if (!this.mediaRecorder || !this.isRecording) return;
        this.mediaRecorder.stop();
        this.isRecording = false;
    }

    _saveRecording() {
        const blob = new Blob(this.chunks, { type: 'audio/webm' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        document.body.appendChild(a);
        a.style = 'display: none';
        a.href = url;
        a.download = `swara-practice-${new Date().toISOString().replace(/:/g, '-')}.webm`;
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
        this.chunks = [];
    }
}
