/**
 * harmonics.js — Harmonic generation, FFT peak finding, and Swara mapping
 */

// ── Swara Definitions ──

export const JUST_INTONATION = [
    { name: 'Sa',   ratio: 1 / 1,    abbr: 'S' },
    { name: 'Ri₁',  ratio: 16 / 15,  abbr: 'r' },
    { name: 'Ri₂',  ratio: 9 / 8,    abbr: 'R' },
    { name: 'Ga₂',  ratio: 6 / 5,    abbr: 'g' },
    { name: 'Ga₃',  ratio: 5 / 4,    abbr: 'G' },
    { name: 'Ma₁',  ratio: 4 / 3,    abbr: 'm' },
    { name: 'Ma₂',  ratio: 45 / 32,  abbr: 'M' },
    { name: 'Pa',   ratio: 3 / 2,    abbr: 'P' },
    { name: 'Dha₁', ratio: 8 / 5,    abbr: 'd' },
    { name: 'Dha₂', ratio: 5 / 3,    abbr: 'D' },
    { name: 'Ni₂',  ratio: 9 / 5,    abbr: 'n' },
    { name: 'Ni₃',  ratio: 15 / 8,   abbr: 'N' },
];

export const EQUAL_TEMPERAMENT = [
    { name: 'Sa',   semitones: 0,  abbr: 'S' },
    { name: 'Ri₁',  semitones: 1,  abbr: 'r' },
    { name: 'Ri₂',  semitones: 2,  abbr: 'R' },
    { name: 'Ga₂',  semitones: 3,  abbr: 'g' },
    { name: 'Ga₃',  semitones: 4,  abbr: 'G' },
    { name: 'Ma₁',  semitones: 5,  abbr: 'm' },
    { name: 'Ma₂',  semitones: 6,  abbr: 'M' },
    { name: 'Pa',   semitones: 7,  abbr: 'P' },
    { name: 'Dha₁', semitones: 8,  abbr: 'd' },
    { name: 'Dha₂', semitones: 9,  abbr: 'D' },
    { name: 'Ni₂',  semitones: 10, abbr: 'n' },
    { name: 'Ni₃',  semitones: 11, abbr: 'N' },
];

// ── Tonic frequencies (Hz) ──

export const TONIC_OPTIONS = {
    'C2': 65.41,  'C#2': 69.30, 'D2': 73.42,  'D#2': 77.78,
    'E2': 82.41,  'F2': 87.31,  'F#2': 92.50, 'G2': 98.00,
    'G#2': 103.83,'A2': 110.00, 'A#2': 116.54,'B2': 123.47,
    'C3': 130.81, 'C#3': 138.59,'D3': 146.83, 'D#3': 155.56,
    'E3': 164.81, 'F3': 174.61, 'F#3': 185.00,'G3': 196.00,
    'G#3': 207.65,'A3': 220.00, 'A#3': 233.08,'B3': 246.94,
    'C4': 261.63, 'C#4': 277.18,'D4': 293.66, 'D#4': 311.13,
    'E4': 329.63, 'F4': 349.23, 'F#4': 369.99,'G4': 392.00,
    'G#4': 415.30,'A4': 440.00, 'A#4': 466.16,'B4': 493.88,
    'C5': 523.25,
};

export class HarmonicAnalyzer {
    constructor() {
        this.tonicFreq = 130.81; // Default: C3
        this.harmonicCount = 10;
        this.amplitudeThreshold = -60; // dB threshold for considering a peak
        this.system = 'just'; // 'just' or 'equal'
        this.peakSearchRadius = 3; // bins to search around expected harmonic
    }

    /**
     * Set tonic (Sa) frequency
     */
    setTonic(freq) {
        this.tonicFreq = freq;
    }

    /**
     * Set shruti system
     */
    setSystem(system) {
        this.system = system;
    }

    /**
     * Generate expected harmonic frequencies from f0
     * @param {number} f0 - Fundamental frequency
     * @param {number} count - Number of harmonics
     * @returns {number[]} Array of harmonic frequencies
     */
    generateHarmonics(f0, count) {
        const harmonics = [];
        for (let n = 1; n <= count; n++) {
            harmonics.push(n * f0);
        }
        return harmonics;
    }

