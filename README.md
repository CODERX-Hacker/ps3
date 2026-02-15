# Gesture Particles (Particle Core)

**Gesture Particles** is a futuristic, interactive web application that transforms your hand gestures  into a stunning 3D particle swarm. Powered by **MediaPipe** for real-time tracking.
##  Features



###  Hand Gesture Control
Control the 3D scene using your webcam (no VR headset required):
* **✋ Open Hand:** Morphs particles into a **Sphere**.
* **✊ Fist:** Morphs particles into **Saturn** (complete with rings).
* **✌️ Peace Sign:** Morphs particles into a **Flower**.
* **🤟 Love Sign:** Morphs particles into a **Heart**.
* **🤏 Pinch:** Controls **Zoom** (Pinch In/Out).
* **↔️ Move Hand:** Controls **Rotation** (Left/Right).

###  Advanced Tech
* **Self-Healing Camera:** Custom logic automatically detects if the webcam freezes and restarts it without reloading the page.
* **Physics-Based Morphing:** Particles flow smoothly between shapes using linear interpolation.


---

##  Tech Stack

* **Frontend:** HTML5, CSS3 (Cyberpunk aesthetic)
* **3D Engine:** [Three.js](https://threejs.org/) (WebGL)
* **Computer Vision:** [MediaPipe Hands](https://developers.google.com/mediapipe/solutions/vision/hand_landmarker)

---

##  Installation & Setup

 **Important:** Because this project uses ES6 Modules (`import`), it **must be run on a local server**. It will not work if you simply double-click `index.html`.

### Prerequisites
* [VS Code](https://code.visualstudio.com/)
* VS Code Extension: **Live Server**

### Steps
1.  **Clone/Download:**
    Download this repository to your computer.

2.  **Open in VS Code:**
    Right-click the folder and select "Open with Code".

3.  **Start the Server:**
    * Open `index.html`.
    * Right-click anywhere in the code editor.
    * Select **"Open with Live Server"**.

4.  **Permissions:**
    Your browser will ask for **Camera** permissions. Click **Allow** to enable hand tracking .

---

##  Controls Guide

| Input Method | Action | Effect |
| :--- | :--- | :--- |
| **Gesture** | **Open Palm** | Form Sphere |
| **Gesture** | **Fist** | Form Saturn |
| **Gesture** | **Peace Sign** | Form Flower |
| **Gesture** | **Pinch** | Zoom In / Out |
| **Gesture** | **Hand Movement** | Rotate Model |


---

##  Project Structure

```
GestureParticles/
│
├── index.html      # Main UI structure and library imports
├── style.css       # Dark mode, Neon styling, and Responsive UI
├── script.js       # Core Logic: Three.js scene, MediaPipe tracking, AI generation
└── README.md       # Project documentation
```

## Credits
> Made by Krishna
