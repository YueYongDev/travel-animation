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

const drawWheel = (
  context: DrawingContext,
  {
    hubRadius = 4,
    ringColor,
    x,
    y,
    radius,
  }: {
    hubRadius?: number;
    ringColor: string;
    x: number;
    y: number;
    radius: number;
  },
) => {
  context.fillStyle = "rgba(7, 12, 20, 0.94)";
  context.beginPath();
  context.arc(x, y, radius, 0, Math.PI * 2);
  context.fill();

  context.strokeStyle = ringColor;
  context.lineWidth = Math.max(2.2, radius * 0.22);
  context.beginPath();
  context.arc(x, y, radius - 1.9, 0, Math.PI * 2);
  context.stroke();

  context.fillStyle = "#fff8ed";
  context.beginPath();
  context.arc(x, y, hubRadius, 0, Math.PI * 2);
  context.fill();

  context.fillStyle = "rgba(7, 12, 20, 0.24)";
  context.beginPath();
  context.arc(x, y, Math.max(1.8, hubRadius - 1.5), 0, Math.PI * 2);
  context.fill();
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
  
  // Shadow
  context.fillStyle = "rgba(6, 11, 20, 0.12)";
  context.beginPath();
  context.ellipse(0, 16, 52, 10, 0, 0, Math.PI * 2);
  context.fill();

  const body = new Path2D();
  body.moveTo(-64, -12);
  body.lineTo(24, -12);
  body.quadraticCurveTo(42, -12, 54, -4);
  body.lineTo(60, 0);
  body.lineTo(54, 4);
  body.quadraticCurveTo(42, 12, 24, 12);
  body.lineTo(-64, 12);
  body.quadraticCurveTo(-68, 12, -68, 6);
  body.lineTo(-68, -6);
  body.quadraticCurveTo(-68, -12, -64, -12);
  body.closePath();

  withShadow(context, {blur: 10, color: palette.shadow, offsetY: 2}, () => {
    const fill = context.createLinearGradient(-68, -12, 60, 12);
    fill.addColorStop(0, "#f8fafc");
    fill.addColorStop(0.5, palette.body);
    fill.addColorStop(1, palette.bodyDeep);
    context.fillStyle = fill;
    context.fill(body);
  });

  context.strokeStyle = palette.outline;
  context.lineWidth = 1.8;
  context.stroke(body);

  // Stripe
  context.fillStyle = palette.accent;
  fillRoundedRect(context, -58, 2, 90, 4.5, 2.25);
  context.fill();

  // Windows
  context.fillStyle = palette.cabin;
  for (let i = 0; i < 4; i++) {
    fillRoundedRect(context, -52 + i * 16, -9, 10, 7, 2);
  }
  context.fill();

  // Windshield
  const windshield = new Path2D();
  windshield.moveTo(24, -8);
  windshield.lineTo(38, -8);
  windshield.quadraticCurveTo(48, -8, 54, -2);
  windshield.lineTo(56, 0);
  windshield.lineTo(54, 2);
  windshield.quadraticCurveTo(48, 8, 38, 8);
  windshield.lineTo(24, 8);
  windshield.closePath();
  context.fill(windshield);
};

const drawHighSpeedTrain = (context: DrawingContext, mode: TransportMode) => {
  const palette = createVehiclePalette(mode);
  
  // Shadow
  context.fillStyle = "rgba(6, 11, 20, 0.1)";
  context.beginPath();
  context.ellipse(4, 18, 60, 8, 0, 0, Math.PI * 2);
  context.fill();

  const body = new Path2D();
  body.moveTo(-74, -10);
  body.lineTo(10, -10);
  body.quadraticCurveTo(48, -10, 68, -2);
  body.lineTo(76, 0);
  body.lineTo(68, 2);
  body.quadraticCurveTo(48, 10, 10, 10);
  body.lineTo(-74, 10);
  body.quadraticCurveTo(-78, 10, -78, 5);
  body.lineTo(-78, -5);
  body.quadraticCurveTo(-78, -10, -74, -10);
  body.closePath();

  withShadow(context, {blur: 12, color: palette.shadow, offsetY: 2}, () => {
    const fill = context.createLinearGradient(-78, -10, 76, 10);
    fill.addColorStop(0, "#ffffff");
    fill.addColorStop(0.6, palette.body);
    fill.addColorStop(1, "#f1f5f9");
    context.fillStyle = fill;
    context.fill(body);
  });

  context.strokeStyle = palette.outline;
  context.lineWidth = 1.6;
  context.stroke(body);

  // Aerodynamic Stripe
  context.fillStyle = palette.accent;
  const stripe = new Path2D();
  stripe.moveTo(-70, 0);
  stripe.lineTo(-10, 0);
  stripe.quadraticCurveTo(30, 0, 50, 4);
  stripe.lineTo(48, 6);
  stripe.quadraticCurveTo(28, 2, -10, 2);
  stripe.lineTo(-70, 2);
  stripe.closePath();
  context.fill(stripe);

  // Windows (long ribbon)
  context.fillStyle = palette.cabin;
  fillRoundedRect(context, -64, -7, 72, 4.5, 2.25);
  context.fill();

  // Nose glass
  const nose = new Path2D();
  nose.moveTo(28, -6);
  nose.lineTo(44, -6);
  nose.quadraticCurveTo(58, -6, 68, -1.5);
  nose.lineTo(70, 0);
  nose.lineTo(68, 1.5);
  nose.quadraticCurveTo(58, 6, 44, 6);
  nose.lineTo(28, 6);
  nose.closePath();
  context.fill(nose);
};

