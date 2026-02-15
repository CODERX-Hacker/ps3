import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import './app.css';
import { VisionService } from './services/visionService';
import { HandLandmark } from './types';
import {
  SHAPES,
  SHAPE_LABELS,
  TECHNIQUES,
  TECHNIQUE_LABELS,
  TECH_STYLE,
  ShapePreset,
  Technique,
  detectJjkTechnique,
  detectMetrics,
  detectShapePreset,
  getShapeParticle,
  getTechniqueParticle,
  mapPinchToZoom
} from './utils/interactionModes';

type AppMode = 'jjk' | 'shape' | 'mimic';
type HandSource = 'both' | 'left' | 'right';
type CameraPreset = 'wide' | 'balanced' | 'close';
type MimicStyle = 'skeleton' | 'ghost' | 'ribbon';
type DetectionMode = 'auto' | 'manual';
type InteractionMode = 'attract' | 'repel' | 'swirl' | 'idle';

interface TrackedHand {
  landmarks: HandLandmark[];
  handedness: 'Left' | 'Right';
  confidence: number;
}

interface TrackingSnapshot {
  hands: TrackedHand[];
  lastSeenAt: number;
}

interface ParticleBuffers {
  count: number;
  positions: Float32Array;
  velocities: Float32Array;
  targets: Float32Array;
  colors: Float32Array;
  seeds: Float32Array;
}

interface SlashFx {
  id: number;
  top: number;
  left: number;
  width: number;
  rotate: number;
  thick: boolean;
  fromRight: boolean;
}

interface RuntimeSettings {
  mode: AppMode;
  handSource: HandSource;
  mimicStyle: MimicStyle;
  techniqueMode: DetectionMode;
  shapeMode: DetectionMode;
  manualTechnique: Technique;
  manualShape: ShapePreset;
  objectScale: number;
  returnForce: number;
  damping: number;
  jitter: number;
  interactionRadius: number;
  attractStrength: number;
  repelStrength: number;
  swirlStrength: number;
  rotationSpeed: number;
  zoomSensitivity: number;
  gestureHoldFrames: number;
  switchCooldownMs: number;
  mirrorVideo: boolean;
  autoRotate: boolean;
  trackingSmoothing: number;
}

interface CameraPresetInfo {
  width: number;
  height: number;
  frameRate: number;
}

const CAMERA_PRESETS: Record<CameraPreset, CameraPresetInfo> = {
  wide: { width: 1280, height: 720, frameRate: 30 },
  balanced: { width: 960, height: 540, frameRate: 30 },
  close: { width: 640, height: 480, frameRate: 60 }
};

const HAND_CONNECTIONS: Array<[number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [0, 9], [9, 10], [10, 11], [11, 12],
  [0, 13], [13, 14], [14, 15], [15, 16],
  [0, 17], [17, 18], [18, 19], [19, 20],
  [5, 9], [9, 13], [13, 17]
];

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const lerp = (from: number, to: number, alpha: number): number =>
  from + (to - from) * alpha;

const mapWorldPoint = (lm: HandLandmark, mirror: boolean): [number, number, number] => {
  let x = (lm.x - 0.5) * 28;
  if (mirror) x = -x;
  const y = -(lm.y - 0.5) * 20;
  const z = -lm.z * 22;
  return [x, y, z];
};

