/**
 * spectrogram.js — Canvas-based scrolling spectrogram with harmonic overlay
 */

export class SpectrogramRenderer {
    constructor(spectrogramCanvas, overlayCanvas) {
        this.canvas = spectrogramCanvas;
        this.ctx = spectrogramCanvas.getContext('2d', { willReadFrequently: true });
        this.overlay = overlayCanvas;
        this.octx = overlayCanvas.getContext('2d');

        // Frequency range (current, animated)
        this.minFreq = 50;
        this.maxFreq = 4000;

        // Default (full) range for zoom reset
        this.defaultMinFreq = 50;
        this.defaultMaxFreq = 4000;

        // Zoom target (what we're animating toward)
        this.targetMinFreq = 50;
        this.targetMaxFreq = 4000;

        // Zoom animation
        this.zoomLerp = 0.12;       // Lerp factor (0–1, higher = faster)
        this.zoomThreshold = 0.5;   // Hz threshold to snap
        this.isZooming = false;
        this.zoomFactor = 0.15;     // How much one scroll step zooms

        // Zoom limits
        this.absoluteMinFreq = 20;
        this.absoluteMaxFreq = 8000;
        this.minOctaveSpan = 0.5;   // Minimum visible range in octaves

        // Color map cache (256 entries)
        this.colorMap = this._buildColorMap();

        // Log frequency lookup table (maps canvas Y → FFT bin)
        this.freqLookup = null;

        // Scrolling speed (pixels per frame)
        this.scrollSpeed = 2;

        // History Buffer for zooming/freezing
        this.historyBuffer = [];
        this.maxHistoryItems = 0;
        this.lastBinResolution = 1;

        // Frozen state
        this.frozen = false;
        this.lastFrozenData = null;
        this.hoverX = null;
        this.hoverY = null;

        // Zoom indicator element
        this._createZoomIndicator();

        // Event listeners
        this._bindZoomEvents();

        // Resize observer
        this._resizeObserver = new ResizeObserver(() => this._handleResize());
        this._resizeObserver.observe(this.canvas.parentElement);

        this._handleResize();
    }

    _handleResize() {
        const parent = this.canvas.parentElement;
        const w = parent.clientWidth;
        const h = parent.clientHeight;

        // Set both canvases to same size
        this.canvas.width = w;
        this.canvas.height = h;
        this.overlay.width = w;
        this.overlay.height = h;

        // Set history capacity based on width
        this.maxHistoryItems = Math.ceil(w / this.scrollSpeed);

        // Fill with black
        this.ctx.fillStyle = '#000';
        this.ctx.fillRect(0, 0, w, h);

        // Rebuild log frequency lookup
        this._buildFreqLookup();
    }

    /**
     * Build log-scale frequency lookup: maps each canvas row (Y) to
     * { freq, bin } for efficient per-frame rendering.
     */
    _buildFreqLookup() {
        const h = this.canvas.height;
        if (h <= 0) return;

        this.freqLookup = new Array(h);
        const logMin = Math.log2(this.minFreq);
        const logMax = Math.log2(this.maxFreq);

        for (let y = 0; y < h; y++) {
            // y=0 is top (high freq), y=h-1 is bottom (low freq)
            const t = y / (h - 1);
            const logFreq = logMax - t * (logMax - logMin);
            const freq = Math.pow(2, logFreq);
            this.freqLookup[y] = { freq, bin: null }; // bin set per-frame
        }
    }

    /**
     * Convert frequency to canvas Y coordinate
     */
    freqToY(freq) {
        const h = this.canvas.height;
        if (freq <= 0 || h <= 0) return h;

        const logMin = Math.log2(this.minFreq);
        const logMax = Math.log2(this.maxFreq);
        const logF = Math.log2(Math.max(this.minFreq, Math.min(this.maxFreq, freq)));
        const t = (logMax - logF) / (logMax - logMin);
        return Math.round(t * (h - 1));
    }

