/**
 * ui.js — UI controls binding, info panel updates
 */

import { TONIC_OPTIONS } from './harmonics.js';

export class UIController {
    constructor() {
        // Controls
        this.tonicSelect = document.getElementById('tonic-select');
        this.systemSelect = document.getElementById('system-select');
        this.harmonicsSlider = document.getElementById('harmonics-slider');
        this.harmonicsValue = document.getElementById('harmonics-value');
        this.sensitivitySlider = document.getElementById('sensitivity-slider');
        this.sensitivityValue = document.getElementById('sensitivity-value');
        this.startBtn = document.getElementById('start-btn');
        this.freezeBtn = document.getElementById('freeze-btn');

        // Feature 2 & 3 extensions
        this.droneToggle = document.getElementById('drone-toggle');
        this.droneControls = document.getElementById('drone-controls');
        this.droneVolSlider = document.getElementById('drone-vol-slider');
        this.exportImgBtn = document.getElementById('export-img-btn');
        this.recordAudioBtn = document.getElementById('record-audio-btn');

        // Info panel elements
        this.fundamentalDisplay = document.getElementById('fundamental-display');
        this.fundamentalFreq = document.getElementById('fundamental-freq');
        this.confidenceBar = document.getElementById('confidence-bar');
        this.harmonicsList = document.getElementById('harmonics-list');
        this.statusIndicator = document.getElementById('status-indicator');
        this.statusText = document.getElementById('status-text');

        // State
        this.callbacks = {};

        this._populateTonicOptions();
        this._bindEvents();
    }

    /**
     * Register callbacks: { onStart, onStop, onTonicChange, onSystemChange,
     *   onHarmonicsChange, onSensitivityChange, onFreezeToggle }
     */
    on(event, callback) {
        this.callbacks[event] = callback;
    }

    _populateTonicOptions() {
        for (const [name, freq] of Object.entries(TONIC_OPTIONS)) {
            const option = document.createElement('option');
            option.value = freq;
            option.textContent = `${name} (${freq.toFixed(1)} Hz)`;
            if (name === 'C3') option.selected = true;
            this.tonicSelect.appendChild(option);
        }
    }

    _bindEvents() {
        // Start / Stop
        this.startBtn.addEventListener('click', () => {
            const isRunning = this.startBtn.dataset.running === 'true';
            if (isRunning) {
                this._emit('stop');
                this.setRunning(false);
            } else {
                this._emit('start');
            }
        });

        // Freeze
        this.freezeBtn.addEventListener('click', () => {
            const isFrozen = this.freezeBtn.dataset.frozen === 'true';
            this.setFrozen(!isFrozen);
            this._emit('freezeToggle', !isFrozen);
        });

        // Tonic
        this.tonicSelect.addEventListener('change', () => {
            this._emit('tonicChange', parseFloat(this.tonicSelect.value));
        });

        // System
        this.systemSelect.addEventListener('change', () => {
            this._emit('systemChange', this.systemSelect.value);
        });

        // Harmonics slider
        this.harmonicsSlider.addEventListener('input', () => {
            const val = parseInt(this.harmonicsSlider.value);
            this.harmonicsValue.textContent = val;
            this._emit('harmonicsChange', val);
        });

        // Sensitivity slider
        this.sensitivitySlider.addEventListener('input', () => {
            const val = parseInt(this.sensitivitySlider.value);
            this.sensitivityValue.textContent = `${val} dB`;
            this._emit('sensitivityChange', val);
        });

        // Drone toggle
        this.droneToggle.addEventListener('change', () => {
            const isEnabled = this.droneToggle.checked;
            this.droneControls.style.display = isEnabled ? 'block' : 'none';
            this._emit('droneToggle', isEnabled);
        });

        // Drone volume
        this.droneVolSlider.addEventListener('input', () => {
            const val = parseInt(this.droneVolSlider.value);
            this._emit('droneVolChange', val);
        });

        // Export Image
        this.exportImgBtn.addEventListener('click', () => {
            this._emit('exportImage');
        });

        // Record Audio
        this.recordAudioBtn.addEventListener('click', () => {
            const isRecording = this.recordAudioBtn.classList.contains('recording');
            if (isRecording) {
                this.recordAudioBtn.classList.remove('recording');
                this.recordAudioBtn.innerHTML = '⏺ Record Audio';
                this.recordAudioBtn.style.color = '';
                this._emit('recordAudioStop');
            } else {
                this.recordAudioBtn.classList.add('recording');
                this.recordAudioBtn.innerHTML = '⏹ Stop Recording';
                this._emit('recordAudioStart');
            }
        });
    }