const App: React.FC = () => {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const trackingRafRef = useRef<number | null>(null);
  const renderRafRef = useRef<number | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const pointsRef = useRef<THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial> | null>(null);
  const geometryRef = useRef<THREE.BufferGeometry | null>(null);
  const materialRef = useRef<THREE.PointsMaterial | null>(null);
  const trackingRef = useRef<TrackingSnapshot>({ hands: [], lastSeenAt: 0 });
  const buffersRef = useRef<ParticleBuffers | null>(null);
  const smoothingRef = useRef<Record<'Left' | 'Right', HandLandmark[] | null>>({
    Left: null,
    Right: null
  });
  const settingsRef = useRef<RuntimeSettings | null>(null);
  const slashIdRef = useRef(0);
  const lastFrameRef = useRef(0);
  const uiTickRef = useRef(0);
  const lastSlashRef = useRef(0);
  const interactionRef = useRef('Idle');
  const stabilityRef = useRef(0);
  const activeTechniqueRef = useRef<Technique>('neutral');
  const activeShapeRef = useRef<ShapePreset>('sphere');
  const techniqueGateRef = useRef({ candidate: 'neutral' as Technique, frames: 0, lastSwitchAt: 0 });
  const shapeGateRef = useRef({ candidate: 'sphere' as ShapePreset, frames: 0, lastSwitchAt: 0 });
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioMasterRef = useRef<GainNode | null>(null);
  const soundEnabledRef = useRef(true);
  const soundVolumeRef = useRef(0.22);
  const lastInteractionModeRef = useRef<InteractionMode>('idle');

  const [started, setStarted] = useState(false);
  const [overlayError, setOverlayError] = useState('');
  const [cameraStatus, setCameraStatus] = useState('Tap to start camera + hand tracking');
  const [creditStage, setCreditStage] = useState<'inspired' | 'created'>('inspired');
  const [theme, setTheme] = useState<'ember' | 'aqua' | 'obsidian'>('ember');
  const [mode, setMode] = useState<AppMode>('jjk');
  const [handSource, setHandSource] = useState<HandSource>('both');
  const [techniqueMode, setTechniqueMode] = useState<DetectionMode>('auto');
  const [shapeMode, setShapeMode] = useState<DetectionMode>('auto');
  const [manualTechnique, setManualTechnique] = useState<Technique>('neutral');
  const [manualShape, setManualShape] = useState<ShapePreset>('sphere');
  const [activeTechnique, setActiveTechnique] = useState<Technique>('neutral');
  const [activeShape, setActiveShape] = useState<ShapePreset>('sphere');
  const [mimicStyle, setMimicStyle] = useState<MimicStyle>('skeleton');
  const [cameraPreset, setCameraPreset] = useState<CameraPreset>('balanced');
  const [cameraResetToken, setCameraResetToken] = useState(0);
  const [showSkeleton, setShowSkeleton] = useState(true);
  const [mirrorVideo, setMirrorVideo] = useState(true);
  const [autoRotate, setAutoRotate] = useState(true);
  const [showManual, setShowManual] = useState(true);
  const [particleCount, setParticleCount] = useState(18000);
  const [particleSize, setParticleSize] = useState(0.065);
  const [objectScale, setObjectScale] = useState(1.0);
  const [returnForce, setReturnForce] = useState(0.078);
  const [damping, setDamping] = useState(0.9);
  const [jitter, setJitter] = useState(0.012);
  const [interactionRadius, setInteractionRadius] = useState(7.2);
  const [attractStrength, setAttractStrength] = useState(0.5);
  const [repelStrength, setRepelStrength] = useState(0.88);
  const [swirlStrength, setSwirlStrength] = useState(0.45);
  const [rotationSpeed, setRotationSpeed] = useState(0.18);
  const [zoomSensitivity, setZoomSensitivity] = useState(1.0);
  const [gestureHoldFrames, setGestureHoldFrames] = useState(5);
  const [switchCooldownMs, setSwitchCooldownMs] = useState(280);
  const [trackingSmoothing, setTrackingSmoothing] = useState(0.48);
  const [handsDetected, setHandsDetected] = useState(0);
  const [trackingFps, setTrackingFps] = useState(0);
  const [stabilityScore, setStabilityScore] = useState(0);
  const [interactionState, setInteractionState] = useState('Idle');
  const [slashes, setSlashes] = useState<SlashFx[]>([]);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [soundVolume, setSoundVolume] = useState(0.22);

  const modeLabel = useMemo(() => {
    if (mode === 'jjk') return TECHNIQUE_LABELS[activeTechnique];
    if (mode === 'shape') return `Shape Forge: ${SHAPE_LABELS[activeShape]}`;
    return `Hand Mimic: ${mimicStyle}`;
  }, [mode, activeTechnique, activeShape, mimicStyle]);

  const headingStyle = useMemo(() => {
    if (mode !== 'jjk') return undefined;
    const style = TECH_STYLE[activeTechnique];
    return {
      color: style.glow,
      textShadow: `0 0 ${12 + style.bloom * 4}px ${style.glow}`
    };
  }, [activeTechnique, mode]);

  const manualText = useMemo(
    () => [
      'Shape Formation: use one hand, pinch to tighten, open palm for wider forms.',
      'JJK Mode: switch techniques by signs or lock a manual technique for stage demos.',
      'Hand Mimic: particles copy your hand lines; use both hands for mirrored patterns.'
    ],
    []
  );

  const ensureAudio = useCallback((): AudioContext | null => {
    if (typeof window === 'undefined') return null;
    if (!audioContextRef.current) {
      const AudioCtor = (window.AudioContext ?? (window as any).webkitAudioContext) as typeof AudioContext | undefined;
      if (!AudioCtor) return null;
      const context = new AudioCtor();
      const masterGain = context.createGain();
      masterGain.gain.value = soundEnabledRef.current ? soundVolumeRef.current : 0;
      masterGain.connect(context.destination);
      audioContextRef.current = context;
      audioMasterRef.current = masterGain;
    }
    if (audioContextRef.current.state === 'suspended') {
      void audioContextRef.current.resume();
    }
    return audioContextRef.current;
  }, []);

  const playTone = useCallback(
    (
      frequency: number,
      duration = 0.12,
      wave: OscillatorType = 'sine',
      amplitude = 0.08,
      glideTo?: number
    ) => {
      if (!soundEnabledRef.current) return;
      const context = ensureAudio();
      const masterGain = audioMasterRef.current;
      if (!context || !masterGain) return;

      const now = context.currentTime;
      const oscillator = context.createOscillator();
      const toneGain = context.createGain();
      oscillator.type = wave;
      oscillator.frequency.setValueAtTime(frequency, now);
      if (glideTo) {
        oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, glideTo), now + duration);
      }

      toneGain.gain.setValueAtTime(0.0001, now);
      toneGain.gain.exponentialRampToValueAtTime(Math.max(0.001, amplitude), now + 0.012);
      toneGain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

      oscillator.connect(toneGain);
      toneGain.connect(masterGain);
      oscillator.start(now);
      oscillator.stop(now + duration + 0.03);
    },
    [ensureAudio]
  );

  const playTechniqueCue = useCallback(
    (technique: Technique) => {
      const baseByTechnique: Record<Technique, number> = {
        neutral: 196,
        red: 175,
        void: 262,
        purple: 311,
        shrine: 147,
        dismantle: 130,
        nova: 220,
        lotus: 247,
        storm: 294
      };
      const base = baseByTechnique[technique];
      playTone(base, 0.13, 'triangle', 0.08, base * 1.2);
      if (technique !== 'neutral') {
        window.setTimeout(() => playTone(base * 1.5, 0.08, 'sine', 0.05), 65);
      }
    },
    [playTone]
  );

  const playShapeCue = useCallback(
    (shape: ShapePreset) => {
      const baseByShape: Record<ShapePreset, number> = {
        sphere: 196,
        cube: 185,
        torus: 220,
        heart: 247,
        dna: 262,
        galaxy: 294,
        spiral: 330,
        crystal: 349,
        flower: 392,
        wave: 174
      };
      const base = baseByShape[shape];
      playTone(base, 0.11, 'sine', 0.065, base * 1.06);
    },
    [playTone]
  );

  const playInteractionCue = useCallback(
    (modeName: InteractionMode) => {
      if (modeName === 'attract') {
        playTone(188, 0.08, 'sine', 0.038, 236);
        return;
      }
      if (modeName === 'repel') {
        playTone(172, 0.07, 'square', 0.032, 134);
        return;
      }
      if (modeName === 'swirl') {
        playTone(262, 0.09, 'triangle', 0.034, 330);
      }
    },
    [playTone]
  );

  const pickHands = useCallback((source: HandSource) => {
    const hands = [...trackingRef.current.hands].sort((a, b) => b.confidence - a.confidence);
    if (!hands.length) {
      return { primary: null as TrackedHand | null, secondary: null as TrackedHand | null };
    }
    if (source === 'left') {
      const left = hands.find((hand) => hand.handedness === 'Left') ?? null;
      return { primary: left, secondary: null };
    }
    if (source === 'right') {
      const right = hands.find((hand) => hand.handedness === 'Right') ?? null;
      return { primary: right, secondary: null };
    }
    return {
      primary: hands[0] ?? null,
      secondary: hands[1] ?? null
    };
  }, []);

  const spawnSlash = useCallback((count: number) => {
    const next: SlashFx[] = [];
    for (let i = 0; i < count; i += 1) {
      const id = ++slashIdRef.current;
      next.push({
        id,
        top: Math.random() * 90,
        left: Math.random() * 60,
        width: 40 + Math.random() * 50,
        rotate: -30 + Math.random() * 60,
        thick: Math.random() > 0.55,
        fromRight: Math.random() > 0.5
      });
      window.setTimeout(() => {
        setSlashes((prev) => prev.filter((item) => item.id !== id));
      }, 520);
    }
    setSlashes((prev) => [...prev, ...next]);
  }, []);

  const rebuildParticleSystem = useCallback((count: number) => {
    const scene = sceneRef.current;
    if (!scene) return;

    if (pointsRef.current) {
      scene.remove(pointsRef.current);
      geometryRef.current?.dispose();
      materialRef.current?.dispose();
    }

    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);
    const targets = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const seeds = new Float32Array(count * 3);
    for (let i = 0; i < count; i += 1) {
      const idx = i * 3;
      const rx = Math.random() - 0.5;
      const ry = Math.random() - 0.5;
      const rz = Math.random() - 0.5;
      positions[idx] = rx * 26;
      positions[idx + 1] = ry * 26;
      positions[idx + 2] = rz * 26;
      targets[idx] = positions[idx];
      targets[idx + 1] = positions[idx + 1];
      targets[idx + 2] = positions[idx + 2];
      colors[idx] = 0.3;
      colors[idx + 1] = 0.5;
      colors[idx + 2] = 0.8;
      seeds[idx] = Math.random();
      seeds[idx + 1] = Math.random();
      seeds[idx + 2] = Math.random();
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const material = new THREE.PointsMaterial({
      size: materialRef.current?.size ?? 0.065,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexColors: true
    });
    const points = new THREE.Points(geometry, material);
    scene.add(points);

    pointsRef.current = points;
    geometryRef.current = geometry;
    materialRef.current = material;
    buffersRef.current = { count, positions, velocities, targets, colors, seeds };
  }, []);

  useEffect(() => {
    settingsRef.current = {
      mode,
      handSource,
      mimicStyle,
      techniqueMode,
      shapeMode,
      manualTechnique,
      manualShape,
      objectScale,
      returnForce,
      damping,
      jitter,
      interactionRadius,
      attractStrength,
      repelStrength,
      swirlStrength,
      rotationSpeed,
      zoomSensitivity,
      gestureHoldFrames,
      switchCooldownMs,
      mirrorVideo,
      autoRotate,
      trackingSmoothing
    };
  }, [
    mode,
    handSource,
    mimicStyle,
    techniqueMode,
    shapeMode,
    manualTechnique,
    manualShape,
    objectScale,
    returnForce,
    damping,
    jitter,
    interactionRadius,
    attractStrength,
    repelStrength,
    swirlStrength,
    rotationSpeed,
    zoomSensitivity,
    gestureHoldFrames,
    switchCooldownMs,
    mirrorVideo,
    autoRotate,
    trackingSmoothing
  ]);

  useEffect(() => {
    soundEnabledRef.current = soundEnabled;
    soundVolumeRef.current = soundVolume;
    const context = audioContextRef.current;
    const masterGain = audioMasterRef.current;
    if (context && masterGain) {
      masterGain.gain.setTargetAtTime(soundEnabled ? soundVolume : 0, context.currentTime, 0.02);
    }
  }, [soundEnabled, soundVolume]);

  useEffect(() => {
    if (!hostRef.current) return undefined;
    const host = hostRef.current;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(54, host.clientWidth / host.clientHeight, 0.1, 400);
    camera.position.set(0, 0, 42);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(host.clientWidth, host.clientHeight);
    host.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const rim = new THREE.PointLight(0x55c7ff, 0.8);
    rim.position.set(24, 20, 16);
    scene.add(rim);

    sceneRef.current = scene;
    cameraRef.current = camera;
    rendererRef.current = renderer;
    rebuildParticleSystem(particleCount);

    const onResize = () => {
      if (!hostRef.current || !cameraRef.current || !rendererRef.current) return;
      const width = hostRef.current.clientWidth;
      const height = hostRef.current.clientHeight;
      cameraRef.current.aspect = width / height;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(width, height);
    };
    window.addEventListener('resize', onResize);

    return () => {
      window.removeEventListener('resize', onResize);
      if (renderRafRef.current) cancelAnimationFrame(renderRafRef.current);
      geometryRef.current?.dispose();
      materialRef.current?.dispose();
      renderer.dispose();
      if (host.contains(renderer.domElement)) {
        host.removeChild(renderer.domElement);
      }
    };
  }, [rebuildParticleSystem]);

  useEffect(() => {
    rebuildParticleSystem(particleCount);
  }, [particleCount, rebuildParticleSystem]);

  useEffect(() => {
    if (materialRef.current) {
      materialRef.current.size = particleSize;
      materialRef.current.needsUpdate = true;
    }
  }, [particleSize]);

  useEffect(() => {
    const first = window.setTimeout(() => setCreditStage('created'), 1800);
    return () => window.clearTimeout(first);
  }, []);

  const stopCameraStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  }, []);

  const startCamera = useCallback(async () => {
    const videoEl = videoRef.current;
    if (!videoEl) return false;

    const preset = CAMERA_PRESETS[cameraPreset];
    stopCameraStream();
    try {
      setCameraStatus('Opening camera...');
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          width: { ideal: preset.width },
          height: { ideal: preset.height },
          frameRate: { ideal: preset.frameRate }
        },
        audio: false
      });
      streamRef.current = stream;
      videoEl.srcObject = stream;
      await videoEl.play();
      setCameraStatus(`Camera active (${cameraPreset})`);
      return true;
    } catch (error) {
      console.error('Failed to start camera:', error);
      setOverlayError('Camera access failed. Allow webcam permission and retry.');
      setCameraStatus('Camera unavailable');
      return false;
    }
  }, [cameraPreset, stopCameraStream]);

  const startExperience = useCallback(async () => {
    setOverlayError('');
    ensureAudio();
    try {
      setCameraStatus('Loading hand tracker...');
      await VisionService.getInstance().initialize();
      setStarted(true);
      playTone(220, 0.08, 'triangle', 0.07, 330);
      window.setTimeout(() => playTone(330, 0.1, 'sine', 0.06, 392), 90);
    } catch (error) {
      console.error('Initialization failed:', error);
      setOverlayError('Could not initialize vision model. Check internet and reload.');
      setCameraStatus('Initialization failed');
      setStarted(false);
    }
  }, [ensureAudio, playTone]);

  useEffect(() => {
    if (!started) return undefined;
    let cancelled = false;
    let lastUiUpdate = 0;
    let lastTrackTime = performance.now();

    const smoothLandmarks = (handedness: 'Left' | 'Right', next: HandLandmark[]): HandLandmark[] => {
      const alpha = 1 - clamp(settingsRef.current?.trackingSmoothing ?? 0.48, 0.05, 0.9);
      const prev = smoothingRef.current[handedness];
      if (!prev || prev.length !== next.length) {
        const copy = next.map((p) => ({ ...p }));
        smoothingRef.current[handedness] = copy;
        return copy;
      }
      const smoothed: HandLandmark[] = new Array(next.length);
      for (let i = 0; i < next.length; i += 1) {
        smoothed[i] = {
          x: lerp(prev[i].x, next[i].x, alpha),
          y: lerp(prev[i].y, next[i].y, alpha),
          z: lerp(prev[i].z, next[i].z, alpha)
        };
      }
      smoothingRef.current[handedness] = smoothed;
      return smoothed;
    };

    const drawOverlay = (hands: TrackedHand[]) => {
      const canvas = overlayCanvasRef.current;
      const video = videoRef.current;
      if (!canvas || !video) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
        canvas.width = video.videoWidth || 640;
        canvas.height = video.videoHeight || 480;
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (!showSkeleton) return;

      hands.forEach((hand) => {
        const hue = hand.handedness === 'Left' ? '196' : '14';
        ctx.strokeStyle = `hsla(${hue}, 95%, 66%, 0.82)`;
        ctx.lineWidth = 2;
        HAND_CONNECTIONS.forEach(([a, b]) => {
          const p1 = hand.landmarks[a];
          const p2 = hand.landmarks[b];
          const x1 = mirrorVideo ? canvas.width - p1.x * canvas.width : p1.x * canvas.width;
          const x2 = mirrorVideo ? canvas.width - p2.x * canvas.width : p2.x * canvas.width;
          const y1 = p1.y * canvas.height;
          const y2 = p2.y * canvas.height;
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
        });

        ctx.fillStyle = `hsla(${hue}, 100%, 72%, 0.95)`;
        hand.landmarks.forEach((p) => {
          const x = mirrorVideo ? canvas.width - p.x * canvas.width : p.x * canvas.width;
          const y = p.y * canvas.height;
          ctx.beginPath();
          ctx.arc(x, y, 3.5, 0, Math.PI * 2);
          ctx.fill();
        });
      });
    };

    const runTracking = () => {
      if (cancelled) return;
      const video = videoRef.current;
      if (!video || video.readyState < 2) {
        trackingRafRef.current = requestAnimationFrame(runTracking);
        return;
      }

      const now = performance.now();
      const result = VisionService.getInstance().detect(video);
      const nextHands: TrackedHand[] = [];
      if (result && result.landmarks) {
        const handednessList = result.handednesses ?? [];
        result.landmarks.forEach((landmarks, idx) => {
          if (!landmarks?.length) return;
          const handednessName = handednessList[idx]?.[0]?.categoryName === 'Left' ? 'Left' : 'Right';
          const confidence = handednessList[idx]?.[0]?.score ?? 0.75;
          nextHands.push({
            landmarks: smoothLandmarks(handednessName, landmarks),
            handedness: handednessName,
            confidence
          });
        });
      }

      trackingRef.current = {
        hands: nextHands,
        lastSeenAt: nextHands.length ? now : trackingRef.current.lastSeenAt
      };

      drawOverlay(nextHands);
      if (now - lastUiUpdate > 220) {
        const dt = now - lastTrackTime;
        setTrackingFps(Math.round(1000 / Math.max(1, dt)));
        setHandsDetected(nextHands.length);
        const stale = now - trackingRef.current.lastSeenAt;
        setCameraStatus(nextHands.length > 0 ? `Tracking ${nextHands.length} hand(s)` : stale > 1800 ? 'Searching for hands...' : 'Tracking standby');
        lastUiUpdate = now;
      }

      lastTrackTime = now;
      trackingRafRef.current = requestAnimationFrame(runTracking);
    };

    trackingRafRef.current = requestAnimationFrame(runTracking);
    return () => {
      cancelled = true;
      if (trackingRafRef.current) cancelAnimationFrame(trackingRafRef.current);
    };
  }, [mirrorVideo, showSkeleton, started]);

  useEffect(() => {
    if (!started) return undefined;
    let active = true;
    startCamera().then((ok) => {
      if (active && !ok) setStarted(false);
    });
    return () => {
      active = false;
    };
  }, [cameraPreset, cameraResetToken, started, startCamera]);

  useEffect(() => {
    if (!started) return undefined;
    const renderer = rendererRef.current;
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    if (!renderer || !scene || !camera) return undefined;

    let cancelled = false;
    const animate = (timeMs: number) => {
      if (cancelled) return;
      const points = pointsRef.current;
      const buffers = buffersRef.current;
      const settings = settingsRef.current;
      if (!points || !buffers || !settings) {
        renderRafRef.current = requestAnimationFrame(animate);
        return;
      }

      const dt = clamp((timeMs - (lastFrameRef.current || timeMs)) / 16.666, 0.2, 2.2);
      lastFrameRef.current = timeMs;

      const { primary, secondary } = pickHands(settings.handSource);
      const primaryLm = primary?.landmarks ?? null;
      const secondaryLm = secondary?.landmarks ?? null;
      const primaryMetrics = primaryLm ? detectMetrics(primaryLm) : null;

      let technique = activeTechniqueRef.current;
      let shape = activeShapeRef.current;

      if (settings.mode === 'jjk') {
        const candidate =
          settings.techniqueMode === 'manual'
            ? settings.manualTechnique
            : detectJjkTechnique(primaryLm, secondaryLm);
        if (settings.techniqueMode === 'manual') {
          techniqueGateRef.current.candidate = candidate;
          techniqueGateRef.current.frames = settings.gestureHoldFrames;
        } else {
          if (candidate === techniqueGateRef.current.candidate) {
            techniqueGateRef.current.frames += 1;
          } else {
            techniqueGateRef.current.candidate = candidate;
            techniqueGateRef.current.frames = 1;
          }
        }
        const ready =
          settings.techniqueMode === 'manual' ||
          (techniqueGateRef.current.frames >= settings.gestureHoldFrames &&
            timeMs - techniqueGateRef.current.lastSwitchAt >= settings.switchCooldownMs);
        if (ready && candidate !== activeTechniqueRef.current) {
          activeTechniqueRef.current = candidate;
          technique = candidate;
          techniqueGateRef.current.lastSwitchAt = timeMs;
          setActiveTechnique(candidate);
          playTechniqueCue(candidate);
          if (candidate === 'dismantle') spawnSlash(4);
        } else {
          technique = activeTechniqueRef.current;
        }
      } else {
        technique = activeTechniqueRef.current;
      }

      if (settings.mode === 'shape') {
        const candidate =
          settings.shapeMode === 'manual'
            ? settings.manualShape
            : detectShapePreset(primaryLm, secondaryLm);
        if (settings.shapeMode === 'manual') {
          shapeGateRef.current.candidate = candidate;
          shapeGateRef.current.frames = settings.gestureHoldFrames;
        } else {
          if (candidate === shapeGateRef.current.candidate) {
            shapeGateRef.current.frames += 1;
          } else {
            shapeGateRef.current.candidate = candidate;
            shapeGateRef.current.frames = 1;
          }
        }
        const ready =
          settings.shapeMode === 'manual' ||
          (shapeGateRef.current.frames >= settings.gestureHoldFrames &&
            timeMs - shapeGateRef.current.lastSwitchAt >= settings.switchCooldownMs);
        if (ready && candidate !== activeShapeRef.current) {
          activeShapeRef.current = candidate;
          shape = candidate;
          shapeGateRef.current.lastSwitchAt = timeMs;
          setActiveShape(candidate);
          playShapeCue(candidate);
        } else {
          shape = activeShapeRef.current;
        }
      } else {
        shape = activeShapeRef.current;
      }

      if (settings.mode === 'jjk' && technique === 'dismantle' && timeMs - lastSlashRef.current > 190) {
        lastSlashRef.current = timeMs;
        spawnSlash(2);
      }

      const handsForMimic = [primary, secondary].filter(Boolean) as TrackedHand[];
      const baseScale = settings.objectScale;
      const shapeScale =
        settings.mode === 'shape' && primaryMetrics
          ? clamp(baseScale * (1.65 - primaryMetrics.pinch * 7.2), 0.55, 2.2)
          : baseScale;

      for (let i = 0; i < buffers.count; i += 1) {
        const idx = i * 3;
        const a = buffers.seeds[idx];
        const b = buffers.seeds[idx + 1];
        const c = buffers.seeds[idx + 2];

        let tx = 0;
        let ty = 0;
        let tz = 0;
        let cr = 0.3;
        let cg = 0.6;
        let cb = 0.95;

        if (settings.mode === 'jjk') {
          const p = getTechniqueParticle(technique, i, buffers.count, a, b, c);
          tx = p.x * baseScale;
          ty = p.y * baseScale;
          tz = p.z * baseScale;
          cr = clamp(p.r, 0.04, 1.2);
          cg = clamp(p.g, 0.04, 1.2);
          cb = clamp(p.b, 0.04, 1.2);
        } else if (settings.mode === 'shape') {
          const p = getShapeParticle(shape, i, buffers.count, shapeScale, a, b, c);
          tx = p.x;
          ty = p.y;
          tz = p.z;
          cr = clamp(p.r, 0.05, 1.0);
          cg = clamp(p.g, 0.05, 1.0);
          cb = clamp(p.b, 0.05, 1.0);
        } else if (handsForMimic.length > 0) {
          const hand = handsForMimic[i % handsForMimic.length];
          if (settings.mimicStyle === 'ribbon') {
            const edge = HAND_CONNECTIONS[i % HAND_CONNECTIONS.length];
            const pa = hand.landmarks[edge[0]];
            const pb = hand.landmarks[edge[1]];
            const t = b;
            const [ax, ay, az] = mapWorldPoint(pa, settings.mirrorVideo);
            const [bx, by, bz] = mapWorldPoint(pb, settings.mirrorVideo);
            tx = lerp(ax, bx, t) * baseScale + (c - 0.5) * 1.6;
            ty = lerp(ay, by, t) * baseScale + (a - 0.5) * 1.1;
            tz = lerp(az, bz, t) * baseScale + Math.sin(timeMs * 0.003 + a * Math.PI * 2) * 1.2;
          } else {
            const lmIndex = Math.floor(a * hand.landmarks.length) % hand.landmarks.length;
            const lm = hand.landmarks[lmIndex];
            const [wx, wy, wz] = mapWorldPoint(lm, settings.mirrorVideo);
            tx = wx * baseScale;
            ty = wy * baseScale;
            tz = wz * baseScale;
            if (settings.mimicStyle === 'skeleton') {
              const next = hand.landmarks[(lmIndex + 1) % hand.landmarks.length];
              const [nx, ny, nz] = mapWorldPoint(next, settings.mirrorVideo);
              tx = lerp(tx, nx * baseScale, b * 0.45);
              ty = lerp(ty, ny * baseScale, b * 0.45);
              tz = lerp(tz, nz * baseScale, b * 0.45);
            } else {
              tx += Math.sin(timeMs * 0.002 + b * Math.PI * 2) * 1.2;
              ty += (a - 0.5) * 3.2;
              tz += Math.cos(timeMs * 0.002 + c * Math.PI * 2) * 2.6;
            }
          }
          if (hand.handedness === 'Left') {
            cr = 0.42;
            cg = 0.9;
            cb = 1.0;
          } else {
            cr = 1.0;
            cg = 0.56;
            cb = 0.32;
          }
        } else {
          const p = getShapeParticle('sphere', i, buffers.count, 1, a, b, c);
          tx = p.x;
          ty = p.y;
          tz = p.z;
          cr = 0.18;
          cg = 0.36;
          cb = 0.58;
        }

        buffers.targets[idx] = tx;
        buffers.targets[idx + 1] = ty;
        buffers.targets[idx + 2] = tz;
        buffers.colors[idx] = cr;
        buffers.colors[idx + 1] = cg;
        buffers.colors[idx + 2] = cb;
      }

      let interactionMode: InteractionMode = 'idle';
      let interactionX = 0;
      let interactionY = 0;
      let interactionZ = 0;
      if (primaryLm && primaryMetrics) {
        const source = primaryLm[9] ?? primaryLm[0];
        [interactionX, interactionY, interactionZ] = mapWorldPoint(source, settings.mirrorVideo);
        if (settings.mode === 'mimic') {
          interactionMode = primaryMetrics.openCount >= 3 ? 'swirl' : primaryMetrics.pinch < 0.055 ? 'attract' : 'repel';
          interactionRef.current =
            interactionMode === 'swirl'
              ? 'Mimic Spread'
              : interactionMode === 'attract'
                ? 'Mimic Lock'
                : 'Mimic Trace';
        } else {
          interactionMode = primaryMetrics.pinch < 0.052 ? 'attract' : primaryMetrics.openCount >= 3 ? 'swirl' : 'repel';
          interactionRef.current =
            interactionMode === 'swirl'
              ? 'Swirl Control'
              : interactionMode === 'attract'
                ? 'Attract Control'
                : 'Repel Control';
        }
        const zoomTarget = mapPinchToZoom(primaryMetrics.pinch, settings.zoomSensitivity);
        camera.position.z = lerp(camera.position.z, zoomTarget, 0.08);
      } else {
        interactionRef.current = 'Idle';
        camera.position.z = lerp(camera.position.z, 42, 0.04);
      }

      if (interactionMode !== lastInteractionModeRef.current) {
        lastInteractionModeRef.current = interactionMode;
        if (interactionMode !== 'idle') {
          playInteractionCue(interactionMode);
        }
      }

      const radiusSq = settings.interactionRadius * settings.interactionRadius;
      const attract = settings.attractStrength * 0.11 * dt;
      const repel = settings.repelStrength * 0.13 * dt;
      const swirl = settings.swirlStrength * 0.1 * dt;
      const damp = Math.pow(settings.damping, dt);
      const returnForceStep = settings.returnForce * dt;

      for (let i = 0; i < buffers.count; i += 1) {
        const idx = i * 3;
        const px = buffers.positions[idx];
        const py = buffers.positions[idx + 1];
        const pz = buffers.positions[idx + 2];

        let vx = buffers.velocities[idx];
        let vy = buffers.velocities[idx + 1];
        let vz = buffers.velocities[idx + 2];

        vx += (buffers.targets[idx] - px) * returnForceStep;
        vy += (buffers.targets[idx + 1] - py) * returnForceStep;
        vz += (buffers.targets[idx + 2] - pz) * returnForceStep;

        if (interactionMode !== 'idle') {
          const dx = px - interactionX;
          const dy = py - interactionY;
          const dz = pz - interactionZ;
          const distSq = dx * dx + dy * dy + dz * dz;
          if (distSq > 0.001 && distSq < radiusSq) {
            const dist = Math.sqrt(distSq);
            const nx = dx / dist;
            const ny = dy / dist;
            const nz = dz / dist;
            const falloff = 1 - dist / Math.sqrt(radiusSq);
            if (interactionMode === 'attract') {
              vx -= nx * attract * falloff;
              vy -= ny * attract * falloff;
              vz -= nz * attract * falloff;
            } else if (interactionMode === 'repel') {
              vx += nx * repel * falloff;
              vy += ny * repel * falloff;
              vz += nz * repel * falloff;
            } else {
              vx += dz * swirl * falloff;
              vy += (0.15 - ny) * swirl * 0.35;
              vz += -dx * swirl * falloff;
            }
          }
        }

        vx *= damp;
        vy *= damp;
        vz *= damp;

        buffers.positions[idx] = px + vx + (Math.random() - 0.5) * settings.jitter;
        buffers.positions[idx + 1] = py + vy + (Math.random() - 0.5) * settings.jitter;
        buffers.positions[idx + 2] = pz + vz + (Math.random() - 0.5) * settings.jitter;

        buffers.velocities[idx] = vx;
        buffers.velocities[idx + 1] = vy;
        buffers.velocities[idx + 2] = vz;
      }

      const positionAttribute = points.geometry.attributes.position as THREE.BufferAttribute;
      const colorAttribute = points.geometry.attributes.color as THREE.BufferAttribute;
      positionAttribute.needsUpdate = true;
      colorAttribute.needsUpdate = true;

      points.rotation.y += settings.autoRotate ? settings.rotationSpeed * 0.004 * dt : 0;
      points.rotation.x = lerp(points.rotation.x, secondary ? 0.12 : 0.04, 0.02);
      renderer.render(scene, camera);

      const speedQuality = primaryLm ? 1 : 0.45;
      stabilityRef.current = lerp(stabilityRef.current, speedQuality, 0.08);
      if (timeMs - uiTickRef.current > 160) {
        uiTickRef.current = timeMs;
        setInteractionState(interactionRef.current);
        setStabilityScore(Math.round(clamp(stabilityRef.current * 100, 0, 100)));
      }

      renderRafRef.current = requestAnimationFrame(animate);
    };

    renderRafRef.current = requestAnimationFrame(animate);
    return () => {
      cancelled = true;
      if (renderRafRef.current) cancelAnimationFrame(renderRafRef.current);
    };
  }, [pickHands, playInteractionCue, playShapeCue, playTechniqueCue, spawnSlash, started]);

  useEffect(() => () => stopCameraStream(), [stopCameraStream]);

  useEffect(
    () => () => {
      const context = audioContextRef.current;
      if (context && context.state !== 'closed') {
        void context.close();
      }
    },
    []
  );

  return (
    <div className={`jjk-app ${theme === 'ember' ? '' : `theme-${theme}`}`.trim()}>
      <div ref={hostRef} className="renderer-host" />
      <div className="grain" />

      <div className="slash-container">
        {slashes.map((slash) => (
          <div
            key={slash.id}
            className={`slash-line ${slash.thick ? 'thick' : ''} ${slash.fromRight ? 'from-right' : ''}`.trim()}
            style={{
              top: `${slash.top}%`,
              left: `${slash.left}%`,
              width: `${slash.width}%`,
              transform: `rotate(${slash.rotate}deg)`
            }}
          />
        ))}
      </div>

      <div className="credits">
        <div className="credit-switch">
          <span className={`credit-item credit-item--inspired ${creditStage === 'inspired' ? 'credit-item--show' : 'credit-item--hide'}`}>
            Inspired by jjk-heisareeb.vercel.app
          </span>
          <span className={`credit-item credit-item--created ${creditStage === 'created' ? 'credit-item--show' : 'credit-item--hide'}`}>
            Created by Krishna Singh
          </span>
        </div>
        <div className="compat-note">Best on Chrome/Edge desktop with camera permission enabled.</div>
      </div>

      <div className="ui">
        <div className={`technique-name technique-name--${mode === 'jjk' ? activeTechnique : 'neutral'}`} style={headingStyle}>
          {modeLabel}
        </div>
        <div className="technique-subtitle">
          {interactionState} | {handsDetected} hand(s) | {trackingFps} FPS
        </div>
      </div>

      <div className={`video-container ${mirrorVideo ? 'video-container--mirrored' : ''}`.trim()}>
        <video ref={videoRef} className="input-video" muted playsInline autoPlay />
        <canvas ref={overlayCanvasRef} className="output-canvas" />
      </div>

      <aside className="control-dock">
        <h2>Krishna Control Deck</h2>
        <div className="camera-status">{cameraStatus}</div>

        <div className="stats-grid">
          <div className="stat-card">
            <span className="stat-k">Hands</span>
            <span className="stat-v">{handsDetected}</span>
          </div>
          <div className="stat-card">
            <span className="stat-k">Stability</span>
            <span className="stat-v">{stabilityScore}%</span>
          </div>
          <div className="stat-card">
            <span className="stat-k">Mode</span>
            <span className="stat-v">{mode.toUpperCase()}</span>
          </div>
        </div>

        <p className="section-title">Mode</p>
        <div className="mode-grid">
          <button className={`mode-btn ${mode === 'shape' ? 'chip-btn--active' : ''}`} onClick={() => setMode('shape')}>
            Shape Formation
          </button>
          <button className={`mode-btn ${mode === 'jjk' ? 'chip-btn--active' : ''}`} onClick={() => setMode('jjk')}>
            JJK Mode
          </button>
          <button className={`mode-btn ${mode === 'mimic' ? 'chip-btn--active' : ''}`} onClick={() => setMode('mimic')}>
            Hand Mimic
          </button>
        </div>

        <p className="section-title">Hand Source</p>
        <div className="chip-row">
          <button className={`chip-btn ${handSource === 'both' ? 'chip-btn--active' : ''}`} onClick={() => setHandSource('both')}>
            Both
          </button>
          <button className={`chip-btn ${handSource === 'left' ? 'chip-btn--active' : ''}`} onClick={() => setHandSource('left')}>
            Left
          </button>
          <button className={`chip-btn ${handSource === 'right' ? 'chip-btn--active' : ''}`} onClick={() => setHandSource('right')}>
            Right
          </button>
        </div>

        <p className="section-title">JJK Controls</p>
        <div className="chip-row">
          <button className={`chip-btn ${techniqueMode === 'auto' ? 'chip-btn--active' : ''}`} onClick={() => setTechniqueMode('auto')}>
            Auto Sign
          </button>
          <button className={`chip-btn ${techniqueMode === 'manual' ? 'chip-btn--active' : ''}`} onClick={() => setTechniqueMode('manual')}>
            Manual Lock
          </button>
        </div>
        <div className="tech-grid">
          {TECHNIQUES.map((tech) => (
            <button
              key={tech}
              className={`tech-btn ${manualTechnique === tech ? 'tech-btn--active' : ''}`}
              onClick={() => {
                setManualTechnique(tech);
                if (techniqueMode === 'manual') {
                  activeTechniqueRef.current = tech;
                  setActiveTechnique(tech);
                  playTechniqueCue(tech);
                }
              }}
            >
              {TECHNIQUE_LABELS[tech]}
            </button>
          ))}
        </div>

        <p className="section-title">Shape Controls</p>
        <div className="chip-row">
          <button className={`chip-btn ${shapeMode === 'auto' ? 'chip-btn--active' : ''}`} onClick={() => setShapeMode('auto')}>
            Auto Sign
          </button>
          <button className={`chip-btn ${shapeMode === 'manual' ? 'chip-btn--active' : ''}`} onClick={() => setShapeMode('manual')}>
            Manual Lock
          </button>
        </div>
        <div className="tech-grid">
          {SHAPES.map((shapeOption) => (
            <button
              key={shapeOption}
              className={`tech-btn ${manualShape === shapeOption ? 'tech-btn--active' : ''}`}
              onClick={() => {
                setManualShape(shapeOption);
                if (shapeMode === 'manual') {
                  activeShapeRef.current = shapeOption;
                  setActiveShape(shapeOption);
                  playShapeCue(shapeOption);
                }
              }}
            >
              {SHAPE_LABELS[shapeOption]}
            </button>
          ))}
        </div>

        <p className="section-title">Mimic Style</p>
        <div className="chip-row">
          <button className={`chip-btn ${mimicStyle === 'skeleton' ? 'chip-btn--active' : ''}`} onClick={() => setMimicStyle('skeleton')}>
            Skeleton
          </button>
          <button className={`chip-btn ${mimicStyle === 'ghost' ? 'chip-btn--active' : ''}`} onClick={() => setMimicStyle('ghost')}>
            Ghost
          </button>
          <button className={`chip-btn ${mimicStyle === 'ribbon' ? 'chip-btn--active' : ''}`} onClick={() => setMimicStyle('ribbon')}>
            Ribbon
          </button>
        </div>

        <p className="section-title">Camera</p>
        <div className="inline-controls">
          <select value={cameraPreset} onChange={(e) => setCameraPreset(e.target.value as CameraPreset)}>
            <option value="wide">Wide 1280x720</option>
            <option value="balanced">Balanced 960x540</option>
            <option value="close">Close 640x480 @ 60fps</option>
          </select>
          <button onClick={() => setCameraResetToken((v) => v + 1)}>Restart</button>
        </div>
        <label className="toggle">
          <input type="checkbox" checked={mirrorVideo} onChange={(e) => setMirrorVideo(e.target.checked)} />
          Mirror video
        </label>
        <label className="toggle">
          <input type="checkbox" checked={showSkeleton} onChange={(e) => setShowSkeleton(e.target.checked)} />
          Overlay skeleton
        </label>
        <label className="toggle">
          <input type="checkbox" checked={autoRotate} onChange={(e) => setAutoRotate(e.target.checked)} />
          Auto rotate
        </label>

        <p className="section-title">Sound</p>
        <label className="toggle">
          <input
            type="checkbox"
            checked={soundEnabled}
            onChange={(e) => {
              const next = e.target.checked;
              setSoundEnabled(next);
              if (next) ensureAudio();
            }}
          />
          Enable effects
        </label>
        <label className="range-group">
          Volume: {Math.round(soundVolume * 100)}%
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={soundVolume}
            onChange={(e) => setSoundVolume(Number(e.target.value))}
          />
        </label>

        <p className="section-title">Dynamics</p>
        <label className="range-group">
          Particle Count: {particleCount}
          <input type="range" min={6000} max={42000} step={1000} value={particleCount} onChange={(e) => setParticleCount(Number(e.target.value))} />
        </label>
        <label className="range-group">
          Particle Size: {particleSize.toFixed(3)}
          <input type="range" min={0.02} max={0.14} step={0.005} value={particleSize} onChange={(e) => setParticleSize(Number(e.target.value))} />
        </label>
        <label className="range-group">
          Formation Scale: {objectScale.toFixed(2)}
          <input type="range" min={0.55} max={2.4} step={0.05} value={objectScale} onChange={(e) => setObjectScale(Number(e.target.value))} />
        </label>
        <label className="range-group">
          Return Force: {returnForce.toFixed(3)}
          <input type="range" min={0.02} max={0.2} step={0.002} value={returnForce} onChange={(e) => setReturnForce(Number(e.target.value))} />
        </label>
        <label className="range-group">
          Damping: {damping.toFixed(3)}
          <input type="range" min={0.78} max={0.98} step={0.002} value={damping} onChange={(e) => setDamping(Number(e.target.value))} />
        </label>
        <label className="range-group">
          Interaction Radius: {interactionRadius.toFixed(1)}
          <input type="range" min={3} max={16} step={0.2} value={interactionRadius} onChange={(e) => setInteractionRadius(Number(e.target.value))} />
        </label>
        <label className="range-group">
          Attract Strength: {attractStrength.toFixed(2)}
          <input type="range" min={0.1} max={1.5} step={0.02} value={attractStrength} onChange={(e) => setAttractStrength(Number(e.target.value))} />
        </label>
        <label className="range-group">
          Repel Strength: {repelStrength.toFixed(2)}
          <input type="range" min={0.1} max={1.8} step={0.02} value={repelStrength} onChange={(e) => setRepelStrength(Number(e.target.value))} />
        </label>
        <label className="range-group">
          Swirl Strength: {swirlStrength.toFixed(2)}
          <input type="range" min={0.1} max={1.2} step={0.02} value={swirlStrength} onChange={(e) => setSwirlStrength(Number(e.target.value))} />
        </label>
        <label className="range-group">
          Rotation Speed: {rotationSpeed.toFixed(2)}
          <input type="range" min={0} max={0.8} step={0.02} value={rotationSpeed} onChange={(e) => setRotationSpeed(Number(e.target.value))} />
        </label>
        <label className="range-group">
          Zoom Sensitivity: {zoomSensitivity.toFixed(2)}
          <input type="range" min={0.4} max={2.0} step={0.05} value={zoomSensitivity} onChange={(e) => setZoomSensitivity(Number(e.target.value))} />
        </label>
        <label className="range-group">
          Gesture Hold Frames: {gestureHoldFrames}
          <input type="range" min={1} max={18} step={1} value={gestureHoldFrames} onChange={(e) => setGestureHoldFrames(Number(e.target.value))} />
        </label>
        <label className="range-group">
          Switch Cooldown ms: {switchCooldownMs}
          <input type="range" min={80} max={900} step={20} value={switchCooldownMs} onChange={(e) => setSwitchCooldownMs(Number(e.target.value))} />
        </label>
        <label className="range-group">
          Jitter: {jitter.toFixed(3)}
          <input type="range" min={0} max={0.08} step={0.002} value={jitter} onChange={(e) => setJitter(Number(e.target.value))} />
        </label>
        <label className="range-group">
          Tracking Smoothing: {trackingSmoothing.toFixed(2)}
          <input type="range" min={0.05} max={0.9} step={0.02} value={trackingSmoothing} onChange={(e) => setTrackingSmoothing(Number(e.target.value))} />
        </label>

        <p className="section-title">Theme</p>
        <div className="chip-row">
          <button className={`chip-btn ${theme === 'ember' ? 'chip-btn--active' : ''}`} onClick={() => setTheme('ember')}>
            Ember
          </button>
          <button className={`chip-btn ${theme === 'aqua' ? 'chip-btn--active' : ''}`} onClick={() => setTheme('aqua')}>
            Aqua
          </button>
          <button className={`chip-btn ${theme === 'obsidian' ? 'chip-btn--active' : ''}`} onClick={() => setTheme('obsidian')}>
            Obsidian
          </button>
        </div>

        <p className="section-title">Manual</p>
        <div className="chip-row">
          <button className={`chip-btn ${showManual ? 'chip-btn--active' : ''}`} onClick={() => setShowManual((v) => !v)}>
            {showManual ? 'Hide Manual' : 'Show Manual'}
          </button>
        </div>
        {showManual && (
          <div className="manual-panel">
            {manualText.map((line) => (
              <p key={line}>{line}</p>
            ))}
            <p className="manual-note">Tip: lock Manual mode for demos, keep Auto for live gesture play.</p>
          </div>
        )}
      </aside>

      {!started && (
        <div className="overlay" onClick={startExperience}>
          <div>
            <h1>Tap To Activate Gesture Core</h1>
            <p className={overlayError ? 'overlay-error' : undefined}>
              {overlayError || 'Camera + hand tracking will start. Then choose Shape, JJK, or Mimic mode.'}
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