    /**
     * Build colormap: black → deep blue → purple → magenta → orange → yellow → white
     */
    _buildColorMap() {
        const map = new Array(256);
        const stops = [
            { pos: 0,   r: 0,   g: 0,   b: 0 },       // Silence — Black
            { pos: 25,  r: 15,  g: 10,  b: 45 },       // Deep Indigo
            { pos: 60,  r: 45,  g: 20,  b: 90 },       // Rich Purple
            { pos: 100, r: 60,  g: 50,  b: 140 },      // Violet
            { pos: 135, r: 30,  g: 120, b: 140 },      // Peacock Teal
            { pos: 170, r: 50,  g: 180, b: 160 },      // Jade Green
            { pos: 200, r: 200, g: 170, b: 60 },       // Warm Amber
            { pos: 230, r: 255, g: 220, b: 120 },      // Pale Gold
            { pos: 255, r: 255, g: 250, b: 230 }       // Warm White
        ];

        for (let i = 0; i < 256; i++) {
            // Find surrounding stops
            let lower = stops[0], upper = stops[stops.length - 1];
            for (let s = 0; s < stops.length - 1; s++) {
                if (i >= stops[s].pos && i <= stops[s + 1].pos) {
                    lower = stops[s];
                    upper = stops[s + 1];
                    break;
                }
            }
            const range = upper.pos - lower.pos || 1;
            const t = (i - lower.pos) / range;
            map[i] = {
                r: Math.round(lower.r + t * (upper.r - lower.r)),
                g: Math.round(lower.g + t * (upper.g - lower.g)),
                b: Math.round(lower.b + t * (upper.b - lower.b)),
            };
        }
        return map;
    }

    /**
     * Render one frame of the scrolling spectrogram
     * @param {Uint8Array} frequencyData - Byte frequency data (0–255)
     * @param {number} binResolution - Hz per FFT bin
     */
    renderFrame(frequencyData, binResolution) {
        if (!frequencyData || !this.freqLookup) return;

        // Always store history if not frozen
        if (!this.frozen) {
            this.historyBuffer.push(new Uint8Array(frequencyData));
            if (this.historyBuffer.length > this.maxHistoryItems) {
                this.historyBuffer.shift();
            }
            this.lastBinResolution = binResolution;
        }

        if (this.frozen || this.isZooming) return; // Zooming handles its own redraw

        const w = this.canvas.width;
        const h = this.canvas.height;
        const ctx = this.ctx;

        // Scroll: shift existing content left
        const imageData = ctx.getImageData(this.scrollSpeed, 0, w - this.scrollSpeed, h);
        ctx.putImageData(imageData, 0, 0);

        // Draw new column(s) on the right
        for (let px = 0; px < this.scrollSpeed; px++) {
            const x = w - this.scrollSpeed + px;
            for (let y = 0; y < h; y++) {
                const freq = this.freqLookup[y].freq;
                const bin = Math.round(freq / binResolution);

                if (bin >= 0 && bin < frequencyData.length) {
                    const val = frequencyData[bin];
                    const color = this.colorMap[val];
                    ctx.fillStyle = `rgb(${color.r},${color.g},${color.b})`;
                    ctx.fillRect(x, y, 1, 1);
                }
            }
        }
    }