    _emit(event, data) {
        if (this.callbacks[event]) {
            this.callbacks[event](data);
        }
    }

    setRunning(running) {
        this.startBtn.dataset.running = running;
        this.startBtn.textContent = running ? '⏹ Stop' : '▶ Start';
        this.startBtn.classList.toggle('running', running);

        if (running) {
            this.statusIndicator.classList.add('active');
            this.statusText.textContent = 'Listening...';
        } else {
            this.statusIndicator.classList.remove('active');
            this.statusText.textContent = 'Stopped';
            this.fundamentalDisplay.textContent = '—';
            this.fundamentalFreq.textContent = '';
            this.confidenceBar.style.width = '0%';
            this.harmonicsList.innerHTML = '<div class="no-data">Start audio to see harmonics</div>';
        }
    }

    setFrozen(frozen) {
        this.freezeBtn.dataset.frozen = frozen;
        this.freezeBtn.textContent = frozen ? '▶ Resume' : '⏸ Freeze';
        this.freezeBtn.classList.toggle('frozen', frozen);
    }

    /**
     * Update the info panel with detected data
     */
    updateInfo(f0, confidence, harmonics) {
        // Fundamental
        if (!f0) {
            this.fundamentalDisplay.textContent = '—';
            this.fundamentalFreq.textContent = '';
            this.confidenceBar.style.width = '0%';
        } else {
            const swaraName = harmonics.length > 0 ? harmonics[0].swara : '—';
            this.fundamentalDisplay.textContent = swaraName;
            this.fundamentalFreq.textContent = `${f0.toFixed(1)} Hz`;

            // Confidence
            const confPct = Math.min(100, Math.round(confidence * 100));
            this.confidenceBar.style.width = `${confPct}%`;

            // Color confidence bar
            if (confPct > 80) {
                this.confidenceBar.style.background = 'linear-gradient(90deg, #ffb320, #ffa000)'; // Saffron
            } else if (confPct > 50) {
                this.confidenceBar.style.background = 'linear-gradient(90deg, #ff6b35, #ed2945)'; // Kumkum
            } else {
                this.confidenceBar.style.background = 'linear-gradient(90deg, #ed2945, #b01010)'; // Crimson
            }
        }

        // Harmonics list — always update
        if (!harmonics || harmonics.length === 0) {
            this.harmonicsList.innerHTML = '<div class="no-data">No harmonics detected</div>';
            return;
        }

        let html = '';
        for (const h of harmonics) {
            const isFundamental = h.harmonicNumber === 1;
            const octaveMark = h.octave > 0 ? "'".repeat(h.octave) : '';
            const centsStr = h.centsOff !== 0 ? `<span class="cents ${h.centsOff > 0 ? 'sharp' : 'flat'}">${h.centsOff > 0 ? '+' : ''}${h.centsOff}¢</span>` : '<span class="cents perfect">±0¢</span>';

            // Amplitude bar width (normalize from threshold to 0 dB)
            const ampNorm = Math.max(0, Math.min(1, (h.amplitude + 100) / 100));

            html += `
                <div class="harmonic-row ${isFundamental ? 'fundamental' : ''}">
                    <span class="h-number">${h.harmonicNumber}</span>
                    <span class="h-swara">${h.swara}${octaveMark}</span>
                    <span class="h-freq">${h.actualFreq.toFixed(1)}</span>
                    ${centsStr}
                    <div class="h-amp-bar">
                        <div class="h-amp-fill" style="width: ${ampNorm * 100}%"></div>
                    </div>
                </div>
            `;
        }
        this.harmonicsList.innerHTML = html;
    }
}
