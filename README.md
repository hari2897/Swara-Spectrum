# 🎵 Swara Spectrum

**Harmonic Overtone Visualizer & Vocal Training Companion**

Swara Spectrum is a professional-grade, real-time audio visualization tool designed specifically for practitioners of Indian Classical Music (ICM). It maps the complex harmonic structures of the human voice to musical Swaras, providing instant visual feedback for Shruti alignment and overtone clarity.

![Swara Spectrum Preview](https://raw.githubusercontent.com/your-username/Audio-spectrum/main/preview.png) *(Note: Placeholder for actual screenshot)*

---

## ✨ Key Features

### 🌌 "Sandhya" (Twilight) Aesthetic
A soothing, premium visual theme inspired by the "Sandhya" (evening) transition. The spectrogram uses a rich palette ranging from deep indigo and peacock teal to warm amber and pale gold, making long practice sessions easy on the eyes.

### 🔍 Precision Spectrogram & history
- **Logarithmic Frequency Scale**: Optimized for musical intervals, ensuring Swaras are spaced naturally.
- **Freeze & Zoom**: Pause the live feed to analyze a specific phrase. A dedicated **History Buffer** allows you to zoom into the frequency axis even while the graph is frozen.
- **Interactive Hover Analysis**: Move your mouse over a frozen spectrogram to see the exact frequency (Hz), time offset, intensity, and nearest Swara.

### 🪕 Built-in Tanpura Drone
A high-fidelity drone engine that synthesizes the fundamental (**Sa**) and fifth (**Pa**) with subtle detuned chorus effects to mimic the rich, resonant "beating" of an acoustic Tanpura.

### 📤 Session Export
- **📸 High-Res Image Export**: Download a high-quality PNG of your current spectrogram view (including all Swara markers and analysis tooltips).
- **⏺ Audio Recording**: Record your practice sessions directly in the browser and save them as standard `.webm` files.

### 📱 PWA & Offline Support
Swara Spectrum is a **Progressive Web App**. You can "Install" it on your desktop or mobile device, and it works completely offline once cached.

---

## 🛠 Tech Stack

- **Audio Engine**: Web Audio API (AnalyserNode, OscillatorNode, MediaRecorder)
- **Visualization**: HTML5 Canvas 2D API
- **Logic**: Vanilla JavaScript (ES6 Modules)
- **Styling**: Modern CSS3 (Glassmorphism, Flexbox, Grid)
- **Typography**: Google Fonts (Philosopher, Outfit, Inter)

---

## 🚀 Getting Started

Since this project uses ES Modules, it must be served via a local web server to avoid CORS issues.

### Using Python
```bash
python -m http.server 3000
```
Then navigate to `http://localhost:3000`.

### Using Node.js (npx)
```bash
npx serve .
```

---

## 💡 Usage Tips

1.  **Set Your Tonic**: Use the dropdown to select your base pitch (Sa). This calibrate the harmonic markers and the Tanpura drone.
2.  **Calibrate Sensitivity**: Adjust the **Sensitivity** slider to filter out background noise or focus on subtle overtones.
3.  **Analyze Overtones**: Look for the glowing markers labeled `2f₀`, `3f₀`, etc. These correspond to your natural harmonics. Clearer overtones indicate better vocal resonance.
4.  **Practice Shruti**: The **Cents Deviation** (e.g., `+5¢`) shows how close you are to the perfect mathematical Shruti position.

---

## 📄 License
MIT License. Created for the love of Music and Math.
