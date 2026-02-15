import React, { useEffect, useRef, useState } from 'react';
import { VisionService } from '../services/visionService';
import { HandData } from '../types';

interface WebcamHandlerProps {
  onHandUpdate: (data: HandData) => void;
  onShapeChangeTrigger?: () => void;
  isMirrored: boolean;
  showPreview?: boolean;
}

const WebcamHandler: React.FC<WebcamHandlerProps> = ({
  onHandUpdate,
  onShapeChangeTrigger,
  isMirrored,
  showPreview = true
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const requestRef = useRef<number | null>(null);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const visionService = useRef(VisionService.getInstance());

  const smoothPos = useRef({ x: 0.5, y: 0.5, z: 0 });
  const smoothPinch = useRef(0);

  const isZoomingRef = useRef(false);
  const isRotatingRef = useRef(false);

  const lastShapeSwitchTime = useRef(0);

  const SMOOTHING = 0.2;

  useEffect(() => {
    const startCamera = async () => {
      try {
        await visionService.current.initialize();

        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: 320,
            height: 240,
            frameRate: { ideal: 30 }
          }
        });

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.onloadeddata = () => {
            setIsCameraActive(true);
            videoRef.current?.play();
          };
        }
      } catch (err) {
        console.error('Camera access denied or failed:', err);
      }
    };

    startCamera();

    return () => {
      if (videoRef.current && videoRef.current.srcObject) {
        const tracks = (videoRef.current.srcObject as MediaStream).getTracks();
        tracks.forEach((t) => t.stop());
      }
    };
  }, []);

  useEffect(() => {
    if (!isCameraActive) return;

    const detectLoop = () => {
      if (videoRef.current) {
        const result = visionService.current.detect(videoRef.current);

        if (result && result.landmarks && result.landmarks.length > 0) {
          const hand = result.landmarks[0];

          const wrist = hand[0];
          const thumbTip = hand[4];
          const indexTip = hand[8];
          const midMCP = hand[9];
          const middleTip = hand[12];
          const ringTip = hand[16];
          const pinkyTip = hand[20];

          const handSize =
            Math.sqrt(Math.pow(wrist.x - midMCP.x, 2) + Math.pow(wrist.y - midMCP.y, 2)) || 0.1;

          const pinchDist = Math.sqrt(
            Math.pow(indexTip.x - thumbTip.x, 2) + Math.pow(indexTip.y - thumbTip.y, 2)
          );
          const normalizedPinch = pinchDist / handSize;
          let rawStrength = 1 - (normalizedPinch - 0.2) / 0.8;
          rawStrength = Math.max(0, Math.min(1, rawStrength));

          const zoomDist = Math.sqrt(
            Math.pow(middleTip.x - thumbTip.x, 2) + Math.pow(middleTip.y - thumbTip.y, 2)
          );
          const zoomRatio = zoomDist / handSize;

          if (isZoomingRef.current) {
            if (zoomRatio > 0.7) isZoomingRef.current = false;
          } else if (zoomRatio < 0.45) {
            isZoomingRef.current = true;
          }

          const rotationDist = Math.sqrt(
            Math.pow(pinkyTip.x - thumbTip.x, 2) + Math.pow(pinkyTip.y - thumbTip.y, 2)
          );
          const rotationRatio = rotationDist / handSize;

          if (isRotatingRef.current) {
            if (rotationRatio > 0.7) isRotatingRef.current = false;
          } else if (rotationRatio < 0.45) {
            isRotatingRef.current = true;
          }

          if (onShapeChangeTrigger) {
            const shapeDist = Math.sqrt(
              Math.pow(ringTip.x - thumbTip.x, 2) + Math.pow(ringTip.y - thumbTip.y, 2)
            );
            if (shapeDist / handSize < 0.45) {
              const now = Date.now();
              if (now - lastShapeSwitchTime.current > 1500) {
                onShapeChangeTrigger();
                lastShapeSwitchTime.current = now;
              }
            }
          }

          const rawX = (wrist.x + midMCP.x) / 2;
          const rawY = (wrist.y + midMCP.y) / 2;
          const rawZ = midMCP.z;

          smoothPos.current.x += (rawX - smoothPos.current.x) * SMOOTHING;
          smoothPos.current.y += (rawY - smoothPos.current.y) * SMOOTHING;
          smoothPos.current.z += (rawZ - smoothPos.current.z) * SMOOTHING;
          smoothPinch.current += (rawStrength - smoothPinch.current) * (SMOOTHING * 0.5);

          onHandUpdate({
            isActive: true,
            landmarks: hand,
            position: {
              x: smoothPos.current.x,
              y: smoothPos.current.y,
              z: smoothPos.current.z
            },
            pinchStrength: smoothPinch.current,
            isRotationGesture: isRotatingRef.current,
            isZoomGesture: isZoomingRef.current
          });
        } else {
          isZoomingRef.current = false;
          isRotatingRef.current = false;

          onHandUpdate({
            isActive: false,
            landmarks: [],
            position: { x: 0.5, y: 0.5, z: 0 },
            pinchStrength: 0,
            isRotationGesture: false,
            isZoomGesture: false
          });
        }
      }
      requestRef.current = requestAnimationFrame(detectLoop);
    };

    requestRef.current = requestAnimationFrame(detectLoop);

    return () => {
      if (requestRef.current !== null) {
        cancelAnimationFrame(requestRef.current);
      }
    };
  }, [isCameraActive, onHandUpdate, onShapeChangeTrigger]);

  return (
    <div className={`webcam-panel ${showPreview ? 'webcam-panel--visible' : 'webcam-panel--hidden'}`}>
      <video
        ref={videoRef}
        className={`webcam-video ${isMirrored ? 'webcam-video--mirrored' : ''}`}
        playsInline
        muted
      />
      {!isCameraActive && showPreview ? <div className="webcam-overlay">Starting...</div> : null}
      {showPreview ? (
        <div className="webcam-footer">{isCameraActive ? 'Tracking Active' : 'Initializing Camera'}</div>
      ) : null}
    </div>
  );
};

export default WebcamHandler;
