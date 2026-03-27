/**
 * pitch.js — YIN pitch detection algorithm
 * 
 * Reference: De Cheveigné, A., & Kawahara, H. (2002).
 * "YIN, a fundamental frequency estimator for speech and music."
 * 
 * The YIN algorithm steps:
 * 1. Difference function
 * 2. Cumulative mean normalized difference function (CMND)
 * 3. Absolute thresholding
 * 4. Parabolic interpolation
 */

export class PitchDetector {
    constructor(sampleRate = 44100, bufferSize = 8192) {
        this.sampleRate = sampleRate;
        this.bufferSize = bufferSize;
        this.threshold = 0.15; // YIN threshold (lower = stricter)
        
        // Frequency bounds for vocal detection
        this.minFreq = 60;   // Hz — below C2
        this.maxFreq = 1500; // Hz — above G6

        // Derived lag bounds
        this.minLag = Math.floor(sampleRate / this.maxFreq);
        this.maxLag = Math.ceil(sampleRate / this.minFreq);

        // Pre-allocate buffers
        this.yinBuffer = new Float32Array(this.maxLag + 1);
        
        // Smoothing
        this.lastPitch = null;
        this.confidence = 0;
    }

    /**
     * Detect fundamental frequency from time-domain buffer.
     * @param {Float32Array} buffer - Time-domain audio samples
     * @returns {{ frequency: number, confidence: number } | null}
     */
    detect(buffer) {
        if (!buffer || buffer.length < this.maxLag * 2) return null;

        const halfLen = Math.min(Math.floor(buffer.length / 2), this.maxLag + 1);

        // Step 1: Difference function
        this._differenceFunction(buffer, halfLen);

        // Step 2: Cumulative mean normalized difference
        this._cumulativeMeanNormalized(halfLen);

        // Step 3: Absolute threshold — find first dip below threshold
        let tauEstimate = this._absoluteThreshold(halfLen);

        if (tauEstimate === -1) {
            this.lastPitch = null;
            this.confidence = 0;
            return null;
        }

        // Step 4: Parabolic interpolation for sub-sample accuracy
        let betterTau = this._parabolicInterpolation(tauEstimate, halfLen);
        let frequency = this.sampleRate / betterTau;

        // Sanity check
        if (frequency < this.minFreq || frequency > this.maxFreq) {
            this.lastPitch = null;
            this.confidence = 0;
            return null;
        }

        this.confidence = 1.0 - this.yinBuffer[tauEstimate];
        this.lastPitch = frequency;

        return {
            frequency,
            confidence: this.confidence
        };
    }

    /** Step 1: Compute difference function d(τ) */
    _differenceFunction(buffer, halfLen) {
        for (let tau = 0; tau < halfLen; tau++) {
            let sum = 0;
            for (let i = 0; i < halfLen; i++) {
                const delta = buffer[i] - buffer[i + tau];
                sum += delta * delta;
            }
            this.yinBuffer[tau] = sum;
        }
    }

    /** Step 2: Cumulative mean normalized difference d'(τ) */
    _cumulativeMeanNormalized(halfLen) {
        this.yinBuffer[0] = 1.0;
        let runningSum = 0;

        for (let tau = 1; tau < halfLen; tau++) {
            runningSum += this.yinBuffer[tau];
            this.yinBuffer[tau] = this.yinBuffer[tau] * tau / runningSum;
        }
    }

    /** Step 3: Find first tau where CMND dips below threshold */
    _absoluteThreshold(halfLen) {
        // Start from minLag to avoid detecting very high frequencies (noise)
        for (let tau = this.minLag; tau < halfLen; tau++) {
            if (this.yinBuffer[tau] < this.threshold) {
                // Find the local minimum from here
                while (tau + 1 < halfLen && this.yinBuffer[tau + 1] < this.yinBuffer[tau]) {
                    tau++;
                }
                return tau;
            }
        }
        return -1; // No pitch found
    }

    /** Step 4: Parabolic interpolation around the estimated tau */
    _parabolicInterpolation(tauEstimate, halfLen) {
        if (tauEstimate <= 0 || tauEstimate >= halfLen - 1) {
            return tauEstimate;
        }

        const s0 = this.yinBuffer[tauEstimate - 1];
        const s1 = this.yinBuffer[tauEstimate];
        const s2 = this.yinBuffer[tauEstimate + 1];

        const adjustment = (s2 - s0) / (2 * (2 * s1 - s2 - s0));

        if (Math.abs(adjustment) < 1) {
            return tauEstimate + adjustment;
        }
        return tauEstimate;
    }
}