    /**
     * Render overlay: harmonic markers, guide lines, swara labels, frequency axis
     * @param {Array} harmonics - Detected harmonics from HarmonicAnalyzer
     * @param {number} f0 - Fundamental frequency
     * @param {number} harmonicCount - Number of harmonic guide lines to draw
     */
    renderOverlay(harmonics, f0, harmonicCount) {
        const w = this.overlay.width;
        const h = this.overlay.height;
        const ctx = this.octx;

        ctx.clearRect(0, 0, w, h);

        // ── Frequency axis labels (left edge) ──
        this._drawFrequencyAxis(ctx, w, h);

        // ── Time label ──
        ctx.fillStyle = 'rgba(180, 180, 200, 0.5)';
        ctx.font = '11px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('← Time', w / 2, h - 6);

        if (!f0 || f0 <= 0) return;

        // ── Harmonic guide lines ──
        for (let n = 1; n <= harmonicCount; n++) {
            const freq = n * f0;
            if (freq < this.minFreq || freq > this.maxFreq) continue;

            const y = this.freqToY(freq);

            ctx.strokeStyle = n === 1
                ? 'rgba(255, 179, 32, 0.5)'
                : 'rgba(255, 100, 50, 0.2)';
            ctx.lineWidth = n === 1 ? 1.5 : 0.5;
            ctx.setLineDash(n === 1 ? [] : [4, 4]);
            ctx.beginPath();
            ctx.moveTo(60, y);
            ctx.lineTo(w, y);
            ctx.stroke();
            ctx.setLineDash([]);

            // Label on left
            ctx.fillStyle = n === 1
                ? 'rgba(255, 179, 32, 0.8)'
                : 'rgba(255, 100, 50, 0.4)';
            ctx.font = '10px Inter, sans-serif';
            ctx.textAlign = 'right';
            ctx.fillText(`${n}f₀`, 56, y + 3);
        }

        // ── Harmonic peak markers & swara labels ──
        for (const h of harmonics) {
            if (h.actualFreq < this.minFreq || h.actualFreq > this.maxFreq) continue;

            const y = this.freqToY(h.actualFreq);
            const x = w - 24;

            const isFundamental = h.harmonicNumber === 1;
            const radius = isFundamental ? 9 : 6;

            // Glow
            const glowRadius = isFundamental ? 22 : 15;
            const gradient = ctx.createRadialGradient(x, y, 0, x, y, glowRadius);

            if (isFundamental) {
                gradient.addColorStop(0, 'rgba(255, 179, 32, 0.9)');
                gradient.addColorStop(0.5, 'rgba(255, 179, 32, 0.35)');
                gradient.addColorStop(1, 'rgba(255, 179, 32, 0)');
            } else {
                gradient.addColorStop(0, 'rgba(255, 100, 50, 0.8)');
                gradient.addColorStop(0.5, 'rgba(255, 100, 50, 0.25)');
                gradient.addColorStop(1, 'rgba(255, 100, 50, 0)');
            }

            ctx.fillStyle = gradient;
            ctx.beginPath();
            ctx.arc(x, y, glowRadius, 0, Math.PI * 2);
            ctx.fill();

            // Marker circle
            ctx.fillStyle = isFundamental
                ? 'rgba(255, 179, 32, 0.95)'
                : 'rgba(255, 100, 50, 0.85)';
            ctx.beginPath();
            ctx.arc(x, y, radius, 0, Math.PI * 2);
            ctx.fill();

            // Inner dot
            ctx.fillStyle = '#fff';
            ctx.beginPath();
            ctx.arc(x, y, 2.5, 0, Math.PI * 2);
            ctx.fill();

            // Swara label with background pill
            const octaveMarker = h.octave > 0 ? "'" .repeat(h.octave) : (h.octave < 0 ? "," .repeat(Math.abs(h.octave)) : '');
            const label = h.swara + octaveMarker;

            ctx.font = isFundamental
                ? 'bold 16px Inter, sans-serif'
                : 'bold 14px Inter, sans-serif';
            ctx.textAlign = 'right';

            // Measure text for background pill
            const textWidth = ctx.measureText(label).width;
            const pillX = x - radius - 12 - textWidth;
            const pillY = y - 10;
            const pillW = textWidth + 12;
            const pillH = 22;

            // Background pill
            ctx.fillStyle = isFundamental
                ? 'rgba(30, 15, 0, 0.9)'
                : 'rgba(20, 8, 5, 0.85)';
            ctx.beginPath();
            ctx.roundRect(pillX, pillY, pillW, pillH, 6);
            ctx.fill();

            // Pill border
            ctx.strokeStyle = isFundamental
                ? 'rgba(255, 179, 32, 0.5)'
                : 'rgba(255, 100, 50, 0.3)';
            ctx.lineWidth = 1;
            ctx.stroke();

            // Text
            ctx.fillStyle = isFundamental ? '#ffb320' : '#ffb3a0';
            ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
            ctx.shadowBlur = 0;
            ctx.fillText(label, x - radius - 6, y + 5);

            // Cents deviation
            if (Math.abs(h.centsOff) > 0) {
                const sign = h.centsOff > 0 ? '+' : '';
                ctx.font = '11px Inter, sans-serif';
                ctx.fillStyle = Math.abs(h.centsOff) <= 10 ? 'rgba(255, 179, 32, 0.7)' : 'rgba(255, 50, 50, 0.8)';
                ctx.fillText(`${sign}${h.centsOff}¢`, x - radius - 6, y + 19);
            }
        }
    }

    /**
     * Draw frequency axis labels on the left
     */
    _drawFrequencyAxis(ctx, w, h) {
        const freqs = [100, 200, 300, 500, 800, 1000, 1500, 2000, 3000, 4000];

        ctx.font = '10px Inter, sans-serif';
        ctx.textAlign = 'right';

        for (const freq of freqs) {
            if (freq < this.minFreq || freq > this.maxFreq) continue;
            const y = this.freqToY(freq);

            // Tick line
            ctx.strokeStyle = 'rgba(100, 120, 160, 0.25)';
            ctx.lineWidth = 0.5;
            ctx.beginPath();
            ctx.moveTo(48, y);
            ctx.lineTo(60, y);
            ctx.stroke();

            // Label
            ctx.fillStyle = 'rgba(140, 160, 200, 0.7)';
            const labelText = freq >= 1000 ? `${freq / 1000}k` : `${freq}`;
            ctx.fillText(labelText, 46, y + 3);
        }

        // Axis title
        ctx.save();
        ctx.translate(12, h / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillStyle = 'rgba(140, 160, 200, 0.5)';
        ctx.font = '11px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Frequency (Hz)', 0, 0);
        ctx.restore();
    }

