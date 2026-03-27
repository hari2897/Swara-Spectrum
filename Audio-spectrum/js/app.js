/**
 * app.js — Main orchestrator
 * Ties together audio, pitch detection, harmonic analysis,
 * spectrogram rendering, and UI.
 */

import { AudioEngine } from './audio.js';
import { PitchDetector } from './pitch.js';
import { HarmonicAnalyzer } from './harmonics.js';
import { SpectrogramRenderer } from './spectrogram.js';
import { UIController } from './ui.js';

class App {
    constructor() {
        this.audio = new AudioEngine();
        this.pitch = new PitchDetector();
        this.harmonics = new HarmonicAnalyzer();
        this.spectrogram = null;
        this.ui = null;

        this.isRunning = false;
        this.isFrozen = false;
        this.animFrameId = null;

        // Smoothed state
        this.currentF0 = null;
        this.currentConfidence = 0;
        this.currentHarmonics = [];

        // Frozen snapshot
        this.frozenF0 = null;
        this.frozenHarmonics = [];
        this.frozenConfidence = 0;

        // Pitch smoothing
        this.pitchHistory = [];
        this.pitchHistorySize = 5;
    }

    init() {
        // Initialize spectrogram renderer
        const spectrogramCanvas = document.getElementById('spectrogram-canvas');
        const overlayCanvas = document.getElementById('overlay-canvas');
        this.spectrogram = new SpectrogramRenderer(spectrogramCanvas, overlayCanvas);

        // Initialize UI
        this.ui = new UIController();
        this._bindUICallbacks();

        console.log('🎵 Harmonic Overtone Spectrogram initialized');
    }

    _bindUICallbacks() {
        this.ui.on('start', async () => {
            const success = await this.audio.start();
            if (success) {
                this.isRunning = true;
                this.ui.setRunning(true);
                document.getElementById('spectrogram-placeholder').classList.add('hidden');
                this._startLoop();
            } else {
                alert('Could not access microphone. Please grant permission and try again.');
            }
        });

        this.ui.on('stop', () => {
            this._stopLoop();
            this.audio.stop();
            this.isRunning = false;
            this.ui.setRunning(false);
            this.currentF0 = null;
            this.currentHarmonics = [];
            this.pitchHistory = [];
            document.getElementById('spectrogram-placeholder').classList.remove('hidden');
        });

        this.ui.on('tonicChange', (freq) => {
            this.harmonics.setTonic(freq);
            if (this.audio.drone) {
                this.audio.drone.setTonic(freq);
            }
        });

        this.ui.on('systemChange', (system) => {
            this.harmonics.setSystem(system);
        });

        this.ui.on('harmonicsChange', (count) => {
            this.harmonics.harmonicCount = count;
        });

        this.ui.on('sensitivityChange', (threshold) => {
            this.harmonics.amplitudeThreshold = threshold;
        });

        this.ui.on('freezeToggle', (frozen) => {
            this.isFrozen = frozen;
            this.spectrogram.setFrozen(frozen);
            if (frozen) {
                // Snapshot current state
                this.frozenF0 = this.currentF0;
                this.frozenHarmonics = [...this.currentHarmonics];
                this.frozenConfidence = this.currentConfidence;
                // Get swara guide frequencies for the overlay
                const swaraFreqs = this.harmonics.getSwaraFrequencies(
                    this.spectrogram.minFreq, this.spectrogram.maxFreq
                );
                this.spectrogram.renderFrozenOverlay(
                    this.frozenHarmonics,
                    this.frozenF0,
                    this.harmonics.harmonicCount,
                    swaraFreqs
                );
                this.ui.updateInfo(this.frozenF0, this.frozenConfidence, this.frozenHarmonics);
                this.ui.updateInfo(this.frozenF0, this.frozenConfidence, this.frozenHarmonics);
            }
        });

        // ── Feature 2: Tanpura Drone ──
        this.ui.on('droneToggle', (enabled) => {
            if (!this.audio.drone) {
                alert('Please click Start first to enable audio features.');
                document.getElementById('drone-toggle').checked = false;
                document.getElementById('drone-controls').style.display = 'none';
                return;
            }
            if (enabled) {
                this.audio.drone.setTonic(this.harmonics.tonicFreq);
                this.audio.drone.start();
            } else {
                this.audio.drone.stop();
            }
        });

        this.ui.on('droneVolChange', (vol) => {
            if (this.audio.drone) {
                this.audio.drone.setVolume(vol);
            }
        });

        // ── Feature 3: Export & Record ──
        this.ui.on('exportImage', () => {
            this.spectrogram.exportImage();
        });

        this.ui.on('recordAudioStart', () => {
            if (!this.audio.recorder) {
                alert('Please click Start first to begin recording audio.');
                // reset UI
                const btn = document.getElementById('record-audio-btn');
                btn.classList.remove('recording');
                btn.innerHTML = '⏺ Record Audio';
                return;
            }
            this.audio.recorder.start();
        });

        this.ui.on('recordAudioStop', () => {
            if (this.audio.recorder) {
                this.audio.recorder.stop();
            }
        });
    }

