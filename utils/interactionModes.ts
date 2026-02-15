import { HandLandmark } from '../types';

export type Technique =
  | 'neutral'
  | 'red'
  | 'void'
  | 'purple'
  | 'shrine'
  | 'dismantle'
  | 'nova'
  | 'lotus'
  | 'storm';

export type ShapePreset =
  | 'sphere'
  | 'cube'
  | 'torus'
  | 'heart'
  | 'dna'
  | 'galaxy'
  | 'spiral'
  | 'crystal'
  | 'flower'
  | 'wave';

export interface HandMetrics {
  pinch: number;
  tipsClose: number;
  openCount: number;
  indexUp: boolean;
  middleUp: boolean;
  ringUp: boolean;
  pinkyUp: boolean;
}

export interface ParticlePoint {
  x: number;
  y: number;
  z: number;
  r: number;
  g: number;
  b: number;
}

export const TECHNIQUES: Technique[] = [
  'neutral',
  'red',
  'void',
  'purple',
  'shrine',
  'dismantle',
  'nova',
  'lotus',
  'storm'
];

export const SHAPES: ShapePreset[] = [
  'sphere',
  'cube',
  'torus',
  'heart',
  'dna',
  'galaxy',
  'spiral',
  'crystal',
  'flower',
  'wave'
];

export const TECHNIQUE_LABELS: Record<Technique, string> = {
  neutral: 'Neutral Flow',
  red: 'Reverse Red',
  void: 'Infinite Void',
  purple: 'Hollow Purple',
  shrine: 'Malevolent Shrine',
  dismantle: 'Dismantle',
  nova: 'Solar Nova',
  lotus: 'Lotus Bloom',
  storm: 'Tempest Spiral'
};

export const SHAPE_LABELS: Record<ShapePreset, string> = {
  sphere: 'Sphere',
  cube: 'Cube',
  torus: 'Torus',
  heart: 'Heart',
  dna: 'DNA',
  galaxy: 'Galaxy',
  spiral: 'Spiral',
  crystal: 'Crystal',
  flower: 'Flower',
  wave: 'Wave'
};

export const TECH_STYLE: Record<
  Technique,
  { title: string; glow: string; bloom: number; shake: number }
> = {
  neutral: { title: 'Cursed Energy', glow: '#7ad4ff', bloom: 1.0, shake: 0.0 },
  red: { title: 'Reverse Cursed Technique: Red', glow: '#ff4a4a', bloom: 2.2, shake: 0.45 },
  void: { title: 'Domain Expansion: Infinite Void', glow: '#35d4ff', bloom: 2.0, shake: 0.35 },
  purple: { title: 'Secret Technique: Hollow Purple', glow: '#bc76ff', bloom: 3.8, shake: 0.5 },
  shrine: { title: 'Domain Expansion: Malevolent Shrine', glow: '#ff2424', bloom: 2.7, shake: 0.42 },
  dismantle: { title: 'Dismantle', glow: '#ff2b2b', bloom: 3.0, shake: 1.2 },
  nova: { title: 'Solar Nova', glow: '#ffb347', bloom: 2.6, shake: 0.5 },
  lotus: { title: 'Lotus Bloom', glow: '#ff8ecf', bloom: 2.4, shake: 0.38 },
  storm: { title: 'Tempest Spiral', glow: '#7cd1ff', bloom: 2.8, shake: 0.65 }
};

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

export const detectMetrics = (lm: HandLandmark[]): HandMetrics => {
  const isUp = (tip: number, pip: number): boolean => lm[tip].y < lm[pip].y;
  const indexUp = isUp(8, 6);
  const middleUp = isUp(12, 10);
  const ringUp = isUp(16, 14);
  const pinkyUp = isUp(20, 18);
  return {
    pinch: Math.hypot(lm[8].x - lm[4].x, lm[8].y - lm[4].y),
    tipsClose: Math.hypot(lm[8].x - lm[12].x, lm[8].y - lm[12].y),
    openCount: Number(indexUp) + Number(middleUp) + Number(ringUp) + Number(pinkyUp),
    indexUp,
    middleUp,
    ringUp,
    pinkyUp
  };
};