    /**
     * Render a frozen overlay with swara guide lines and harmonic markers.
     * Called once when freeze is activated, not on every frame.
     * @param {Array} harmonics - Snapshotted detected harmonics
     * @param {number} f0 - Snapshotted fundamental frequency
     * @param {number} harmonicCount - Number of harmonics
     * @param {Array} swaraFrequencies - All swara frequencies in visible range
     */
    renderFrozenOverlay(harmonics, f0, harmonicCount, swaraFrequencies) {
        this.lastFrozenData = { harmonics, f0, harmonicCount, swaraFrequencies };

        const w = this.overlay.width;
        const h = this.overlay.height;
        const ctx = this.octx;

        ctx.clearRect(0, 0, w, h);

        // ── Frequency axis labels ──
        this._drawFrequencyAxis(ctx, w, h);

        // ── Frozen indicator ──
        ctx.fillStyle = 'rgba(80, 200, 255, 0.8)';
        ctx.font = 'bold 12px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('⏸ FROZEN', w / 2, 20);

        // ── Swara guide lines across full width ──
        if (swaraFrequencies && swaraFrequencies.length > 0) {
            const saFreqs = new Set();

            for (const swara of swaraFrequencies) {
                const y = this.freqToY(swara.freq);
                if (y < 0 || y >= h) continue;

                const isSa = swara.abbr === 'S';
                const isPa = swara.abbr === 'P';

                // Line style varies by importance
                if (isSa) {
                    ctx.strokeStyle = 'rgba(255, 179, 32, 0.45)';
                    ctx.lineWidth = 1.2;
                    ctx.setLineDash([]);
                    saFreqs.add(swara.freq);
                } else if (isPa) {
                    ctx.strokeStyle = 'rgba(0, 200, 255, 0.35)';
                    ctx.lineWidth = 0.8;
                    ctx.setLineDash([6, 3]);
                } else {
                    ctx.strokeStyle = 'rgba(255, 230, 200, 0.15)';
                    ctx.lineWidth = 0.5;
                    ctx.setLineDash([3, 5]);
                }

                ctx.beginPath();
                ctx.moveTo(60, y);
                ctx.lineTo(w - 65, y);
                ctx.stroke();
                ctx.setLineDash([]);

                // Swara label on the right edge with background pill
                const octaveMarker = swara.octave > 0 ? "'".repeat(swara.octave) : (swara.octave < 0 ? "." : '');
                const label = swara.name + octaveMarker;

                ctx.font = isSa ? 'bold 14px Inter, sans-serif'
                    : isPa ? 'bold 13px Inter, sans-serif'
                    : '12px Inter, sans-serif';
                ctx.textAlign = 'left';

                // Measure for background pill
                const tw = ctx.measureText(label).width;
                const px = w - 64;
                const py = y - 10;
                const pw = tw + 14;
                const ph = 22;

                ctx.fillStyle = isSa ? 'rgba(20, 10, 0, 0.85)'
                    : isPa ? 'rgba(0, 10, 20, 0.8)'
                    : 'rgba(10, 8, 8, 0.75)';
                ctx.beginPath();
                ctx.roundRect(px, py, pw, ph, 5);
                ctx.fill();

                ctx.strokeStyle = isSa ? 'rgba(255, 179, 32, 0.4)'
                    : isPa ? 'rgba(0, 200, 255, 0.3)'
                    : 'rgba(255, 230, 200, 0.2)';
                ctx.lineWidth = 1;
                ctx.stroke();

                ctx.fillStyle = isSa ? 'rgba(255, 179, 32, 1)'
                    : isPa ? 'rgba(0, 200, 255, 0.95)'
                    : 'rgba(255, 230, 200, 0.85)';
                ctx.fillText(label, w - 57, y + 5);

                // Frequency annotation
                ctx.font = '10px Inter, sans-serif';
                ctx.fillStyle = 'rgba(160, 160, 190, 0.6)';
                ctx.fillText(`${swara.freq.toFixed(0)}`, w - 57, y + 18);
            }
        }

        // ── Harmonic guide lines (n×f0) ──
        if (f0 && f0 > 0) {
            for (let n = 1; n <= harmonicCount; n++) {
                const freq = n * f0;
                if (freq < this.minFreq || freq > this.maxFreq) continue;

                const y = this.freqToY(freq);

                ctx.strokeStyle = n === 1
                    ? 'rgba(0, 255, 180, 0.6)'
                    : 'rgba(100, 180, 255, 0.25)';
                ctx.lineWidth = n === 1 ? 2 : 0.7;
                ctx.setLineDash(n === 1 ? [] : [4, 4]);
                ctx.beginPath();
                ctx.moveTo(60, y);
                ctx.lineTo(w - 70, y);
                ctx.stroke();
                ctx.setLineDash([]);

                // n×f0 label on left
                ctx.fillStyle = n === 1
                    ? 'rgba(255, 179, 32, 0.9)'
                    : 'rgba(255, 100, 50, 0.5)';
                ctx.font = '11px Inter, sans-serif';
                ctx.textAlign = 'right';
                ctx.fillText(`${n}f₀`, 56, y + 3);
            }

            // ── Harmonic peak markers & swara labels ──
            for (const harm of harmonics) {
                if (harm.actualFreq < this.minFreq || harm.actualFreq > this.maxFreq) continue;

                const y = this.freqToY(harm.actualFreq);
                const x = w - 90;

                const isFundamental = harm.harmonicNumber === 1;
                const radius = isFundamental ? 9 : 6;

                // Glow
                const glowRadius = isFundamental ? 24 : 16;
                const gradient = ctx.createRadialGradient(x, y, 0, x, y, glowRadius);

                if (isFundamental) {
                    gradient.addColorStop(0, 'rgba(255, 179, 32, 0.9)');
                    gradient.addColorStop(0.4, 'rgba(255, 179, 32, 0.3)');
                    gradient.addColorStop(1, 'rgba(255, 179, 32, 0)');
                } else {
                    gradient.addColorStop(0, 'rgba(255, 100, 50, 0.8)');
                    gradient.addColorStop(0.4, 'rgba(255, 100, 50, 0.2)');
                    gradient.addColorStop(1, 'rgba(255, 100, 50, 0)');
                }

                ctx.fillStyle = gradient;
                ctx.beginPath();
                ctx.arc(x, y, glowRadius, 0, Math.PI * 2);
                ctx.fill();

                // Marker
                ctx.fillStyle = isFundamental
                    ? 'rgba(255, 179, 32, 0.95)'
                    : 'rgba(255, 100, 50, 0.85)';
                ctx.beginPath();
                ctx.arc(x, y, radius, 0, Math.PI * 2);
                ctx.fill();

                ctx.fillStyle = '#fff';
                ctx.beginPath();
                ctx.arc(x, y, 2.5, 0, Math.PI * 2);
                ctx.fill();

                // Swara label with background pill
                const octMark = harm.octave > 0 ? "'".repeat(harm.octave) : '';
                const label = harm.swara + octMark;

                ctx.font = isFundamental
                    ? 'bold 16px Inter, sans-serif'
                    : 'bold 14px Inter, sans-serif';
                ctx.textAlign = 'right';

                const textWidth = ctx.measureText(label).width;
                const pillX = x - radius - 14 - textWidth;
                const pillY = y - 11;
                const pillW = textWidth + 14;
                const pillH = 24;

                ctx.fillStyle = isFundamental
                    ? 'rgba(30, 15, 0, 0.9)'
                    : 'rgba(20, 8, 5, 0.85)';
                ctx.beginPath();
                ctx.roundRect(pillX, pillY, pillW, pillH, 6);
                ctx.fill();

                ctx.strokeStyle = isFundamental
                    ? 'rgba(255, 179, 32, 0.6)'
                    : 'rgba(255, 100, 50, 0.35)';
                ctx.lineWidth = 1;
                ctx.stroke();

                ctx.fillStyle = isFundamental ? '#ffb320' : '#ffb3a0';
                ctx.fillText(label, x - radius - 7, y + 5);

                // Cents
                if (Math.abs(harm.centsOff) > 0) {
                    const sign = harm.centsOff > 0 ? '+' : '';
                    ctx.font = '11px Inter, sans-serif';
                    ctx.fillStyle = Math.abs(harm.centsOff) <= 10 ? 'rgba(255, 179, 32, 0.7)' : 'rgba(255, 50, 50, 0.8)';
                    ctx.fillText(`${sign}${harm.centsOff}¢`, x - radius - 7, y + 20);
                }
            }
        }

        // ── Hover Crosshair & Data Tooltip ──
        if (this.hoverX !== null && this.hoverY !== null) {
            this._drawHoverTooltip(ctx, w, h);
        }
    }

