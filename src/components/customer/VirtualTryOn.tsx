import { useEffect, useRef, useState } from "react";
import { Camera, CameraOff, Move, ShieldCheck, X, ZoomIn, ZoomOut, RotateCcw } from "lucide-react";
import { FilesetResolver, PoseLandmarker } from "@mediapipe/tasks-vision";

interface TryOnProps {
  garmentUrl: string;
  productName: string;
  /** Pass the product's actual category (e.g. "Tops", "Skirts", "Pants", "Dresses"). */
  category?: string;
  onClose: () => void;
}

interface GarmentBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

const garmentBoundsCache = new WeakMap<HTMLImageElement, GarmentBounds>();

/**
 * Find the visible, non-transparent part of a garment PNG. The supplied DIANE
 * overlays use a 1414 x 2000 canvas with large transparent margins, so fitting
 * the entire canvas makes the clothing itself look much too small.
 */
function getVisibleGarmentBounds(garment: HTMLImageElement): GarmentBounds {
  const cached = garmentBoundsCache.get(garment);
  if (cached) return cached;

  const imageWidth = garment.naturalWidth;
  const imageHeight = garment.naturalHeight;
  const fullImage = { x: 0, y: 0, width: imageWidth, height: imageHeight };
  if (!imageWidth || !imageHeight) return fullImage;

  const scanCanvas = document.createElement("canvas");
  scanCanvas.width = imageWidth;
  scanCanvas.height = imageHeight;
  const scanContext = scanCanvas.getContext("2d", { willReadFrequently: true });
  if (!scanContext) {
    garmentBoundsCache.set(garment, fullImage);
    return fullImage;
  }

  try {
    scanContext.drawImage(garment, 0, 0);
    const pixels = scanContext.getImageData(0, 0, imageWidth, imageHeight).data;
    let minX = imageWidth;
    let minY = imageHeight;
    let maxX = -1;
    let maxY = -1;
    const alphaThreshold = 8;

    for (let y = 0; y < imageHeight; y += 1) {
      for (let x = 0; x < imageWidth; x += 1) {
        const alpha = pixels[(y * imageWidth + x) * 4 + 3];
        if (alpha > alphaThreshold) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }

    if (maxX < minX || maxY < minY) {
      garmentBoundsCache.set(garment, fullImage);
      return fullImage;
    }

    // Keep a small transparent safety margin so soft garment edges are not clipped.
    const paddingX = Math.round((maxX - minX + 1) * 0.025);
    const paddingY = Math.round((maxY - minY + 1) * 0.025);
    const left = Math.max(0, minX - paddingX);
    const top = Math.max(0, minY - paddingY);
    const right = Math.min(imageWidth, maxX + 1 + paddingX);
    const bottom = Math.min(imageHeight, maxY + 1 + paddingY);
    const bounds = { x: left, y: top, width: right - left, height: bottom - top };
    garmentBoundsCache.set(garment, bounds);
    return bounds;
  } catch {
    // If the remote image does not permit pixel inspection, retain the original
    // image as a safe fallback rather than stopping the live try-on camera.
    garmentBoundsCache.set(garment, fullImage);
    return fullImage;
  } finally {
    scanCanvas.width = 0;
    scanCanvas.height = 0;
  }
}

/** Draw only the visible garment pixels inside a body-aligned box, preserving proportions. */
function drawGarmentFit(
  context: CanvasRenderingContext2D,
  garment: HTMLImageElement,
  x: number,
  y: number,
  maxWidth: number,
  maxHeight: number,
  widthScale = 1,
  verticalAlign: "top" | "center" = "center",
) {
  if (!garment.naturalWidth || !garment.naturalHeight) return;

  const bounds = getVisibleGarmentBounds(garment);
  const scale = Math.min(maxWidth / bounds.width, maxHeight / bounds.height);
  const drawWidth = bounds.width * scale * widthScale;
  const drawHeight = bounds.height * scale;
  const drawX = x + (maxWidth - drawWidth) / 2;
  const drawY = verticalAlign === "top" ? y : y + (maxHeight - drawHeight) / 2;

  context.drawImage(
    garment,
    bounds.x,
    bounds.y,
    bounds.width,
    bounds.height,
    drawX,
    drawY,
    drawWidth,
    drawHeight,
  );
}

/**
 * Estimate the visible body silhouette width at a normalized vertical position.
 * This is a relative pixel estimate, not a centimeter measurement. We measure
 * the connected foreground around the torso center to avoid including the room.
 */
function getSilhouetteWidthAtY(
  maskCanvas: HTMLCanvasElement | null,
  normalizedY: number,
  normalizedCenterX: number,
): number | null {
  if (!maskCanvas || !maskCanvas.width || !maskCanvas.height) return null;

  const y = Math.max(0, Math.min(maskCanvas.height - 1, Math.round(normalizedY * (maskCanvas.height - 1))));
  const centerX = Math.max(0, Math.min(maskCanvas.width - 1, Math.round(normalizedCenterX * (maskCanvas.width - 1))));
  const context = maskCanvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;

  try {
    const row = context.getImageData(0, y, maskCanvas.width, 1).data;
    const isPerson = (x: number) => row[x * 4 + 3] > 72;
    const searchRadius = Math.max(8, Math.round(maskCanvas.width * 0.18));
    let seed = -1;
    for (let offset = 0; offset <= searchRadius; offset += 1) {
      const left = centerX - offset;
      const right = centerX + offset;
      if (left >= 0 && isPerson(left)) { seed = left; break; }
      if (right < maskCanvas.width && isPerson(right)) { seed = right; break; }
    }
    if (seed < 0) return null;

    let left = seed;
    let right = seed;
    while (left > 0 && isPerson(left - 1)) left -= 1;
    while (right < maskCanvas.width - 1 && isPerson(right + 1)) right += 1;
    const widthFraction = (right - left + 1) / maskCanvas.width;
    return widthFraction > 0.025 && widthFraction < 0.9 ? widthFraction : null;
  } catch {
    return null;
  }
}

const setOfSecureCameraErrors: Record<string, string> = {
  NotAllowedError: "Camera permission was denied. Allow camera access in your browser settings and try again.",
  NotFoundError: "No usable webcam was found. Connect or enable a camera and allow camera access for this browser.",
  NotReadableError: "The camera is already in use by another application. Close the Camera app or any video-call app, then try again.",
  OverconstrainedError: "The webcam rejected both camera requests. Check Windows camera privacy settings and close any app using the camera.",
  SecurityError: "Camera access is blocked by browser security. Open DIANE using HTTPS or localhost.",
};

/**
 * Prefer the user-facing camera on phones, but don't require it or a portrait
 * resolution. Many laptop webcams do not expose a facingMode or 720x1280 mode.
 * If the preferred request is rejected, retry with the browser's default webcam.
 */
async function getCompatibleCameraStream(onFallback: () => void): Promise<MediaStream> {
  try {
    return await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "user" } },
      audio: false,
    });
  } catch (preferredError) {
    const errorName =
      preferredError instanceof Error && "name" in preferredError
        ? String(preferredError.name)
        : "";
    const canRetryWithDefaultCamera = [
      "OverconstrainedError",
      "ConstraintNotSatisfiedError",
      "NotFoundError",
    ].includes(errorName);

    if (!canRetryWithDefaultCamera) throw preferredError;

    onFallback();
    return navigator.mediaDevices.getUserMedia({ video: true, audio: false });
  }
}