const drawCar = (context: DrawingContext, mode: TransportMode) => {
  const palette = createVehiclePalette(mode);
  const shadow = new Path2D();
  shadow.ellipse(0, 18, 42, 10, 0, 0, Math.PI * 2);
  context.fillStyle = "rgba(6, 11, 20, 0.14)";
  context.fill(shadow);

  const body = new Path2D();
  body.moveTo(-56, 7);
  body.lineTo(-52, -2);
  body.quadraticCurveTo(-48, -14, -34, -19);
  body.lineTo(-10, -25);
  body.quadraticCurveTo(2, -28, 16, -26);
  body.lineTo(26, -18);
  body.lineTo(44, -8);
  body.quadraticCurveTo(58, -2, 60, 7);
  body.quadraticCurveTo(60, 13, 52, 13);
  body.lineTo(-48, 13);
  body.quadraticCurveTo(-56, 13, -56, 7);
  body.closePath();

  withShadow(context, {blur: 12, color: palette.shadow, offsetY: 2}, () => {
    const fill = context.createLinearGradient(-60, -22, 60, 14);
    fill.addColorStop(0, mixColor(palette.accent, "#fff8ef", 0.34));
    fill.addColorStop(0.5, palette.accent);
    fill.addColorStop(1, mixColor(palette.accent, "#08101f", 0.28));
    context.fillStyle = fill;
    context.fill(body);
  });

  context.strokeStyle = rgba("#260808", 0.14);
  context.lineWidth = 1.8;
  context.stroke(body);

  const glass = new Path2D();
  glass.moveTo(-24, -18);
  glass.lineTo(-6, -22);
  glass.quadraticCurveTo(6, -24, 16, -20);
  glass.lineTo(30, -11);
  glass.lineTo(22, -5);
  glass.lineTo(-22, -5);
  glass.closePath();
  context.fillStyle = palette.cabin;
  context.fill(glass);

  context.fillStyle = "rgba(255, 255, 255, 0.42)";
  fillRoundedRect(context, -20, -15.8, 13, 8.4, 4.2);
  context.fill();
  fillRoundedRect(context, 0, -15.2, 10, 7.8, 3.9);
  context.fill();

  context.fillStyle = rgba(palette.accentSoft, 0.94);
  fillRoundedRect(context, -38, 2.8, 58, 5.2, 2.6);
  context.fill();

  context.fillStyle = "rgba(255, 252, 214, 0.9)";
  context.beginPath();
  context.arc(55, -2.8, 1.8, 0, Math.PI * 2);
  context.arc(55, 2.8, 1.8, 0, Math.PI * 2);
  context.fill();

  context.fillStyle = "rgba(255, 214, 214, 0.76)";
  context.beginPath();
  context.arc(-54, -3, 1.6, 0, Math.PI * 2);
  context.arc(-54, 3, 1.6, 0, Math.PI * 2);
  context.fill();

  drawWheel(context, {
    hubRadius: 4.2,
    radius: 10.5,
    ringColor: palette.body,
    x: -26,
    y: 16,
  });
  drawWheel(context, {
    hubRadius: 4.2,
    radius: 10.5,
    ringColor: palette.body,
    x: 28,
    y: 16,
  });
};