export const detectJjkTechnique = (
  primary: HandLandmark[] | null,
  secondary: HandLandmark[] | null
): Technique => {
  if (!primary) return 'neutral';
  const main = detectMetrics(primary);

  if (secondary) {
    const second = detectMetrics(secondary);
    if (main.pinch < 0.045 && second.pinch < 0.045) return 'nova';
    if (main.openCount >= 4 && second.openCount >= 4) return 'lotus';
    if (
      (main.openCount >= 4 && second.openCount <= 1) ||
      (second.openCount >= 4 && main.openCount <= 1)
    ) {
      return 'storm';
    }
  }

  if (main.pinch < 0.04) return 'purple';
  if (main.indexUp && main.middleUp && main.ringUp && main.pinkyUp) return 'shrine';
  if (
    main.indexUp &&
    main.middleUp &&
    !main.ringUp &&
    !main.pinkyUp &&
    main.tipsClose < 0.025
  ) {
    return 'dismantle';
  }
  if (main.indexUp && main.middleUp && !main.ringUp) return 'void';
  if (main.indexUp && !main.middleUp) return 'red';
  return 'neutral';
};

export const detectShapePreset = (
  primary: HandLandmark[] | null,
  secondary: HandLandmark[] | null
): ShapePreset => {
  if (!primary) return 'sphere';
  const main = detectMetrics(primary);

  if (secondary) {
    const second = detectMetrics(secondary);
    if (main.openCount >= 4 && second.openCount >= 4) return 'galaxy';
    if (main.pinch < 0.05 && second.pinch < 0.05) return 'flower';
  }

  if (main.pinch < 0.04) return 'torus';
  if (main.openCount === 4) return 'sphere';
  if (main.openCount === 0) return 'cube';
  if (main.indexUp && main.middleUp && !main.ringUp && !main.pinkyUp) return 'heart';
  if (main.indexUp && main.middleUp && main.ringUp && !main.pinkyUp) return 'dna';
  if (main.indexUp && !main.middleUp && !main.ringUp && !main.pinkyUp) return 'spiral';
  if (!main.indexUp && main.middleUp && main.ringUp && main.pinkyUp) return 'wave';
  return 'crystal';
};

