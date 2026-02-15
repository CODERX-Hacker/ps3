export interface HandLandmark {
  x: number;
  y: number;
  z: number;
}

export interface HandData {
  isActive: boolean;
  landmarks: HandLandmark[];
  position: {
    x: number;
    y: number;
    z: number;
  };
  pinchStrength: number;
  isRotationGesture: boolean;
  isZoomGesture: boolean;
}

export enum ShapeType {
  SPHERE = 'SPHERE',
  CUBE = 'CUBE',
  TORUS = 'TORUS',
  HEART = 'HEART',
  DNA = 'DNA',
  GALAXY = 'GALAXY',
  TEXT = 'TEXT'
}

export enum ColorMode {
  MONO = 'MONO',
  HEAT = 'HEAT',
  SPECTRUM = 'SPECTRUM',
  CYBER = 'CYBER',
  PINK = 'PINK',
  RAINBOW = 'RAINBOW',
  FIRE = 'FIRE',
  OCEAN = 'OCEAN'
}