const drawShip = (context: DrawingContext, mode: TransportMode) => {
  const palette = createVehiclePalette(mode);
  const shadow = new Path2D();
  shadow.ellipse(0, 19, 48, 10, 0, 0, Math.PI * 2);
  context.fillStyle = "rgba(6, 11, 20, 0.12)";
  context.fill(shadow);

  context.strokeStyle = rgba("#b7ecf5", 0.58);
  context.lineWidth = 2.2;
  context.beginPath();
  context.moveTo(-60, 18);
  context.quadraticCurveTo(-46, 24, -30, 18);
  context.moveTo(-6, 21);
  context.quadraticCurveTo(10, 27, 28, 20);
  context.stroke();

  const hull = new Path2D();
  hull.moveTo(-56, 12);
  hull.lineTo(-46, -6);
  hull.lineTo(12, -6);
  hull.quadraticCurveTo(30, -6, 42, -1);
  hull.lineTo(58, 4);
  hull.lineTo(44, 14);
  hull.lineTo(-52, 14);
  hull.quadraticCurveTo(-58, 14, -56, 12);
  hull.closePath();

  withShadow(context, {blur: 12, color: palette.shadow, offsetY: 2}, () => {
    const fill = context.createLinearGradient(-56, -8, 58, 16);
    fill.addColorStop(0, palette.accentDeep);
    fill.addColorStop(0.54, palette.accent);
    fill.addColorStop(1, palette.accentDeep);
    context.fillStyle = fill;
    context.fill(hull);
  });

  context.strokeStyle = rgba("#06231e", 0.18);
  context.lineWidth = 1.8;
  context.stroke(hull);

  context.fillStyle = palette.body;
  fillRoundedRect(context, -26, -24, 36, 16, 5.5);
  context.fill();
  fillRoundedRect(context, -8, -36, 22, 10, 4);
  context.fill();

  context.fillStyle = palette.cabin;
  fillRoundedRect(context, -18, -20, 20, 6.2, 3.1);
  context.fill();
  fillRoundedRect(context, -2, -33.2, 10, 4.8, 2.4);
  context.fill();

  context.fillStyle = rgba("#ffffff", 0.68);
  fillRoundedRect(context, -38, -0.6, 62, 3.8, 1.9);
  context.fill();

  context.fillStyle = rgba(palette.accentSoft, 0.96);
  fillRoundedRect(context, 6, -26, 7, 12, 3.5);
  context.fill();

  context.fillStyle = "rgba(255, 252, 222, 0.92)";
  context.beginPath();
  context.arc(54.5, 3, 1.8, 0, Math.PI * 2);
  context.fill();
};

const drawBike = (context: DrawingContext, mode: TransportMode) => {
  const palette = createVehiclePalette(mode);
  const shadow = new Path2D();
  shadow.ellipse(0, 18, 46, 9, 0, 0, Math.PI * 2);
  context.fillStyle = "rgba(6, 11, 20, 0.12)";
  context.fill(shadow);

  drawWheel(context, {
    hubRadius: 3.6,
    radius: 12.5,
    ringColor: rgba(palette.accent, 0.96),
    x: -30,
    y: 10,
  });
  drawWheel(context, {
    hubRadius: 3.6,
    radius: 12.5,
    ringColor: rgba(palette.accent, 0.96),
    x: 30,
    y: 10,
  });

  context.strokeStyle = rgba("#0f172a", 0.18);
  context.lineWidth = 1.5;
  context.beginPath();
  context.moveTo(-30, 10);
  context.lineTo(-8, 0);
  context.lineTo(8, 10);
  context.lineTo(-30, 10);
  context.moveTo(30, 10);
  context.lineTo(10, -8);
  context.lineTo(-8, 0);
  context.moveTo(10, -8);
  context.lineTo(8, 10);
  context.moveTo(-12, -9);
  context.lineTo(-4, -9);
  context.moveTo(12, -10);
  context.lineTo(22, -17);
  context.moveTo(19, -17);
  context.lineTo(31, -17);
  context.stroke();

  context.strokeStyle = rgba(palette.accentDeep, 0.55);
  context.lineWidth = 6;
  context.beginPath();
  context.moveTo(-30, 10);
  context.lineTo(-8, 0);
  context.lineTo(8, 10);
  context.lineTo(10, -8);
  context.lineTo(-8, 0);
  context.moveTo(10, -8);
  context.lineTo(30, 10);
  context.moveTo(-8, 0);
  context.lineTo(-16, -10);
  context.moveTo(-18, -10);
  context.lineTo(-8, -10);
  context.moveTo(12, -10);
  context.lineTo(22, -17);
  context.moveTo(19, -17);
  context.lineTo(31, -17);
  context.stroke();

  context.strokeStyle = "#fff8ef";
  context.lineWidth = 4.2;
  context.beginPath();
  context.moveTo(-30, 10);
  context.lineTo(-8, 0);
  context.lineTo(8, 10);
  context.lineTo(10, -8);
  context.lineTo(-8, 0);
  context.moveTo(10, -8);
  context.lineTo(30, 10);
  context.moveTo(-8, 0);
  context.lineTo(-16, -10);
  context.moveTo(-18, -10);
  context.lineTo(-8, -10);
  context.moveTo(12, -10);
  context.lineTo(22, -17);
  context.moveTo(19, -17);
  context.lineTo(31, -17);
  context.stroke();

  context.fillStyle = rgba(palette.accent, 0.98);
  context.beginPath();
  context.arc(-8, 0, 4.4, 0, Math.PI * 2);
  context.fill();
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
    case "high_speed_train":
      drawHighSpeedTrain(context, mode);
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