export const getTechniqueParticle = (
  technique: Technique,
  i: number,
  count: number,
  a: number,
  b: number,
  c: number
): ParticlePoint => {
  const theta = a * Math.PI * 2;
  const phi = Math.acos(2 * b - 1);

  if (technique === 'neutral') {
    const radius = 14 + c * 18;
    return {
      x: radius * Math.sin(phi) * Math.cos(theta),
      y: radius * Math.sin(phi) * Math.sin(theta),
      z: radius * Math.cos(phi),
      r: 0.14,
      g: 0.24,
      b: 0.38
    };
  }

  if (technique === 'red') {
    if (i < count * 0.12) {
      const radius = c * 10;
      return {
        x: radius * Math.sin(phi) * Math.cos(theta),
        y: radius * Math.sin(phi) * Math.sin(theta),
        z: radius * Math.cos(phi),
        r: 2.8,
        g: 0.12,
        b: 0.1
      };
    }
    const t = i / count;
    const armCount = 3;
    const angle = t * 15 + ((i % armCount) * (Math.PI * 2)) / armCount;
    const radius = 2 + t * 42;
    return {
      x: radius * Math.cos(angle),
      y: radius * Math.sin(angle),
      z: (c - 0.5) * (12 * t),
      r: 0.9,
      g: 0.05,
      b: 0.05
    };
  }

  if (technique === 'void') {
    if (i < count * 0.16) {
      const ringAngle = a * Math.PI * 2;
      return {
        x: 28 * Math.cos(ringAngle),
        y: 28 * Math.sin(ringAngle),
        z: c - 0.5,
        r: 1,
        g: 1,
        b: 1
      };
    }
    const radius = 34 + c * 61;
    return {
      x: radius * Math.sin(phi) * Math.cos(theta),
      y: radius * Math.sin(phi) * Math.sin(theta),
      z: radius * Math.cos(phi),
      r: 0.12,
      g: 0.65,
      b: 1.0
    };
  }

  if (technique === 'purple') {
    if (c > 0.78) {
      return { x: (a - 0.5) * 100, y: (b - 0.5) * 100, z: (c - 0.5) * 100, r: 0.5, g: 0.5, b: 0.75 };
    }
    const radius = 20;
    return {
      x: radius * Math.sin(phi) * Math.cos(theta),
      y: radius * Math.sin(phi) * Math.sin(theta),
      z: radius * Math.cos(phi),
      r: 0.65,
      g: 0.5,
      b: 1.0
    };
  }

  if (technique === 'shrine') {
    if (i < count * 0.3) return { x: (a - 0.5) * 80, y: -15, z: (b - 0.5) * 80, r: 0.45, g: 0, b: 0 };
    if (i < count * 0.42) {
      const xSign = (i % 4) < 2 ? 1 : -1;
      const zSign = (i % 4) % 2 === 0 ? 1 : -1;
      return { x: xSign * 12 + (a - 0.5) * 2.8, y: -15 + b * 30, z: zSign * 8 + (c - 0.5) * 2.8, r: 0.2, g: 0.2, b: 0.2 };
    }
    const ringTheta = a * Math.PI * 2;
    const ringRadius = b * 30;
    const curve = Math.pow(ringRadius / 30, 2) * 10;
    return { x: ringRadius * Math.cos(ringTheta), y: 15 - curve + c * 2, z: ringRadius * Math.sin(ringTheta) * 0.6, r: 0.62, g: 0, b: 0 };
  }

  if (technique === 'dismantle') {
    if (i < count * 0.03) {
      const radius = c * 3.2;
      return { x: radius * Math.sin(phi) * Math.cos(theta), y: radius * Math.sin(phi) * Math.sin(theta), z: radius * Math.cos(phi), r: 0.42, g: 0, b: 0 };
    }
    return { x: 0, y: 0, z: 0, r: 0, g: 0, b: 0 };
  }

  if (technique === 'nova') {
    if (i < count * 0.18) {
      const radius = c * 8;
      return { x: radius * Math.sin(phi) * Math.cos(theta), y: radius * Math.sin(phi) * Math.sin(theta), z: radius * Math.cos(phi), r: 1.0, g: 0.8, b: 0.4 };
    }
    if (i < count * 0.5) {
      const t = (i / count) * Math.PI * 10;
      const radius = 16 + Math.sin(t * 2.2) * 2 + (a - 0.5) * 1.8;
      return { x: radius * Math.cos(t), y: radius * Math.sin(t), z: (b - 0.5) * 4.4, r: 1.0, g: 0.35, b: 0.16 };
    }
    const radius = 25 + c * 40;
    return { x: radius * Math.sin(phi) * Math.cos(theta), y: radius * Math.sin(phi) * Math.sin(theta), z: radius * Math.cos(phi), r: 0.95, g: 0.5, b: 0.2 };
  }

  if (technique === 'lotus') {
    const petals = 9;
    const t = (i / count) * Math.PI * 2 * petals;
    const petalFactor = Math.sin(t * 0.5);
    const radius = 8 + 6 * Math.abs(petalFactor) + (a - 0.5) * 2.4;
    return {
      x: radius * Math.cos(t) * 0.9,
      y: petalFactor * 8 + Math.sin(t * 0.3) * 2 + (b - 0.5) * 1.2,
      z: radius * Math.sin(t) * 0.9,
      r: 0.95,
      g: 0.45 + Math.abs(petalFactor) * 0.2,
      b: 0.78
    };
  }

  if (i < count * 0.25) {
    const radius = c * 12;
    return { x: radius * Math.sin(phi) * Math.cos(theta), y: 8 + radius * Math.sin(phi) * Math.sin(theta), z: radius * Math.cos(phi), r: 0.55, g: 0.88, b: 1.0 };
  }
  if (i < count * 0.7) {
    const angle = (i / count) * Math.PI * 30;
    const radius = 10 + Math.sin(angle * 0.7) * 4;
    return { x: radius * Math.cos(angle), y: (b - 0.5) * 40, z: radius * Math.sin(angle), r: 0.5, g: 0.7, b: 1.0 };
  }
  return { x: (a - 0.5) * 8, y: (b - 0.5) * 60, z: (c - 0.5) * 8, r: 0.95, g: 0.98, b: 1.0 };
};