    _drawHoverTooltip(ctx, w, h) {
        const x = this.hoverX;
        const y = this.hoverY;

        // 1. Calculate time offset (60 FPS = ~16.66ms per frame)
        let framesAgo = (w - this.scrollSpeed - x) / this.scrollSpeed;
        framesAgo = Math.max(0, Math.min(this.historyBuffer.length - 1, Math.round(framesAgo)));
        const timeOffsetSeconds = -((framesAgo * 16.666) / 1000);

        // 2. Map Y to frequency
        if (!this.freqLookup || y < 0 || y >= h) return;
        const freq = this.freqLookup[y].freq;

        // 3. Find frequency magnitude in history
        const historyFrame = this.historyBuffer[this.historyBuffer.length - 1 - framesAgo];
        let amp = 0;
        if (historyFrame) {
            const bin = Math.round(freq / this.lastBinResolution);
            if (bin >= 0 && bin < historyFrame.length) {
                amp = historyFrame[bin];
            }
        }

        // 4. Find closest Swara
        let closestSwara = null;
        let minDiff = Infinity;
        if (this.lastFrozenData && this.lastFrozenData.swaraFrequencies) {
            for (const swara of this.lastFrozenData.swaraFrequencies) {
                const diff = Math.abs(swara.freq - freq);
                if (diff < minDiff) { 
                    minDiff = diff; 
                    closestSwara = swara; 
                }
            }
        }

        // Crosshair
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(0, y); ctx.lineTo(w, y);
        ctx.moveTo(x, 0); ctx.lineTo(x, h);
        ctx.stroke();
        ctx.setLineDash([]);

        // Point dot
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fill();

        // Tooltip text
        const tooltipLines = [
            `Freq: ${freq.toFixed(1)} Hz`,
            `Time: ${timeOffsetSeconds.toFixed(2)}s`
        ];
        if (closestSwara && minDiff < (freq * 0.05)) { // within 5% frequency
            const oct = closestSwara.octave > 0 ? "'".repeat(closestSwara.octave) : '';
            tooltipLines.push(`Nearest: ${closestSwara.name}${oct}`);
        }
        tooltipLines.push(`Intensity: ${Math.round((amp / 255) * 100)}%`);

        ctx.font = '11px Inter, sans-serif';
        const maxTxtW = Math.max(...tooltipLines.map(t => ctx.measureText(t).width));
        const tooltipW = maxTxtW + 16;
        const tooltipH = tooltipLines.length * 16 + 10;
        
        let tx = x + 15;
        let ty = y + 15;
        if (tx + tooltipW > w) tx = x - tooltipW - 15;
        if (ty + tooltipH > h) ty = y - tooltipH - 15;

        // Tooltip Background
        ctx.fillStyle = 'rgba(20, 15, 10, 0.9)';
        ctx.beginPath();
        ctx.roundRect(tx, ty, tooltipW, tooltipH, 6);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255, 179, 32, 0.4)';
        ctx.stroke();