    _startLoop() {
        const loop = () => {
            this.animFrameId = requestAnimationFrame(loop);
            this._processFrame();
        };
        loop();
    }

    _stopLoop() {
        if (this.animFrameId) {
            cancelAnimationFrame(this.animFrameId);
            this.animFrameId = null;
        }
    }

    _processFrame() {
        if (!this.isRunning) return;

        // Animate zoom regardless of whether we are frozen or running
        const zoomChanged = this.spectrogram.updateZoom();

        // When frozen, keep the frozen overlay and info panel static
        if (this.isFrozen) {
            // Re-render frozen overlay if frequency axis is changing
            if (zoomChanged) {
                const swaraFreqs = this.harmonics.getSwaraFrequencies(
                    this.spectrogram.minFreq, this.spectrogram.maxFreq
                );
                this.spectrogram.renderFrozenOverlay(
                    this.frozenHarmonics,
                    this.frozenF0,
                    this.harmonics.harmonicCount,
                    swaraFreqs
                );
            }
            return;
        }

        // ── 1. Get audio data ──
        const timeDomain = this.audio.getTimeDomainData();
        const freqData = this.audio.getFrequencyData();
        const freqDataBytes = this.audio.getFrequencyDataBytes();

        if (!timeDomain || !freqData || !freqDataBytes) return;

        // ── 2. Detect pitch ──
        const pitchResult = this.pitch.detect(timeDomain);

        if (pitchResult && pitchResult.confidence > 0.7) {
            // Add to history for smoothing
            this.pitchHistory.push(pitchResult.frequency);
            if (this.pitchHistory.length > this.pitchHistorySize) {
                this.pitchHistory.shift();
            }

            // Median filter for stability
            const sorted = [...this.pitchHistory].sort((a, b) => a - b);
            this.currentF0 = sorted[Math.floor(sorted.length / 2)];
            this.currentConfidence = pitchResult.confidence;
        } else {
            // Decay: keep last pitch briefly
            if (this.pitchHistory.length > 0) {
                this.pitchHistory.pop();
            }
            if (this.pitchHistory.length === 0) {
                this.currentF0 = null;
                this.currentConfidence = 0;
            }
        }

        // ── 3. Detect harmonics ──
        if (this.currentF0) {
            this.currentHarmonics = this.harmonics.detectHarmonics(
                freqData,
                this.audio.binResolution,
                this.currentF0
            );
        } else {
            this.currentHarmonics = [];
        }

        // ── 4. Render spectrogram ──
        this.spectrogram.renderFrame(freqDataBytes, this.audio.binResolution);

        // ── 5. Render overlay ──
        this.spectrogram.renderOverlay(
            this.currentHarmonics,
            this.currentF0,
            this.harmonics.harmonicCount
        );

        // ── 6. Update UI info panel ──
        this.ui.updateInfo(this.currentF0, this.currentConfidence, this.currentHarmonics);
    }
}

// ── Bootstrap ──
document.addEventListener('DOMContentLoaded', () => {
    const app = new App();
    app.init();

    // Register Service Worker for PWA
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('./sw.js').then(registration => {
                console.log('SW registered: ', registration);
            }).catch(registrationError => {
                console.log('SW registration failed: ', registrationError);
            });
        });
    }
});
