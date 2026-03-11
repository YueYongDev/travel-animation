import {getTransportProfile} from "./journeyTiming";
import type {TransportMode} from "./routeSchema";

export const TRANSPORT_SPRITE_SIZE = 160;
export const TRANSPORT_SPRITE_FORWARD_BEARING = 90;

type DrawingContext = CanvasRenderingContext2D;

const hexToRgb = (value: string) => {
  const normalized = value.replace("#", "");
  const expanded =
    normalized.length === 3
      ? normalized
          .split("")
          .map((part) => `${part}${part}`)
          .join("")
      : normalized;

  const numeric = Number.parseInt(expanded, 16);

  return {
    b: numeric & 255,
    g: (numeric >> 8) & 255,
    r: (numeric >> 16) & 255,
  };
};

const rgba = (value: string, alpha: number) => {
  const {r, g, b} = hexToRgb(value);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

const mixColor = (from: string, to: string, ratio: number) => {
  const start = hexToRgb(from);
  const end = hexToRgb(to);
  const clampRatio = Math.min(1, Math.max(0, ratio));
  const mix = (left: number, right: number) => {
    return Math.round(left + (right - left) * clampRatio);
  };

  return `rgb(${mix(start.r, end.r)}, ${mix(start.g, end.g)}, ${mix(start.b, end.b)})`;
};

const createCanvasContext = () => {
  const canvas = document.createElement("canvas");
  canvas.width = TRANSPORT_SPRITE_SIZE;
  canvas.height = TRANSPORT_SPRITE_SIZE;

  const context = canvas.getContext("2d");
  if (!context) {
    return null;
  }

  context.translate(TRANSPORT_SPRITE_SIZE / 2, TRANSPORT_SPRITE_SIZE / 2);
  context.lineCap = "round";
  context.lineJoin = "round";

  return context;
};

const withShadow = (
  context: DrawingContext,
  {
    blur,
    color = "rgba(6, 11, 20, 0.24)",
    offsetX = 0,
    offsetY = 9,
  }: {
    blur: number;
    color?: string;
    offsetX?: number;
    offsetY?: number;
  },
  draw: () => void,
) => {
  context.save();
  context.shadowBlur = blur;
  context.shadowColor = color;
  context.shadowOffsetX = offsetX;
  context.shadowOffsetY = offsetY;
  draw();
  context.restore();
};

const fillRoundedRect = (
  context: DrawingContext,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) => {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.lineTo(x + width - radius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + radius);
  context.lineTo(x + width, y + height - radius);
  context.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  context.lineTo(x + radius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - radius);
  context.lineTo(x, y + radius);
  context.quadraticCurveTo(x, y, x + radius, y);
  context.closePath();
};

const createVehiclePalette = (mode: TransportMode) => {
  const accent = getTransportProfile(mode).activeColor;

  return {
    accent,
    accentDeep: mixColor(accent, "#08101f", 0.36),
    accentSoft: mixColor(accent, "#f8fafc", 0.45),
    body: "#fff9ef",
    bodyDeep: "#dbe3ef",
    cabin: "#1c304f",
    outline: "rgba(10, 18, 32, 0.18)",
    shadow: rgba("#050816", 0.26),
  };
};

const drawPlane = (context: DrawingContext, mode: TransportMode) => {
  void mode;
  const shadow = new Path2D();
  shadow.ellipse(-3, 11, 44, 12, 0, 0, Math.PI * 2);
  context.fillStyle = "rgba(6, 11, 20, 0.16)";
  context.fill(shadow);

  const silhouette = new Path2D();
  silhouette.moveTo(60, 0);
  silhouette.quadraticCurveTo(46, -7, 30, -8);
  silhouette.lineTo(14, -8);
  silhouette.lineTo(2, -8);
  silhouette.lineTo(-6, -28);
  silhouette.lineTo(-18, -42);
  silhouette.lineTo(-24, -42);
  silhouette.lineTo(-18, -8);
  silhouette.lineTo(-30, -8);
  silhouette.lineTo(-50, -18);
  silhouette.lineTo(-55, -17);
  silhouette.lineTo(-42, -4);
  silhouette.lineTo(-41, 0);
  silhouette.lineTo(-42, 4);
  silhouette.lineTo(-55, 17);
  silhouette.lineTo(-50, 18);
  silhouette.lineTo(-30, 8);
  silhouette.lineTo(-18, 8);
  silhouette.lineTo(-24, 42);
  silhouette.lineTo(-18, 42);
  silhouette.lineTo(-6, 28);
  silhouette.lineTo(2, 8);
  silhouette.lineTo(14, 8);
  silhouette.lineTo(30, 8);
  silhouette.quadraticCurveTo(46, 7, 60, 0);
  silhouette.closePath();

  const underWing = new Path2D();
  underWing.moveTo(-2, 8);
  underWing.lineTo(-8, 24);
  underWing.lineTo(-18, 36);
  underWing.lineTo(-20, 36);
  underWing.lineTo(-16, 8);
  underWing.closePath();
  underWing.moveTo(-28, 8);
  underWing.lineTo(-47, 17);
  underWing.lineTo(-51, 16);
  underWing.lineTo(-39, 4);
  underWing.lineTo(-34, 6);
  underWing.closePath();

  withShadow(context, {blur: 18, color: "rgba(4, 9, 18, 0.24)", offsetY: 8}, () => {
    const fill = context.createLinearGradient(-54, -22, 60, 28);
    fill.addColorStop(0, "#e3dfd1");
    fill.addColorStop(0.28, "#f5f0e3");
    fill.addColorStop(0.66, "#fffaf0");
    fill.addColorStop(1, "#ddd8ca");
    context.fillStyle = fill;
    context.fill(silhouette);
  });

  context.fillStyle = "rgba(193, 184, 164, 0.55)";
  context.fill(underWing);

  const centerShade = new Path2D();
  centerShade.roundRect(-10, -4, 37, 8, 4);
  context.fillStyle = "rgba(210, 200, 180, 0.72)";
  context.fill(centerShade);

  const spineHighlight = new Path2D();
  spineHighlight.roundRect(-12, -1.4, 43, 2.8, 1.4);
  context.fillStyle = "rgba(255, 255, 255, 0.74)";
  context.fill(spineHighlight);

  const cockpit = new Path2D();
  cockpit.roundRect(21, -2.6, 13, 5.2, 2.6);
  context.fillStyle = "rgba(118, 125, 133, 0.9)";
  context.fill(cockpit);

  context.strokeStyle = "rgba(112, 105, 92, 0.22)";
  context.lineWidth = 1.2;
  context.stroke(silhouette);
};

const drawTrain = (context: DrawingContext, mode: TransportMode) => {
  const palette = createVehiclePalette(mode);
  const shadow = new Path2D();
  shadow.ellipse(0, 0, 54, 18, 0, 0, Math.PI * 2);
  context.fillStyle = "rgba(6, 11, 20, 0.12)";
  context.fill(shadow);

  const body = new Path2D();
  body.moveTo(-60, -16);
  body.quadraticCurveTo(-68, -16, -68, -7);
  body.lineTo(-68, 7);
  body.quadraticCurveTo(-68, 16, -60, 16);
  body.lineTo(24, 16);
  body.quadraticCurveTo(38, 16, 50, 7);
  body.lineTo(62, 0);
  body.lineTo(50, -7);
  body.quadraticCurveTo(38, -16, 24, -16);
  body.closePath();

  withShadow(context, {blur: 10, color: "rgba(5, 8, 22, 0.16)", offsetY: 0}, () => {
    const fill = context.createLinearGradient(-68, -12, 62, 12);
    fill.addColorStop(0, "#fffefb");
    fill.addColorStop(0.58, palette.body);
    fill.addColorStop(1, palette.bodyDeep);
    context.fillStyle = fill;
    context.fill(body);
  });

  context.strokeStyle = palette.outline;
  context.lineWidth = 1.8;
  context.stroke(body);

  context.fillStyle = rgba(palette.accent, 0.94);
  fillRoundedRect(context, -56, -3.5, 92, 7, 3.5);
  context.fill();

  context.fillStyle = palette.cabin;
  fillRoundedRect(context, -42, -10.5, 58, 8.4, 4.2);
  context.fill();

  const windshield = new Path2D();
  windshield.moveTo(28, -8.5);
  windshield.lineTo(40, -8.5);
  windshield.quadraticCurveTo(48, -8.5, 54, -3.5);
  windshield.lineTo(58, 0);
  windshield.lineTo(54, 3.5);
  windshield.quadraticCurveTo(48, 8.5, 40, 8.5);
  windshield.lineTo(28, 8.5);
  windshield.quadraticCurveTo(24, 8.5, 24, 4.5);
  windshield.lineTo(24, -4.5);
  windshield.quadraticCurveTo(24, -8.5, 28, -8.5);
  windshield.closePath();
  context.fillStyle = palette.cabin;
  context.fill(windshield);

  context.fillStyle = "rgba(255, 255, 255, 0.52)";
  fillRoundedRect(context, -49, -12.5, 54, 3.4, 1.7);
  context.fill();

  context.fillStyle = rgba("#1e3a8a", 0.16);
  fillRoundedRect(context, -8, -13.5, 1.8, 27, 0.9);
  context.fill();
  fillRoundedRect(context, 10, -13.5, 1.8, 27, 0.9);
  context.fill();

  context.fillStyle = "rgba(255, 255, 255, 0.82)";
  context.beginPath();
  context.arc(55.2, 0, 2.1, 0, Math.PI * 2);
  context.fill();
};

const drawCar = (context: DrawingContext, mode: TransportMode) => {
  const palette = createVehiclePalette(mode);
  const shadow = new Path2D();
  shadow.ellipse(0, 0, 46, 16, 0, 0, Math.PI * 2);
  context.fillStyle = "rgba(6, 11, 20, 0.12)";
  context.fill(shadow);

  const body = new Path2D();
  body.moveTo(-54, -14);
  body.quadraticCurveTo(-62, -14, -62, -5);
  body.lineTo(-62, 5);
  body.quadraticCurveTo(-62, 14, -54, 14);
  body.lineTo(18, 14);
  body.quadraticCurveTo(30, 14, 41, 7);
  body.lineTo(56, 0);
  body.lineTo(41, -7);
  body.quadraticCurveTo(30, -14, 18, -14);
  body.closePath();

  withShadow(context, {blur: 10, color: "rgba(12, 14, 24, 0.16)", offsetY: 0}, () => {
    const fill = context.createLinearGradient(-62, -10, 56, 10);
    fill.addColorStop(0, mixColor(palette.accent, "#fff7ed", 0.3));
    fill.addColorStop(0.5, palette.accent);
    fill.addColorStop(1, mixColor(palette.accent, "#08101f", 0.28));
    context.fillStyle = fill;
    context.fill(body);
  });

  context.strokeStyle = rgba("#260808", 0.16);
  context.lineWidth = 1.8;
  context.stroke(body);

  context.fillStyle = palette.cabin;
  fillRoundedRect(context, -24, -9.5, 36, 19, 8);
  context.fill();

  context.fillStyle = "rgba(255, 255, 255, 0.46)";
  fillRoundedRect(context, -20, -7.5, 10, 15, 4.5);
  context.fill();
  fillRoundedRect(context, 1, -7.5, 8, 15, 4.5);
  context.fill();

  context.fillStyle = rgba("#0a1220", 0.82);
  fillRoundedRect(context, -34, -17.2, 12, 4.8, 2.4);
  context.fill();
  fillRoundedRect(context, -34, 12.4, 12, 4.8, 2.4);
  context.fill();
  fillRoundedRect(context, 14, -17.2, 12, 4.8, 2.4);
  context.fill();
  fillRoundedRect(context, 14, 12.4, 12, 4.8, 2.4);
  context.fill();

  context.fillStyle = "rgba(255, 248, 196, 0.92)";
  context.beginPath();
  context.arc(53.5, -4, 2, 0, Math.PI * 2);
  context.arc(53.5, 4, 2, 0, Math.PI * 2);
  context.fill();

  context.fillStyle = "rgba(255, 214, 214, 0.76)";
  context.beginPath();
  context.arc(-58, -4, 1.7, 0, Math.PI * 2);
  context.arc(-58, 4, 1.7, 0, Math.PI * 2);
  context.fill();

  context.fillStyle = rgba("#ffffff", 0.18);
  fillRoundedRect(context, -44, -2.2, 80, 4.4, 2.2);
  context.fill();
};

const drawShip = (context: DrawingContext, mode: TransportMode) => {
  const palette = createVehiclePalette(mode);
  const shadow = new Path2D();
  shadow.ellipse(0, 0, 48, 16, 0, 0, Math.PI * 2);
  context.fillStyle = "rgba(6, 11, 20, 0.1)";
  context.fill(shadow);

  context.strokeStyle = rgba("#9bd6e3", 0.46);
  context.lineWidth = 2.6;
  context.beginPath();
  context.moveTo(-62, -8);
  context.quadraticCurveTo(-52, -2, -40, -5);
  context.moveTo(-62, 8);
  context.quadraticCurveTo(-52, 2, -40, 5);
  context.stroke();

  const hull = new Path2D();
  hull.moveTo(-54, -15);
  hull.lineTo(10, -15);
  hull.quadraticCurveTo(26, -15, 40, -8);
  hull.lineTo(57, 0);
  hull.lineTo(40, 8);
  hull.quadraticCurveTo(26, 15, 10, 15);
  hull.lineTo(-54, 15);
  hull.quadraticCurveTo(-60, 15, -60, 8);
  hull.lineTo(-60, -8);
  hull.quadraticCurveTo(-60, -15, -54, -15);
  hull.closePath();

  withShadow(context, {blur: 10, color: "rgba(6, 16, 24, 0.14)", offsetY: 0}, () => {
    const fill = context.createLinearGradient(-60, -12, 57, 12);
    fill.addColorStop(0, mixColor(palette.accent, "#061018", 0.3));
    fill.addColorStop(0.54, palette.accent);
    fill.addColorStop(1, palette.accentDeep);
    context.fillStyle = fill;
    context.fill(hull);
  });

  context.strokeStyle = rgba("#06231e", 0.18);
  context.lineWidth = 1.8;
  context.stroke(hull);

  context.fillStyle = palette.body;
  fillRoundedRect(context, -24, -10.5, 32, 21, 7);
  context.fill();
  fillRoundedRect(context, 5, -8.5, 17, 17, 5.5);
  context.fill();

  context.fillStyle = palette.cabin;
  fillRoundedRect(context, -15, -6.5, 16, 5.5, 2.75);
  context.fill();
  fillRoundedRect(context, 8, -4.5, 10, 9, 3);
  context.fill();

  context.fillStyle = rgba("#ffffff", 0.52);
  fillRoundedRect(context, -34, -2.5, 58, 5, 2.5);
  context.fill();

  context.fillStyle = rgba("#ffffff", 0.8);
  context.beginPath();
  context.arc(53.5, 0, 1.9, 0, Math.PI * 2);
  context.fill();
};

const drawBike = (context: DrawingContext, mode: TransportMode) => {
  const palette = createVehiclePalette(mode);
  const shadow = new Path2D();
  shadow.ellipse(0, 0, 50, 16, 0, 0, Math.PI * 2);
  context.fillStyle = "rgba(6, 11, 20, 0.1)";
  context.fill(shadow);

  context.strokeStyle = rgba("#0f172a", 0.22);
  context.lineWidth = 5.8;
  context.beginPath();
  context.arc(-28, 0, 12, 0, Math.PI * 2);
  context.arc(28, 0, 12, 0, Math.PI * 2);
  context.stroke();

  context.strokeStyle = rgba(palette.accent, 0.96);
  context.lineWidth = 4.4;
  context.beginPath();
  context.arc(-28, 0, 12, 0, Math.PI * 2);
  context.arc(28, 0, 12, 0, Math.PI * 2);
  context.stroke();

  context.strokeStyle = "#fff7ed";
  context.lineWidth = 5;
  context.beginPath();
  context.moveTo(-15, 0);
  context.lineTo(-2, -8.5);
  context.lineTo(12, 0);
  context.lineTo(-1, 8.5);
  context.closePath();
  context.moveTo(12, 0);
  context.lineTo(28, 0);
  context.moveTo(-2, -8.5);
  context.lineTo(28, 0);
  context.moveTo(-5, -10.2);
  context.lineTo(-11, -17);
  context.moveTo(14, -2.8);
  context.lineTo(20, -14);
  context.moveTo(18, -14);
  context.lineTo(31, -14);
  context.stroke();

  context.strokeStyle = palette.outline;
  context.lineWidth = 1.5;
  context.beginPath();
  context.moveTo(-2, -8.5);
  context.lineTo(-2, 8.5);
  context.moveTo(4.2, -4.2);
  context.lineTo(4.2, 4.2);
  context.stroke();
};

const drawWalk = (context: DrawingContext, mode: TransportMode) => {
  const palette = createVehiclePalette(mode);
  const shadow = new Path2D();
  shadow.ellipse(0, 0, 34, 18, 0, 0, Math.PI * 2);
  context.fillStyle = "rgba(6, 11, 20, 0.1)";
  context.fill(shadow);

  const sole = new Path2D();
  sole.moveTo(-46, -10);
  sole.quadraticCurveTo(-52, -10, -52, -4);
  sole.lineTo(-52, 4);
  sole.quadraticCurveTo(-52, 10, -46, 10);
  sole.lineTo(-10, 10);
  sole.quadraticCurveTo(8, 10, 24, 6);
  sole.lineTo(44, 2);
  sole.quadraticCurveTo(58, 0, 58, -6);
  sole.quadraticCurveTo(58, -11, 45, -12);
  sole.lineTo(24, -12);
  sole.quadraticCurveTo(8, -12, -8, -10);
  sole.closePath();

  withShadow(context, {blur: 10, color: "rgba(10, 18, 32, 0.14)", offsetY: 0}, () => {
    const fill = context.createLinearGradient(-52, -8, 58, 8);
    fill.addColorStop(0, "#fffaf0");
    fill.addColorStop(0.58, palette.body);
    fill.addColorStop(1, palette.bodyDeep);
    context.fillStyle = fill;
    context.fill(sole);
  });

  context.strokeStyle = palette.outline;
  context.lineWidth = 1.8;
  context.stroke(sole);

  context.fillStyle = rgba(palette.accent, 0.94);
  fillRoundedRect(context, -22, -6.2, 34, 12.4, 6.2);
  context.fill();

  context.fillStyle = rgba("#0a1220", 0.8);
  fillRoundedRect(context, -35, -14.8, 16, 4.2, 2.1);
  context.fill();
  fillRoundedRect(context, -35, 10.6, 16, 4.2, 2.1);
  context.fill();

  context.fillStyle = rgba("#ffffff", 0.48);
  fillRoundedRect(context, -10, -2.1, 44, 4.2, 2.1);
  context.fill();
};

const drawVehicle = (context: DrawingContext, mode: TransportMode) => {
  switch (mode) {
    case "bike":
      drawBike(context, mode);
      return;
    case "car":
      drawCar(context, mode);
      return;
    case "plane":
      drawPlane(context, mode);
      return;
    case "ship":
      drawShip(context, mode);
      return;
    case "train":
      drawTrain(context, mode);
      return;
    case "walk":
      drawWalk(context, mode);
      return;
    default:
      drawPlane(context, "plane");
  }
};

export const createTransportVehicleImage = (mode: TransportMode) => {
  const context = createCanvasContext();
  if (!context) {
    return new ImageData(TRANSPORT_SPRITE_SIZE, TRANSPORT_SPRITE_SIZE);
  }

  drawVehicle(context, mode);

  return context.getImageData(0, 0, TRANSPORT_SPRITE_SIZE, TRANSPORT_SPRITE_SIZE);
};