export const getShapeParticle = (
  shape: ShapePreset,
  i: number,
  count: number,
  scale: number,
  a: number,
  b: number,
  c: number
): ParticlePoint => {
  const theta = a * Math.PI * 2;
  const phi = Math.acos(2 * b - 1);
  const s = scale * 20;

  if (shape === 'sphere') {
    const radius = s * Math.cbrt(c);
    return { x: radius * Math.sin(phi) * Math.cos(theta), y: radius * Math.sin(phi) * Math.sin(theta), z: radius * Math.cos(phi), r: 0.2, g: 0.82, b: 1.0 };
  }
  if (shape === 'cube') return { x: (a - 0.5) * s * 2, y: (b - 0.5) * s * 2, z: (c - 0.5) * s * 2, r: 0.85, g: 0.9, b: 1.0 };
  if (shape === 'torus') {
    const R = s * 0.65;
    const r = s * 0.25 * Math.sqrt(c);
    const v = b * Math.PI * 2;
    return { x: (R + r * Math.cos(v)) * Math.cos(theta), y: (R + r * Math.cos(v)) * Math.sin(theta), z: r * Math.sin(v), r: 0.6, g: 0.84, b: 1.0 };
  }
  if (shape === 'heart') {
    const t = theta;
    const x = 16 * Math.pow(Math.sin(t), 3);
    const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
    return { x: (x * 0.55 + (c - 0.5) * 3) * scale, y: (y * 0.55) * scale, z: (b - 0.5) * 7 * scale, r: 1.0, g: 0.45, b: 0.65 };
  }
  if (shape === 'dna') {
    const strand = a > 0.5 ? Math.PI : 0;
    const t = (b - 0.5) * 18;
    const radius = 6.8 * scale;
    return { x: Math.cos(t * 0.85 + strand) * radius + (c - 0.5) * 1.2, y: t, z: Math.sin(t * 0.85 + strand) * radius + (c - 0.5) * 1.2, r: 0.78, g: 0.62, b: 1.0 };
  }
  if (shape === 'galaxy') {
    const arms = 4;
    const arm = Math.floor(a * arms);
    const armOffset = (arm / arms) * Math.PI * 2;
    const radius = Math.pow(c, 1.7) * 28 * scale;
    const angle = radius * 0.42 + armOffset + (b - 0.5) * 0.7;
    return { x: Math.cos(angle) * radius, y: (b - 0.5) * (1 + radius * 0.06) * 4, z: Math.sin(angle) * radius, r: 0.5, g: 0.75, b: 1.0 };
  }
  if (shape === 'spiral') {
    const t = (i / count) * Math.PI * 42;
    const radius = (2 + 0.17 * t) * scale;
    return { x: Math.cos(t) * radius, y: (b - 0.5) * 8 * scale, z: Math.sin(t) * radius, r: 0.9, g: 0.8, b: 0.42 };
  }
  if (shape === 'crystal') {
    const face = Math.floor(a * 8);
    const u = b * 2 - 1;
    const v = c * 2 - 1;
    const size = 10 * scale;
    const sign = face < 4 ? 1 : -1;
    const axis = face % 4;
    if (axis === 0) return { x: sign * size, y: u * size * 0.5, z: v * size * 0.5, r: 0.75, g: 0.9, b: 1.0 };
    if (axis === 1) return { x: u * size * 0.5, y: sign * size, z: v * size * 0.5, r: 0.75, g: 0.9, b: 1.0 };
    if (axis === 2) return { x: u * size * 0.5, y: v * size * 0.5, z: sign * size, r: 0.75, g: 0.9, b: 1.0 };
    return { x: u * size * 0.7, y: sign * Math.sqrt(Math.max(0, 1 - u * u - v * v)) * size, z: v * size * 0.7, r: 0.75, g: 0.9, b: 1.0 };
  }
  if (shape === 'flower') {
    const petals = 8;
    const t = theta * petals;
    const radius = (7 + 3.5 * Math.sin(t)) * scale;
    return { x: radius * Math.cos(theta), y: (4 * Math.sin(t) + (c - 0.5) * 2) * scale, z: radius * Math.sin(theta), r: 0.98, g: 0.62, b: 0.84 };
  }
  const waveX = (a - 0.5) * s * 2.4;
  const waveZ = (b - 0.5) * s * 2.4;
  const waveY = Math.sin(waveX * 0.25) * Math.cos(waveZ * 0.25) * s * 0.36 + (c - 0.5) * 1.4;
  return { x: waveX, y: waveY, z: waveZ, r: 0.6, g: 0.86, b: 0.98 };
};

export const mapPinchToZoom = (pinch: number, zoomSensitivity: number): number => {
  const base = ((pinch - 0.02) / (0.24 - 0.02)) * (68 - 24) + 24;
  return clamp(base / Math.max(0.3, zoomSensitivity), 18, 90);
};