export function VirtualTryOn({ garmentUrl, productName, category = "", onClose }: TryOnProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const landmarkerRef = useRef<PoseLandmarker | null>(null);
  const frameRef = useRef<number | null>(null);
  const garmentRef = useRef<HTMLImageElement | null>(null);
  // Smooth small frame-to-frame landmark changes so garments do not jitter.
  const smoothedLandmarksRef = useRef<Array<{ x: number; y: number; visibility?: number }> | null>(null);
  const segmentationCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const personLayerCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const armMaskCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const segmentationUpdatedAtRef = useRef(0);
  const startInProgressRef = useRef(false);
  const isMountedRef = useRef(false);
  const statusRef = useRef("Camera is off. Start when you are ready.");
  const [running, setRunning] = useState(false);
  const [starting, setStarting] = useState(false);
  const [status, setStatus] = useState(statusRef.current);
  const [cameraZoom, setCameraZoom] = useState(1);
  const [hardwareZoomRange, setHardwareZoomRange] = useState<{ min: number; max: number } | null>(null);
  const [hardwareZoomActive, setHardwareZoomActive] = useState(false);

  const updateStatus = (message: string) => {
    if (statusRef.current !== message) {
      statusRef.current = message;
      setStatus(message);
    }
  };

  const stopCamera = (updateUi = true) => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    const video = videoRef.current;
    if (video) {
      video.pause();
      video.srcObject = null;
    }
    landmarkerRef.current?.close();
    landmarkerRef.current = null;
    smoothedLandmarksRef.current = null;
    segmentationUpdatedAtRef.current = 0;
    [segmentationCanvasRef, personLayerCanvasRef, armMaskCanvasRef].forEach((canvasRef) => {
      const offscreen = canvasRef.current;
      if (offscreen) {
        const offscreenContext = offscreen.getContext("2d");
        offscreenContext?.clearRect(0, 0, offscreen.width, offscreen.height);
      }
    });
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (context && canvas) context.clearRect(0, 0, canvas.width, canvas.height);
    startInProgressRef.current = false;
    if (updateUi && isMountedRef.current) {
      setRunning(false);
      setStarting(false);
      updateStatus("Camera is off.");
    }
  };

  useEffect(() => {
    const garment = new Image();
    // Supabase Storage images are cross-origin; anonymous CORS lets the canvas
    // inspect PNG transparency so empty margins can be excluded during fitting.
    garment.crossOrigin = "anonymous";
    garment.decoding = "async";
    garmentRef.current = garment;
    garment.src = garmentUrl;
  }, [garmentUrl]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      // Release camera and MediaPipe resources, including late setup completions.
      isMountedRef.current = false;
      stopCamera(false);
      garmentRef.current = null;
    };
    // Camera resources are owned by this modal instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyCameraZoom = async (nextZoom: number) => {
    const track = streamRef.current?.getVideoTracks()[0];
    let minimumZoom = 1;
    let hardwareCapabilities: (MediaTrackCapabilities & { zoom?: { min: number; max: number; step?: number } }) | null = null;

    if (track) {
      try {
        hardwareCapabilities = track.getCapabilities() as MediaTrackCapabilities & {
          zoom?: { min: number; max: number; step?: number };
        };
        if (hardwareCapabilities.zoom) {
          minimumZoom = Math.max(0.5, hardwareCapabilities.zoom.min);
          setHardwareZoomRange({
            min: hardwareCapabilities.zoom.min,
            max: hardwareCapabilities.zoom.max,
          });
        } else {
          setHardwareZoomRange(null);
        }
      } catch {
        hardwareCapabilities = null;
        setHardwareZoomRange(null);
      }
    } else if (hardwareZoomRange) {
      minimumZoom = Math.max(0.5, hardwareZoomRange.min);
    }

    // A browser-only fallback cannot create a wider field of view. Never
    // scale the entire video element below 1x, because that makes the camera
    // image shrink into a small rectangle. Sub-1x is allowed only when the
    // actual device camera exposes a hardware zoom range that supports it.
    const bounded = Math.min(1.5, Math.max(minimumZoom, Number(nextZoom.toFixed(1))));
    setCameraZoom(bounded);

    if (!track) {
      setHardwareZoomActive(false);
      return;
    }

    try {
      const zoom = hardwareCapabilities?.zoom;
      if (zoom && bounded >= zoom.min && bounded <= zoom.max) {
        await track.applyConstraints({
          advanced: [{ zoom: bounded } as MediaTrackConstraintSet],
        });
        setHardwareZoomActive(true);
      } else {
        if (zoom) {
          const neutralZoom = Math.min(zoom.max, Math.max(zoom.min, 1));
          await track.applyConstraints({
            advanced: [{ zoom: neutralZoom } as MediaTrackConstraintSet],
          });
        }
        setHardwareZoomActive(false);
      }
    } catch {
      // Visual zoom-in remains available when hardware zoom is unsupported.
      setHardwareZoomActive(false);
    }
  };

  const renderFrame = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const landmarker = landmarkerRef.current;
    const stream = streamRef.current;
    if (!video || !canvas || !landmarker || !stream || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      frameRef.current = requestAnimationFrame(renderFrame);
      return;
    }

    if (canvas.width !== video.videoWidth) canvas.width = video.videoWidth;
    if (canvas.height !== video.videoHeight) canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    if (!context) {
      updateStatus("The try-on canvas is unavailable in this browser.");
      stopCamera();
      return;
    }

    context.clearRect(0, 0, canvas.width, canvas.height);
    try {
      const frameTime = performance.now();
      const result = landmarker.detectForVideo(video, frameTime);

      // Update the person segmentation mask at a moderate rate to reduce the
      // GPU-to-CPU transfer cost, while reusing the latest mask between updates.
      const segmentationMask = result.segmentationMasks?.[0];
      if (segmentationMask && frameTime - segmentationUpdatedAtRef.current >= 100) {
        const maskCanvas = segmentationCanvasRef.current ?? document.createElement("canvas");
        segmentationCanvasRef.current = maskCanvas;
        if (maskCanvas.width !== segmentationMask.width) maskCanvas.width = segmentationMask.width;
        if (maskCanvas.height !== segmentationMask.height) maskCanvas.height = segmentationMask.height;
        const maskContext = maskCanvas.getContext("2d", { willReadFrequently: true });
        if (maskContext) {
          const maskValues = segmentationMask.getAsFloat32Array();
          const maskImage = maskContext.createImageData(maskCanvas.width, maskCanvas.height);
          for (let index = 0; index < maskValues.length; index += 1) {
            const pixelIndex = index * 4;
            maskImage.data[pixelIndex] = 255;
            maskImage.data[pixelIndex + 1] = 255;
            maskImage.data[pixelIndex + 2] = 255;
            maskImage.data[pixelIndex + 3] = Math.round(Math.max(0, Math.min(1, maskValues[index])) * 255);
          }
          maskContext.putImageData(maskImage, 0, 0);
          segmentationUpdatedAtRef.current = frameTime;
        }
      } else if (!segmentationMask && segmentationCanvasRef.current) {
        // Never reuse a stale person mask if this frame did not produce one.
        const staleMaskContext = segmentationCanvasRef.current.getContext("2d");
        staleMaskContext?.clearRect(
          0,
          0,
          segmentationCanvasRef.current.width,
          segmentationCanvasRef.current.height,
        );
        segmentationUpdatedAtRef.current = 0;
      }

      const rawPose = result.landmarks[0];
      const previousPose = smoothedLandmarksRef.current;
      const smoothing = 0.42;
      const pose = rawPose?.map((point, index) => {
        const previous = previousPose?.[index];
        return {
          ...point,
          x: previous ? previous.x + (point.x - previous.x) * smoothing : point.x,
          y: previous ? previous.y + (point.y - previous.y) * smoothing : point.y,
        };
      });
      smoothedLandmarksRef.current = pose
        ? pose.map(({ x, y, visibility }) => ({ x, y, visibility }))
        : null;
      const garment = garmentRef.current;
      if (!pose || !garment?.complete || garment.naturalWidth === 0) {
        updateStatus(!garment?.complete ? "Loading the selected garment overlay…" : "Step back until your shoulders and hips are visible.");
      } else {
        // MediaPipe pose landmark indexes: shoulders 11/12, hips 23/24,
        // knees 25/26, ankles 27/28. Tops and bottoms use different anchors.
        const leftShoulder = pose[11];
        const rightShoulder = pose[12];
        const leftHip = pose[23];
        const rightHip = pose[24];
        const leftKnee = pose[25];
        const rightKnee = pose[26];
        const leftAnkle = pose[27];
        const rightAnkle = pose[28];
        const requiredPoints = [leftShoulder, rightShoulder, leftHip, rightHip];
        const visible = requiredPoints.every((point) => (point.visibility ?? 1) >= 0.35);

        if (!visible) {
          updateStatus("Step back until your shoulders and hips are visible.");
        } else {
          const normalizedCategory = `${category} ${productName}`.toLowerCase();
          const isDress = /\b(dress|dresses|gown|gowns|jumpsuit|romper)\b/.test(normalizedCategory);
          const isSkirt = /\b(skirt|skirts)\b/.test(normalizedCategory);
          const isShorts = /\b(shorts|short)\b/.test(normalizedCategory);
          const isPants = /\b(pants|trousers|jeans|leggings|joggers)\b/.test(normalizedCategory);
          const isGenericBottom = /\b(bottom|bottoms)\b/.test(normalizedCategory);
          const isBottom = isSkirt || isShorts || isPants || isGenericBottom;

          const pointVisible = (point: (typeof pose)[number] | undefined) =>
            Boolean(point && (point.visibility ?? 1) >= 0.35);
          const midpointX = (a: (typeof pose)[number], b: (typeof pose)[number]) =>
            ((a.x + b.x) / 2) * canvas.width;
          const midpointY = (a: (typeof pose)[number], b: (typeof pose)[number]) =>
            ((a.y + b.y) / 2) * canvas.height;
          const distance = (a: (typeof pose)[number], b: (typeof pose)[number]) =>
            Math.hypot((a.x - b.x) * canvas.width, (a.y - b.y) * canvas.height);

          const centerX = midpointX(leftShoulder, rightShoulder);
          const shoulderY = midpointY(leftShoulder, rightShoulder);
          const hipX = midpointX(leftHip, rightHip);
          const hipY = midpointY(leftHip, rightHip);
          const torsoLength = Math.max(1, hipY - shoulderY);
          const shoulderWidth = distance(leftShoulder, rightShoulder) * 1.85;
          const landmarkHipWidth = distance(leftHip, rightHip) * 2.15;
          const torsoCenterX = centerX * 0.65 + hipX * 0.35;
          const bustY = shoulderY + torsoLength * 0.24;
          const waistY = shoulderY + torsoLength * 0.76;
          const segmentationForFit = segmentationCanvasRef.current;
          // The size-chart reference guides relative bust/waist/hip fitting.
          // Webcam pixels cannot identify exact centimeters or a reliable S-XXXL
          // label without a known-distance calibration, so use silhouette ratios.
          const bustSilhouette = getSilhouetteWidthAtY(
            segmentationForFit, bustY / canvas.height, torsoCenterX / canvas.width,
          );
          const waistSilhouette = getSilhouetteWidthAtY(
            segmentationForFit, waistY / canvas.height, torsoCenterX / canvas.width,
          );
          const hipSilhouette = getSilhouetteWidthAtY(
            segmentationForFit, hipY / canvas.height, hipX / canvas.width,
          );
          const bustWidth = bustSilhouette ? bustSilhouette * canvas.width * 1.08 : shoulderWidth * 0.96;
          const waistWidth = waistSilhouette ? waistSilhouette * canvas.width * 1.1 : landmarkHipWidth * 0.9;
          const hipWidth = Math.max(
            landmarkHipWidth,
            hipSilhouette ? hipSilhouette * canvas.width * 1.1 : 0,
          );
          // Relative silhouette ratios gently adapt the overlay without assigning
          // an unsupported clothing size from an uncalibrated webcam.
          const bodyShapeRatio = Math.min(1.3, Math.max(0.75, hipWidth / Math.max(1, bustWidth)));
          const topFitScale = Math.min(1.2, Math.max(1.02, 1.07 + (bodyShapeRatio - 1) * 0.3));
          const dressFitScale = Math.min(1.22, Math.max(1.04, 1.1 + (bodyShapeRatio - 1) * 0.28));
          const kneesVisible = pointVisible(leftKnee) && pointVisible(rightKnee);
          const anklesVisible = pointVisible(leftAnkle) && pointVisible(rightAnkle);
          const kneeY = kneesVisible ? midpointY(leftKnee, rightKnee) : hipY + hipWidth * 0.85;
          const ankleY = anklesVisible ? midpointY(leftAnkle, rightAnkle) : kneeY + hipWidth * 0.9;

          context.save();
          context.globalAlpha = 0.96;

          if (isBottom) {
            // Pants, skirts and shorts share a waist anchor. Hip/waist silhouette
            // estimates adapt width to the live body; category controls garment length.
            const waistY = hipY - hipWidth * 0.12;
            const bottomHeight = isPants
              ? Math.max(ankleY - waistY, hipWidth * 1.55)
              : isShorts
                ? Math.max((kneeY - waistY) * 0.58, hipWidth * 0.68)
                : Math.max((kneeY - waistY) * 0.92, hipWidth * 1.02);
            const bottomWidth = isPants
              ? Math.max(hipWidth * 1.04, waistWidth * 1.08, shoulderWidth * 0.7)
              : Math.max(hipWidth * (isShorts ? 1.06 : 1.08), waistWidth * 1.08, shoulderWidth * 0.76);
            const bottomWidthScale = isPants ? 1.02 : isShorts ? 1.04 : 1.05;

            drawGarmentFit(
              context,
              garment,
              hipX - bottomWidth / 2,
              waistY,
              bottomWidth,
              bottomHeight,
              bottomWidthScale,
              "top",
            );
            updateStatus(isPants
              ? "Tracking your waist and legs."
              : isShorts
                ? "Tracking your waist and upper legs."
                : "Tracking your waist and hips.");
          } else if (isDress) {
            // One-piece garments align at the shoulders and extend toward the
            // knees when visible, otherwise use a torso-based lower-body estimate.
            const dressBottomY = kneesVisible ? kneeY : hipY + torsoLength * 1.35;
            const dressY = shoulderY - torsoLength * 0.06;
            const dressHeight = Math.max(dressBottomY - dressY, torsoLength * 1.55);
            const dressWidth = Math.max(shoulderWidth * 1.06, bustWidth * 1.08, waistWidth * 1.12, hipWidth * 1.12);

            drawGarmentFit(
              context,
              garment,
              torsoCenterX - dressWidth / 2,
              dressY,
              dressWidth,
              dressHeight,
              dressFitScale,
              "top",
            );
            updateStatus("Tracking your shoulders, waist, and lower body.");
          } else {
            // Tops use the live bust and waist silhouette estimates, with shoulder
            // landmarks as a fallback when segmentation is unavailable.
            const topY = shoulderY - torsoLength * 0.06;
            const topHeight = Math.max(torsoLength * 1.18, shoulderWidth * 0.9);
            const topWidth = Math.max(shoulderWidth * 1.04, bustWidth * 1.1, waistWidth * 1.02);

            drawGarmentFit(
              context,
              garment,
              torsoCenterX - topWidth / 2,
              topY,
              topWidth,
              topHeight,
              topFitScale,
              "top",
            );
            updateStatus("Tracking your shoulders and upper body.");
          }

          // Draw the user's real arms back over the garment. Pose landmarks
          // define a narrow arm corridor; the segmentation mask removes the
          // surrounding background so only the person is composited in front.
          const segmentationCanvas = segmentationCanvasRef.current;
          const leftElbow = pose[13];
          const rightElbow = pose[14];
          const leftWrist = pose[15];
          const rightWrist = pose[16];
          const hasArmLandmarks =
            (pointVisible(leftElbow) || pointVisible(leftWrist)) ||
            (pointVisible(rightElbow) || pointVisible(rightWrist));

          if (segmentationCanvas && hasArmLandmarks) {
            const armMaskCanvas = armMaskCanvasRef.current ?? document.createElement("canvas");
            const personLayerCanvas = personLayerCanvasRef.current ?? document.createElement("canvas");
            armMaskCanvasRef.current = armMaskCanvas;
            personLayerCanvasRef.current = personLayerCanvas;

            [armMaskCanvas, personLayerCanvas].forEach((offscreen) => {
              if (offscreen.width !== canvas.width) offscreen.width = canvas.width;
              if (offscreen.height !== canvas.height) offscreen.height = canvas.height;
            });

            const armMaskContext = armMaskCanvas.getContext("2d");
            const personLayerContext = personLayerCanvas.getContext("2d");

            if (armMaskContext && personLayerContext) {
              armMaskContext.clearRect(0, 0, canvas.width, canvas.height);
              armMaskContext.strokeStyle = "rgba(255, 255, 255, 1)";
              armMaskContext.lineCap = "round";
              armMaskContext.lineJoin = "round";
              armMaskContext.lineWidth = Math.max(18, shoulderWidth * 0.17);

              type PosePoint = NonNullable<(typeof pose)[number]>;
              const drawArmCorridor = (
                shoulder: PosePoint,
                elbow: PosePoint | undefined,
                wrist: PosePoint | undefined,
              ) => {
                // Tell TypeScript that the filter removes undefined landmarks.
                const points: PosePoint[] = [shoulder, elbow, wrist].filter(
                  (point): point is PosePoint => pointVisible(point),
                );
                const firstPoint = points[0];
                if (points.length < 2 || !firstPoint) return;

                armMaskContext.beginPath();
                armMaskContext.moveTo(
                  firstPoint.x * canvas.width,
                  firstPoint.y * canvas.height,
                );
                points.slice(1).forEach((point) => {
                  armMaskContext.lineTo(point.x * canvas.width, point.y * canvas.height);
                });
                armMaskContext.stroke();
              };

              drawArmCorridor(leftShoulder, leftElbow, leftWrist);
              drawArmCorridor(rightShoulder, rightElbow, rightWrist);

              personLayerContext.clearRect(0, 0, canvas.width, canvas.height);
              personLayerContext.globalCompositeOperation = "source-over";
              personLayerContext.drawImage(video, 0, 0, canvas.width, canvas.height);
              // Intersect the person segmentation with the arm corridor.
              // Keep destination-in active for BOTH masks so the user's actual
              // arm pixels are composited, not the white corridor drawing itself.
              personLayerContext.globalCompositeOperation = "destination-in";
              personLayerContext.drawImage(segmentationCanvas, 0, 0, canvas.width, canvas.height);
              personLayerContext.drawImage(armMaskCanvas, 0, 0);
              personLayerContext.globalCompositeOperation = "source-over";

              context.globalAlpha = 1;
              context.drawImage(personLayerCanvas, 0, 0, canvas.width, canvas.height);
              context.globalAlpha = 0.96;
            }
          }

          context.restore();
        }
      }
      result.close();
    } catch {
      updateStatus("Pose tracking stopped unexpectedly. Stop the camera and try again.");
      stopCamera();
      return;
    }
    frameRef.current = requestAnimationFrame(renderFrame);
  };

  const startCamera = async () => {
    if (running || startInProgressRef.current) return;
    if (!window.isSecureContext) {
      updateStatus("Live camera requires HTTPS or localhost. On this laptop, test with http://localhost; on a phone, use the published HTTPS address.");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      updateStatus("This browser does not provide camera access. Use an up-to-date Chrome, Edge, or Safari browser over HTTPS.");
      return;
    }

    startInProgressRef.current = true;
    setStarting(true);
    updateStatus("Requesting camera permission…");

    try {
      if ("permissions" in navigator) {
        const permission = await navigator.permissions
          .query({ name: "camera" as PermissionName })
          .catch(() => null);
        if (permission?.state === "denied") {
          throw new DOMException("Camera permission is blocked.", "NotAllowedError");
        }
      }

      const stream = await getCompatibleCameraStream(() =>
        updateStatus("This laptop does not support the preferred front-camera settings. Trying its default webcam…"),
      );
      if (!isMountedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        startInProgressRef.current = false;
        return;
      }
      streamRef.current = stream;
      setCameraZoom(1);
      setHardwareZoomActive(false);
      const videoTrack = stream.getVideoTracks()[0];
      try {
        const capabilities = videoTrack?.getCapabilities() as (MediaTrackCapabilities & { zoom?: { min: number; max: number; step?: number } }) | undefined;
        setHardwareZoomRange(capabilities?.zoom ? { min: capabilities.zoom.min, max: capabilities.zoom.max } : null);
      } catch {
        setHardwareZoomRange(null);
      }
      const video = videoRef.current;
      if (!video) throw new Error("The camera preview element is not ready.");
      video.srcObject = stream;
      await new Promise<void>((resolve, reject) => {
        if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
          resolve();
          return;
        }
        const timeout = window.setTimeout(() => reject(new Error("Camera preview timed out.")), 12000);
        video.addEventListener(
          "loadeddata",
          () => {
            window.clearTimeout(timeout);
            resolve();
          },
          { once: true },
        );
        video.addEventListener(
          "error",
          () => {
            window.clearTimeout(timeout);
            reject(new Error("The browser could not start the camera preview."));
          },
          { once: true },
        );
      });
      await video.play();
      if (!isMountedRef.current) {
        stopCamera(false);
        return;
      }

      updateStatus("Preparing on-device body tracking…");
      const vision = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3/wasm",
      );
      if (!isMountedRef.current) {
        stopCamera(false);
        return;
      }

      const modelAssetPath =
        "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task";
      const createLandmarker = (delegate: "GPU" | "CPU", outputSegmentationMasks: boolean) =>
        PoseLandmarker.createFromOptions(vision, {
          runningMode: "VIDEO" as const,
          numPoses: 1,
          outputSegmentationMasks,
          baseOptions: { modelAssetPath, delegate },
        });

      let landmarker: PoseLandmarker;
      try {
        landmarker = await createLandmarker("GPU", true);
      } catch {
        if (!isMountedRef.current) {
          stopCamera(false);
          return;
        }
        try {
          landmarker = await createLandmarker("CPU", true);
        } catch {
          // Keep the original pose-only camera working on devices whose
          // browser/runtime cannot provide segmentation masks.
          try {
            landmarker = await createLandmarker("GPU", false);
          } catch {
            landmarker = await createLandmarker("CPU", false);
          }
        }
      }

      if (!isMountedRef.current) {
        landmarker.close();
        stopCamera(false);
        return;
      }
      landmarkerRef.current = landmarker;

      setRunning(true);
      setStarting(false);
      startInProgressRef.current = false;
      updateStatus("Camera ready. Stand back so your shoulders and hips are visible.");
      frameRef.current = requestAnimationFrame(renderFrame);
    } catch (error) {
      const name = error instanceof DOMException ? error.name : "";
      const message = name && setOfSecureCameraErrors[name]
        ? setOfSecureCameraErrors[name]
        : error instanceof Error
          ? error.message
          : "The camera or pose tracker is unavailable on this device.";
      stopCamera(isMountedRef.current);
      if (isMountedRef.current) updateStatus(message);
    }
  };

  return (
    <div className="tryon-backdrop" role="dialog" aria-modal="true" aria-label={`Live try-on for ${productName}`}>
      <div className="tryon-panel">
        <header>
          <div>
            <span className="eyebrow">LIVE FIT STUDIO</span>
            <h2>{productName}</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close try-on">
            <X />
          </button>
        </header>
        <div className={`camera-stage ${running ? "camera-stage--running" : ""}`}>
          <video
            ref={videoRef}
            muted
            playsInline
            autoPlay
            style={{ transform: `scaleX(-1) scale(${hardwareZoomActive || cameraZoom <= 1 ? 1 : cameraZoom})` }}
          />
          <canvas
            ref={canvasRef}
            style={{ transform: `scaleX(-1) scale(${hardwareZoomActive || cameraZoom <= 1 ? 1 : cameraZoom})` }}
          />
          {!running && (
            <div className="camera-placeholder">
              <Camera size={34} strokeWidth={1.2} />
              <strong>Front camera preview</strong>
              <p>Your camera starts only when you choose.</p>
            </div>
          )}
        </div>
        <div className="tryon-zoom-controls" aria-label="Camera zoom controls">
          <button
            type="button"
            aria-label="Zoom out"
            onClick={() => void applyCameraZoom(cameraZoom - 0.1)}
            disabled={cameraZoom <= (hardwareZoomRange?.min ?? 1)}
          >
            <ZoomOut size={17} /> <span>Zoom out</span>
          </button>
          <strong>{cameraZoom.toFixed(1)}x</strong>
          <button type="button" aria-label="Zoom in" onClick={() => void applyCameraZoom(cameraZoom + 0.1)} disabled={cameraZoom >= 1.5}>
            <ZoomIn size={17} /> <span>Zoom in</span>
          </button>
          <button type="button" aria-label="Reset camera zoom" onClick={() => void applyCameraZoom(1)}>
            <RotateCcw size={16} /> <span>Reset</span>
          </button>
          <small>
            {hardwareZoomActive
              ? "Device camera zoom"
              : cameraZoom > 1
                ? "Fit-to-frame zoom"
                : "Standard camera view"}
            {hardwareZoomRange ? " · hardware supported" : " · hardware zoom unavailable"}
          </small>
        </div>
        <div className="tryon-status">
          <Move size={17} /> <span>{status}</span>
        </div>
        <div className="tryon-actions">
          <button
            className={`button ${running ? "button--outline" : "button--dark"}`}
            disabled={starting}
            onClick={running ? () => stopCamera() : () => void startCamera()}
          >
            {running ? <CameraOff size={17} /> : <Camera size={17} />}
            {starting ? "PREPARING…" : running ? "STOP CAMERA" : "START CAMERA"}
          </button>
          <small>
            <ShieldCheck size={14} /> Pose tracking runs in your browser. No camera image is
            uploaded.
          </small>
        </div>
      </div>
    </div>
  );
}