        // Tooltip Text
        ctx.fillStyle = '#fffdf0';
        ctx.textAlign = 'left';
        tooltipLines.forEach((line, i) => {
            ctx.fillText(line, tx + 8, ty + 16 + (i * 16));
        });
    }

    setFrozen(frozen) {
        this.frozen = frozen;
    }

    setFrequencyRange(min, max) {
        this.minFreq = min;
        this.maxFreq = max;
        this.targetMinFreq = min;
        this.targetMaxFreq = max;
        this._buildFreqLookup();
    }

    // ═══════════════════════════════════════
    //  ZOOM
    // ═══════════════════════════════════════

    /** Create zoom indicator DOM element */
    _createZoomIndicator() {
        const container = this.canvas.parentElement;

        this.zoomIndicator = document.createElement('div');
        this.zoomIndicator.className = 'zoom-indicator';
        this.zoomIndicator.innerHTML = `
            <span class="zoom-range" id="zoom-range"></span>
            <button class="zoom-reset-btn" id="zoom-reset-btn" title="Reset zoom (double-click)">⟲</button>
        `;
        container.appendChild(this.zoomIndicator);

        // Reset button
        this.zoomIndicator.querySelector('#zoom-reset-btn').addEventListener('click', () => {
            this.resetZoom();
        });

        this._updateZoomIndicator();
    }

    /** Bind mouse wheel and double-click for zoom */
    _bindZoomEvents() {
        const target = this.overlay; // Overlay is on top, receives events
        target.style.pointerEvents = 'auto';

        // Interactive Hover listener
        target.addEventListener('mousemove', (e) => {
            if (!this.frozen || !this.lastFrozenData) return;
            const rect = target.getBoundingClientRect();
            this.hoverX = e.clientX - rect.left;
            this.hoverY = e.clientY - rect.top;
            
            // Redraw overlay
            this.renderFrozenOverlay(
                this.lastFrozenData.harmonics, 
                this.lastFrozenData.f0, 
                this.lastFrozenData.harmonicCount, 
                this.lastFrozenData.swaraFrequencies
            );
        });

        target.addEventListener('mouseleave', () => {
            if (!this.frozen || !this.lastFrozenData) return;
            this.hoverX = null;
            this.hoverY = null;
            this.renderFrozenOverlay(
                this.lastFrozenData.harmonics, 
                this.lastFrozenData.f0, 
                this.lastFrozenData.harmonicCount, 
                this.lastFrozenData.swaraFrequencies
            );
        });

        // Mouse wheel zoom
        target.addEventListener('wheel', (e) => {
            e.preventDefault();

            const rect = target.getBoundingClientRect();
            const mouseY = e.clientY - rect.top;
            const h = target.height;

            if (h <= 0) return;

            // Frequency at mouse cursor (in log space)
            const logMin = Math.log2(this.targetMinFreq);
            const logMax = Math.log2(this.targetMaxFreq);
            const t = mouseY / (h - 1);
            const logFreqAtCursor = logMax - t * (logMax - logMin);

            // Zoom direction
            const zoomIn = e.deltaY < 0;
            const factor = zoomIn ? (1 - this.zoomFactor) : (1 + this.zoomFactor);

            // Scale the range around the cursor frequency
            let newLogMin = logFreqAtCursor - (logFreqAtCursor - logMin) * factor;
            let newLogMax = logFreqAtCursor + (logMax - logFreqAtCursor) * factor;

            // Enforce minimum span
            if (newLogMax - newLogMin < this.minOctaveSpan) {
                const center = logFreqAtCursor;
                newLogMin = center - this.minOctaveSpan / 2;
                newLogMax = center + this.minOctaveSpan / 2;
            }

            // Clamp to absolute limits
            const absLogMin = Math.log2(this.absoluteMinFreq);
            const absLogMax = Math.log2(this.absoluteMaxFreq);
            newLogMin = Math.max(absLogMin, newLogMin);
            newLogMax = Math.min(absLogMax, newLogMax);

            this.targetMinFreq = Math.pow(2, newLogMin);
            this.targetMaxFreq = Math.pow(2, newLogMax);
            this.isZooming = true;

            this._updateZoomIndicator();
        }, { passive: false });

        // Double-click to reset zoom
        target.addEventListener('dblclick', () => {
            this.resetZoom();
        });

        // Touch pinch zoom
        let lastPinchDist = 0;
        let pinchCenterY = 0;

        target.addEventListener('touchstart', (e) => {
            if (e.touches.length === 2) {
                e.preventDefault();
                const dy = e.touches[1].clientY - e.touches[0].clientY;
                const dx = e.touches[1].clientX - e.touches[0].clientX;
                lastPinchDist = Math.sqrt(dx * dx + dy * dy);
                pinchCenterY = (e.touches[0].clientY + e.touches[1].clientY) / 2 - target.getBoundingClientRect().top;
            }
        }, { passive: false });

        target.addEventListener('touchmove', (e) => {
            if (e.touches.length === 2) {
                e.preventDefault();
                const dy = e.touches[1].clientY - e.touches[0].clientY;
                const dx = e.touches[1].clientX - e.touches[0].clientX;
                const dist = Math.sqrt(dx * dx + dy * dy);

                if (lastPinchDist > 0) {
                    const scale = dist / lastPinchDist;
                    const h = target.height;
                    const logMin = Math.log2(this.targetMinFreq);
                    const logMax = Math.log2(this.targetMaxFreq);
                    const t = pinchCenterY / (h - 1);
                    const logCenter = logMax - t * (logMax - logMin);

                    const factor = 1 / scale;
                    let newLogMin = logCenter - (logCenter - logMin) * factor;
                    let newLogMax = logCenter + (logMax - logCenter) * factor;

                    if (newLogMax - newLogMin < this.minOctaveSpan) {
                        newLogMin = logCenter - this.minOctaveSpan / 2;
                        newLogMax = logCenter + this.minOctaveSpan / 2;
                    }

                    const absLogMin = Math.log2(this.absoluteMinFreq);
                    const absLogMax = Math.log2(this.absoluteMaxFreq);
                    newLogMin = Math.max(absLogMin, newLogMin);
                    newLogMax = Math.min(absLogMax, newLogMax);

                    this.targetMinFreq = Math.pow(2, newLogMin);
                    this.targetMaxFreq = Math.pow(2, newLogMax);
                    this.isZooming = true;
                    this._updateZoomIndicator();
                }

                lastPinchDist = dist;
                pinchCenterY = (e.touches[0].clientY + e.touches[1].clientY) / 2 - target.getBoundingClientRect().top;
            }
        }, { passive: false });

        target.addEventListener('touchend', () => {
            lastPinchDist = 0;
        });
    }

    /** Smoothly animate toward target frequency range. Returns true if actively zooming to trigger overlay redraws. */
    updateZoom() {
        if (!this.isZooming) return false;

        const dMin = this.targetMinFreq - this.minFreq;
        const dMax = this.targetMaxFreq - this.maxFreq;

        // Check if close enough to snap
        if (Math.abs(dMin) < this.zoomThreshold && Math.abs(dMax) < this.zoomThreshold) {
            this.minFreq = this.targetMinFreq;
            this.maxFreq = this.targetMaxFreq;
            this.isZooming = false;
            this._buildFreqLookup();
            this._redrawHistory();
            return true;
        }

        // Lerp in log space for perceptually smooth zoom
        const logMin = Math.log2(this.minFreq);
        const logMax = Math.log2(this.maxFreq);
        const logTargetMin = Math.log2(this.targetMinFreq);
        const logTargetMax = Math.log2(this.targetMaxFreq);

        const newLogMin = logMin + (logTargetMin - logMin) * this.zoomLerp;
        const newLogMax = logMax + (logTargetMax - logMax) * this.zoomLerp;

        this.minFreq = Math.pow(2, newLogMin);
        this.maxFreq = Math.pow(2, newLogMax);

        this._buildFreqLookup();
        this._redrawHistory();
        return true;
    }

    /** Clear the spectrogram canvas (used during zoom transitions) */
    _clearSpectrogram() {
        this.ctx.fillStyle = '#000';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }

    /** Redraw the entire visible spectrogram from the history buffer */
    _redrawHistory() {
        if (!this.freqLookup || this.historyBuffer.length === 0) {
            this._clearSpectrogram();
            return;
        }

        const w = this.canvas.width;
        const h = this.canvas.height;
        const ctx = this.ctx;

        // Fill black first to wipe background
        this._clearSpectrogram();

        const imgData = ctx.getImageData(0, 0, w, h);
        const data = imgData.data;
        const binRes = this.lastBinResolution;

        for (let i = 0; i < this.historyBuffer.length; i++) {
            const freqData = this.historyBuffer[i];
            const framesFromEnd = this.historyBuffer.length - 1 - i;
            const startX = w - this.scrollSpeed - (framesFromEnd * this.scrollSpeed);

            if (startX + this.scrollSpeed <= 0) continue;

            for (let y = 0; y < h; y++) {
                const freq = this.freqLookup[y].freq;
                const bin = Math.round(freq / binRes);

                if (bin >= 0 && bin < freqData.length) {
                    const color = this.colorMap[freqData[bin]];
                    
                    for (let px = 0; px < this.scrollSpeed; px++) {
                        const x = startX + px;
                        if (x >= 0 && x < w) {
                            const idx = (y * w + x) * 4;
                            data[idx] = color.r;
                            data[idx + 1] = color.g;
                            data[idx + 2] = color.b;
                            data[idx + 3] = 255;
                        }
                    }
                }
            }
        }

        ctx.putImageData(imgData, 0, 0);
    }

    /** Reset zoom to default range */
    resetZoom() {
        this.targetMinFreq = this.defaultMinFreq;
        this.targetMaxFreq = this.defaultMaxFreq;
        this.isZooming = true;
        this._updateZoomIndicator();
    }

    /** Update the zoom indicator text */
    _updateZoomIndicator() {
        if (!this.zoomIndicator) return;

        const rangeEl = this.zoomIndicator.querySelector('#zoom-range');
        const resetBtn = this.zoomIndicator.querySelector('#zoom-reset-btn');

        const minStr = this.targetMinFreq >= 1000
            ? `${(this.targetMinFreq / 1000).toFixed(1)}k`
            : `${Math.round(this.targetMinFreq)}`;
        const maxStr = this.targetMaxFreq >= 1000
            ? `${(this.targetMaxFreq / 1000).toFixed(1)}k`
            : `${Math.round(this.targetMaxFreq)}`;

        rangeEl.textContent = `${minStr} – ${maxStr} Hz`;

        // Show/hide reset button based on whether zoomed
        const isDefault = Math.abs(this.targetMinFreq - this.defaultMinFreq) < 1
            && Math.abs(this.targetMaxFreq - this.defaultMaxFreq) < 1;

        this.zoomIndicator.classList.toggle('zoomed', !isDefault);
        resetBtn.style.display = isDefault ? 'none' : 'inline-flex';
    }

    exportImage() {
        const w = this.canvas.width;
        const h = this.canvas.height;
        
        // Create an offscreen canvas
        const exportCanvas = document.createElement('canvas');
        exportCanvas.width = w;
        exportCanvas.height = h;
        const ectx = exportCanvas.getContext('2d');
        
        // Draw background (Spectrogram)
        ectx.drawImage(this.canvas, 0, 0);
        
        // Draw foreground (Overlay markers, swaras, lines)
        ectx.drawImage(this.overlay, 0, 0);
        
        // Trigger download
        const url = exportCanvas.toDataURL('image/png');
        const a = document.createElement('a');
        document.body.appendChild(a);
        a.style = 'display: none';
        a.href = url;
        a.download = `swara-spectrogram-${new Date().toISOString().replace(/:/g, '-')}.png`;
        a.click();
        
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
    }

    destroy() {
        this._resizeObserver.disconnect();
        if (this.zoomIndicator && this.zoomIndicator.parentElement) {
            this.zoomIndicator.parentElement.removeChild(this.zoomIndicator);
        }
    }
}