    /**
     * Find actual peaks near expected harmonic frequencies in FFT data
     * @param {Float32Array} fftData - FFT magnitude data in dB
     * @param {number} binResolution - Hz per bin
     * @param {number} f0 - Detected fundamental
     * @returns {Array} Detected harmonics with frequency, amplitude, swara info
     */
    detectHarmonics(fftData, binResolution, f0) {
        if (!f0 || f0 <= 0) return [];

        const expectedFreqs = this.generateHarmonics(f0, this.harmonicCount);
        const detected = [];

        for (let i = 0; i < expectedFreqs.length; i++) {
            const expectedFreq = expectedFreqs[i];
            const expectedBin = Math.round(expectedFreq / binResolution);

            // Search window around expected bin
            const startBin = Math.max(0, expectedBin - this.peakSearchRadius);
            const endBin = Math.min(fftData.length - 1, expectedBin + this.peakSearchRadius);

            // Find peak in window
            let peakBin = expectedBin;
            let peakAmplitude = -Infinity;

            for (let bin = startBin; bin <= endBin; bin++) {
                if (fftData[bin] > peakAmplitude) {
                    peakAmplitude = fftData[bin];
                    peakBin = bin;
                }
            }

            // Check threshold
            if (peakAmplitude < this.amplitudeThreshold) continue;

            const actualFreq = peakBin * binResolution;
            const swaraInfo = this.mapToSwara(actualFreq);

            detected.push({
                harmonicNumber: i + 1,
                expectedFreq,
                actualFreq,
                amplitude: peakAmplitude,
                bin: peakBin,
                swara: swaraInfo.name,
                swaraAbbr: swaraInfo.abbr,
                octave: swaraInfo.octave,
                centsOff: swaraInfo.centsOff,
            });
        }

        return detected;
    }

    /**
     * Map a frequency to the nearest swara
     * @param {number} freq - Frequency in Hz
     * @returns {{ name: string, abbr: string, octave: number, centsOff: number }}
     */
    mapToSwara(freq) {
        if (freq <= 0) return { name: '—', abbr: '—', octave: 0, centsOff: 0 };

        const tonic = this.tonicFreq;

        // Find which octave this frequency is in relative to the tonic
        const ratio = freq / tonic;
        const octave = Math.floor(Math.log2(ratio));
        const normalizedRatio = ratio / Math.pow(2, octave);

        let bestSwara = null;
        let bestCents = Infinity;

        if (this.system === 'just') {
            for (const swara of JUST_INTONATION) {
                const cents = 1200 * Math.log2(normalizedRatio / swara.ratio);
                if (Math.abs(cents) < Math.abs(bestCents)) {
                    bestCents = cents;
                    bestSwara = swara;
                }
            }
            // Also check Sa of next octave
            const centsToUpperSa = 1200 * Math.log2(normalizedRatio / 2);
            if (Math.abs(centsToUpperSa) < Math.abs(bestCents)) {
                bestCents = centsToUpperSa;
                bestSwara = JUST_INTONATION[0];
                // octave + 1 handled below
            }
        } else {
            // Equal temperament
            for (const swara of EQUAL_TEMPERAMENT) {
                const swaraRatio = Math.pow(2, swara.semitones / 12);
                const cents = 1200 * Math.log2(normalizedRatio / swaraRatio);
                if (Math.abs(cents) < Math.abs(bestCents)) {
                    bestCents = cents;
                    bestSwara = swara;
                }
            }
        }

        // Determine display octave marker
        let octaveStr = octave;

        return {
            name: bestSwara ? bestSwara.name : '—',
            abbr: bestSwara ? bestSwara.abbr : '—',
            octave: octaveStr,
            centsOff: Math.round(bestCents),
        };
    }

    /**
     * Get all swara frequencies for current tonic (for guide lines)
     * @param {number} minFreq
     * @param {number} maxFreq
     * @returns {Array<{ freq: number, name: string }>}
     */
    getSwaraFrequencies(minFreq, maxFreq) {
        const result = [];
        const swaras = this.system === 'just' ? JUST_INTONATION : EQUAL_TEMPERAMENT;

        for (let octave = -1; octave <= 6; octave++) {
            for (const swara of swaras) {
                let ratio;
                if (this.system === 'just') {
                    ratio = swara.ratio;
                } else {
                    ratio = Math.pow(2, swara.semitones / 12);
                }
                const freq = this.tonicFreq * Math.pow(2, octave) * ratio;
                if (freq >= minFreq && freq <= maxFreq) {
                    result.push({
                        freq,
                        name: swara.name,
                        abbr: swara.abbr,
                        octave,
                    });
                }
            }
        }

        return result;
    }
}
