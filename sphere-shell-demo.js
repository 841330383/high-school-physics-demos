const params = {
  radius: 1.4,
  chargeDistance: 2.6,
  chargeMagnitude: 1.0,
  chargeSign: -1,
  showFieldLines: true,
  showEquipotentialSurfaces: true,
  showImageCharge: true,
};

const sceneHost = document.querySelector("#scene3d");
const sliceCanvas = document.querySelector("#sliceCanvas");
const sliceCtx = sliceCanvas.getContext("2d");
const formulaBoard = document.querySelector("#formulaBoard");

const fieldToggle = document.querySelector("#fieldToggle");
const surfaceToggle = document.querySelector("#surfaceToggle");

const palette = {
  shell: 0x19484e,
  shellFill: 0xe6efed,
  shellWire: 0x2c5960,
  field: 0x2f7fb7,
  fieldCore: 0x1671aa,
  fieldHalo: 0x94d3ff,
  equipotential: [0xdf6d3f, 0xd79837, 0x7b9f3e],
  positive: 0xe1583b,
  negative: 0x2d72d2,
  image: 0x7e8f95,
  point: 0x1b292c,
};

const state = {
  model: null,
  scene: null,
  camera: null,
  renderer: null,
  controls: null,
  shellGroup: null,
  fieldGroup: null,
  surfaceGroup: null,
  markerGroup: null,
  axisLine: null,
  realChargeMesh: null,
  imageChargeMesh: null,
  realChargeHalo: null,
  meridianLines: [],
  contourSegments: [],
  equipotentialProfiles: [],
  equipotentialLevels: [],
  points: {},
  viewExtent: 4,
  hasInitialFrame: false,
};

const DISPLAY_EXTENT = 4.8;
const MIN_GAP = 0.42;

function fmt(value, digits = 2) {
  return Number(value).toFixed(digits);
}

function potentialAt(model, x, y, z = 0) {
  const r = Math.hypot(x, y, z);
  if (r < model.radius - 1e-4) {
    return 0;
  }

  const dx1 = x;
  const dy1 = y - model.a;
  const dz1 = z;
  const dx2 = x;
  const dy2 = y - model.b;
  const dz2 = z;

  const d1 = Math.max(Math.hypot(dx1, dy1, dz1), 1e-4);
  const d2 = Math.max(Math.hypot(dx2, dy2, dz2), 1e-4);

  return model.q / d1 + model.qi / d2;
}

function fieldAt(model, x, y, z = 0) {
  const r = Math.hypot(x, y, z);
  if (r < model.radius - 1e-4) {
    return { x: 0, y: 0, z: 0 };
  }

  const dx1 = x;
  const dy1 = y - model.a;
  const dz1 = z;
  const dx2 = x;
  const dy2 = y - model.b;
  const dz2 = z;

  const d1 = Math.max(Math.hypot(dx1, dy1, dz1), 1e-4);
  const d2 = Math.max(Math.hypot(dx2, dy2, dz2), 1e-4);
  const d13 = d1 * d1 * d1;
  const d23 = d2 * d2 * d2;

  return {
    x: model.q * dx1 / d13 + model.qi * dx2 / d23,
    y: model.q * dy1 / d13 + model.qi * dy2 / d23,
    z: model.q * dz1 / d13 + model.qi * dz2 / d23,
  };
}

function normalizeVector2(vector) {
  const magnitude = Math.hypot(vector.x, vector.y);
  if (!Number.isFinite(magnitude) || magnitude < 1e-8) {
    return null;
  }
  return {
    x: vector.x / magnitude,
    y: vector.y / magnitude,
  };
}

function buildModel() {
  const radius = params.radius;
  const a = Math.max(params.chargeDistance, radius + MIN_GAP);
  params.chargeDistance = a;
  const q = params.chargeMagnitude * params.chargeSign;
  const qi = -q * radius / a;
  const b = (radius * radius) / a;
  const gap = a - radius;
  const extent = Math.max(DISPLAY_EXTENT, a + 1.2);
  const ratio = a / radius;
  const imageRatio = Math.abs(qi / q);
  const forceY = (q * qi) / Math.max((a - b) * (a - b), 1e-4);

  const points = {
    A: { x: 0, y: a, label: "A（锁定外电荷）", kind: "charge" },
    B: { x: 0, y: Math.min(radius * 0.42, radius - 0.18), label: "B（壳内）" },
    O: { x: 0, y: 0, label: "O（球心）" },
    M: { x: -2.15, y: 0.82, label: "M（球外）" },
    N: { x: 2.15, y: 0.82, label: "N（球外）" },
  };

  return {
    radius,
    a,
    b,
    q,
    qi,
    gap,
    ratio,
    imageRatio,
    forceY,
    extent,
    viewExtent: DISPLAY_EXTENT,
    chargeRadius: radius * 0.09,
    points,
  };
}

function buildSampleGrid(xMin, xMax, yMin, yMax, xCount, yCount, sampler) {
  const grid = {
    xMin,
    xMax,
    yMin,
    yMax,
    xCount,
    yCount,
    values: new Float64Array(xCount * yCount),
    xs: new Float64Array(xCount),
    ys: new Float64Array(yCount),
  };

  for (let i = 0; i < xCount; i += 1) {
    grid.xs[i] = xMin + (xMax - xMin) * (i / (xCount - 1));
  }

  for (let j = 0; j < yCount; j += 1) {
    grid.ys[j] = yMin + (yMax - yMin) * (j / (yCount - 1));
  }

  for (let j = 0; j < yCount; j += 1) {
    for (let i = 0; i < xCount; i += 1) {
      grid.values[j * xCount + i] = sampler(grid.xs[i], grid.ys[j]);
    }
  }

  return grid;
}

function gridValue(grid, i, j) {
  return grid.values[j * grid.xCount + i];
}

function interpolatePoint(p1, p2, v1, v2, level) {
  const denominator = v2 - v1;
  const t = Math.abs(denominator) < 1e-10 ? 0.5 : (level - v1) / denominator;
  return {
    x: p1.x + (p2.x - p1.x) * t,
    y: p1.y + (p2.y - p1.y) * t,
  };
}

function marchingSquareSegments(grid, level) {
  const segments = [];

  for (let j = 0; j < grid.yCount - 1; j += 1) {
    for (let i = 0; i < grid.xCount - 1; i += 1) {
      const p00 = { x: grid.xs[i], y: grid.ys[j] };
      const p10 = { x: grid.xs[i + 1], y: grid.ys[j] };
      const p11 = { x: grid.xs[i + 1], y: grid.ys[j + 1] };
      const p01 = { x: grid.xs[i], y: grid.ys[j + 1] };

      const v00 = gridValue(grid, i, j);
      const v10 = gridValue(grid, i + 1, j);
      const v11 = gridValue(grid, i + 1, j + 1);
      const v01 = gridValue(grid, i, j + 1);

      const caseId =
        (v00 >= level ? 1 : 0) |
        (v10 >= level ? 2 : 0) |
        (v11 >= level ? 4 : 0) |
        (v01 >= level ? 8 : 0);

      if (caseId === 0 || caseId === 15) {
        continue;
      }

      const edgePoints = {
        0: interpolatePoint(p00, p10, v00, v10, level),
        1: interpolatePoint(p10, p11, v10, v11, level),
        2: interpolatePoint(p11, p01, v11, v01, level),
        3: interpolatePoint(p01, p00, v01, v00, level),
      };

      const centerValue = (v00 + v10 + v11 + v01) / 4;
      let pairs = [];

      switch (caseId) {
        case 1:
          pairs = [[3, 0]];
          break;
        case 2:
          pairs = [[0, 1]];
          break;
        case 3:
          pairs = [[3, 1]];
          break;
        case 4:
          pairs = [[1, 2]];
          break;
        case 5:
          pairs = centerValue >= level ? [[3, 2], [0, 1]] : [[3, 0], [2, 1]];
          break;
        case 6:
          pairs = [[0, 2]];
          break;
        case 7:
          pairs = [[3, 2]];
          break;
        case 8:
          pairs = [[2, 3]];
          break;
        case 9:
          pairs = [[0, 2]];
          break;
        case 10:
          pairs = centerValue >= level ? [[0, 3], [1, 2]] : [[0, 1], [3, 2]];
          break;
        case 11:
          pairs = [[1, 2]];
          break;
        case 12:
          pairs = [[1, 3]];
          break;
        case 13:
          pairs = [[0, 1]];
          break;
        case 14:
          pairs = [[3, 0]];
          break;
        default:
          break;
      }

      pairs.forEach(([edgeA, edgeB]) => {
        segments.push({
          a: edgePoints[edgeA],
          b: edgePoints[edgeB],
        });
      });
    }
  }

  return segments;
}

function samePoint(pointA, pointB, tolerance = 1e-4) {
  return Math.hypot(pointA.x - pointB.x, pointA.y - pointB.y) <= tolerance;
}

function connectSegments(segments) {
  const remaining = segments.slice();
  const chains = [];

  while (remaining.length > 0) {
    const segment = remaining.pop();
    const chain = [segment.a, segment.b];
    let expanded = true;

    while (expanded) {
      expanded = false;

      for (let i = remaining.length - 1; i >= 0; i -= 1) {
        const current = remaining[i];
        const first = chain[0];
        const last = chain[chain.length - 1];

        if (samePoint(current.a, last)) {
          chain.push(current.b);
          remaining.splice(i, 1);
          expanded = true;
        } else if (samePoint(current.b, last)) {
          chain.push(current.a);
          remaining.splice(i, 1);
          expanded = true;
        } else if (samePoint(current.b, first)) {
          chain.unshift(current.a);
          remaining.splice(i, 1);
          expanded = true;
        } else if (samePoint(current.a, first)) {
          chain.unshift(current.b);
          remaining.splice(i, 1);
          expanded = true;
        }
      }
    }

    chains.push(chain);
  }

  return chains;
}

function compressProfile(points) {
  const compact = [];

  points.forEach((point) => {
    if (compact.length === 0 || !samePoint(compact[compact.length - 1], point, 1e-3)) {
      compact.push(point);
    }
  });

  if (compact.length > 1 && samePoint(compact[0], compact[compact.length - 1], 1e-3)) {
    compact.pop();
  }

  return compact;
}

function createFieldSeeds(model) {
  const seeds = [];
  const aroundCharge = 14;
  const chargeRadius = model.radius * 0.2;

  for (let i = 0; i < aroundCharge; i += 1) {
    const angle = (Math.PI * 2 * i) / aroundCharge;
    seeds.push({
      x: chargeRadius * Math.sin(angle),
      y: model.a + chargeRadius * Math.cos(angle),
    });
  }

  const nearSphere = 10;
  const shellOffset = model.radius * 0.03;
  for (let i = 1; i < nearSphere; i += 1) {
    const theta = (Math.PI * i) / nearSphere;
    seeds.push({
      x: (model.radius + shellOffset) * Math.sin(theta),
      y: (model.radius + shellOffset) * Math.cos(theta),
    });
    seeds.push({
      x: -(model.radius + shellOffset) * Math.sin(theta),
      y: (model.radius + shellOffset) * Math.cos(theta),
    });
  }

  return seeds;
}

function traceFieldDirection(seed, sign, model) {
  const points = [];
  let current = { ...seed };
  const step = model.radius * 0.06;
  const maxSteps = 560;

  for (let i = 0; i < maxSteps; i += 1) {
    points.push({ ...current });

    const distanceToCharge = Math.hypot(current.x, current.y - model.a);
    if (distanceToCharge < model.radius * 0.09 && i > 1) {
      points.push({ x: 0, y: model.a });
      break;
    }

    const radial = Math.hypot(current.x, current.y);
    if (radial < model.radius + model.radius * 0.005) {
      const scale = model.radius / Math.max(radial, 1e-5);
      points.push({ x: current.x * scale, y: current.y * scale });
      break;
    }

    if (Math.hypot(current.x, current.y) > model.extent * 1.02) {
      break;
    }

    const k1Raw = fieldAt(model, current.x, current.y);
    const k1 = normalizeVector2({ x: k1Raw.x * sign, y: k1Raw.y * sign });
    if (!k1) {
      break;
    }

    const mid1 = { x: current.x + (step * k1.x) / 2, y: current.y + (step * k1.y) / 2 };
    const k2Raw = fieldAt(model, mid1.x, mid1.y);
    const k2 = normalizeVector2({ x: k2Raw.x * sign, y: k2Raw.y * sign }) || k1;

    const mid2 = { x: current.x + (step * k2.x) / 2, y: current.y + (step * k2.y) / 2 };
    const k3Raw = fieldAt(model, mid2.x, mid2.y);
    const k3 = normalizeVector2({ x: k3Raw.x * sign, y: k3Raw.y * sign }) || k2;

    const endPoint = { x: current.x + step * k3.x, y: current.y + step * k3.y };
    const k4Raw = fieldAt(model, endPoint.x, endPoint.y);
    const k4 = normalizeVector2({ x: k4Raw.x * sign, y: k4Raw.y * sign }) || k3;

    current = {
      x: current.x + (step * (k1.x + 2 * k2.x + 2 * k3.x + k4.x)) / 6,
      y: current.y + (step * (k1.y + 2 * k2.y + 2 * k3.y + k4.y)) / 6,
    };
  }

  return points;
}

function buildFieldLines(model) {
  const seeds = createFieldSeeds(model);
  const lines = [];

  seeds.forEach((seed) => {
    const forward = traceFieldDirection(seed, 1, model);
    const backward = traceFieldDirection(seed, -1, model).reverse();
    const combined = compressProfile([...backward.slice(0, -1), ...forward]);
    if (combined.length > 12) {
      lines.push(combined);
    }
  });

  return lines.slice(0, 16);
}

function buildContours(model) {
  const extent = model.extent;
  const contourProbe = Math.abs(
    potentialAt(model, 0, model.a - (model.a - model.radius) * 0.28)
  );
  const levels = [0.18, 0.33, 0.52].map((factor) => Math.sign(model.q || 1) * contourProbe * factor);

  const fullGrid = buildSampleGrid(
    -extent,
    extent,
    -extent,
    extent,
    120,
    120,
    (x, y) => potentialAt(model, x, y)
  );

  const halfGrid = buildSampleGrid(
    0,
    extent,
    -extent,
    extent,
    90,
    140,
    (x, y) => potentialAt(model, x, y)
  );

  const fullSegments = levels.map((level) => marchingSquareSegments(fullGrid, level));
  const halfProfiles = levels.map((level) => connectSegments(marchingSquareSegments(halfGrid, level)));

  return {
    levels,
    fullSegments,
    halfProfiles,
  };
}

function projectToCanvas(model, x, y, width, height) {
  const margin = 48;
  const scale = Math.min(
    (width - margin * 2) / (model.viewExtent * 2),
    (height - margin * 2) / (model.viewExtent * 2)
  );
  return {
    x: width / 2 + x * scale,
    y: height / 2 - y * scale,
    scale,
  };
}

function drawArrowHead(ctx, from, to, color) {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const size = 6;
  ctx.save();
  ctx.translate(to.x, to.y);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(-size, size * 0.55);
  ctx.lineTo(-size, -size * 0.55);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}

function drawRoundedRect(ctx, x, y, width, height, radius) {
  const safeRadius = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + safeRadius, y);
  ctx.lineTo(x + width - safeRadius, y);
  ctx.arcTo(x + width, y, x + width, y + safeRadius, safeRadius);
  ctx.lineTo(x + width, y + height - safeRadius);
  ctx.arcTo(x + width, y + height, x + width - safeRadius, y + height, safeRadius);
  ctx.lineTo(x + safeRadius, y + height);
  ctx.arcTo(x, y + height, x, y + height - safeRadius, safeRadius);
  ctx.lineTo(x, y + safeRadius);
  ctx.arcTo(x, y, x + safeRadius, y, safeRadius);
  ctx.closePath();
}

function drawTextChip(ctx, text, x, y, options = {}) {
  const {
    align = "left",
    font = "600 16px 'Microsoft YaHei'",
    textColor = "#1b292c",
    fill = "rgba(255, 255, 255, 0.9)",
    stroke = "rgba(27, 41, 44, 0.12)",
    paddingX = 10,
    paddingY = 6,
    radius = 10,
  } = options;

  ctx.save();
  ctx.font = font;
  ctx.textBaseline = "middle";

  const metrics = ctx.measureText(text);
  const textHeight =
    (metrics.actualBoundingBoxAscent || 11) + (metrics.actualBoundingBoxDescent || 5);
  const boxWidth = metrics.width + paddingX * 2;
  const boxHeight = textHeight + paddingY * 2;

  let boxX = x;
  if (align === "center") {
    boxX = x - boxWidth / 2;
  } else if (align === "right") {
    boxX = x - boxWidth;
  }

  const boxY = y - boxHeight / 2;
  drawRoundedRect(ctx, boxX, boxY, boxWidth, boxHeight, radius);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = textColor;
  ctx.fillText(text, boxX + paddingX, y);
  ctx.restore();
}

function drawMeasureSegment(ctx, x, y1, y2, label, color, options = {}) {
  const { labelSide = "right", labelOffset = 14, labelDy = 0 } = options;
  const head = 7;
  const top = Math.min(y1, y2);
  const bottom = Math.max(y1, y2);
  const mid = (top + bottom) / 2;

  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x, top);
  ctx.lineTo(x, bottom);
  ctx.moveTo(x, top);
  ctx.lineTo(x - head, top + head);
  ctx.moveTo(x, top);
  ctx.lineTo(x + head, top + head);
  ctx.moveTo(x, bottom);
  ctx.lineTo(x - head, bottom - head);
  ctx.moveTo(x, bottom);
  ctx.lineTo(x + head, bottom - head);
  ctx.stroke();
  ctx.restore();

  const labelX = labelSide === "left" ? x - labelOffset : x + labelOffset;
  drawTextChip(ctx, label, labelX, mid + labelDy, {
    align: labelSide === "left" ? "right" : "left",
    font: "600 16px 'Microsoft YaHei'",
    textColor: color,
    fill: "rgba(255, 255, 255, 0.96)",
    stroke: "rgba(27, 41, 44, 0.1)",
  });
}

function drawSlice(model) {
  const width = sliceCanvas.width;
  const height = sliceCanvas.height;

  sliceCtx.clearRect(0, 0, width, height);
  sliceCtx.fillStyle = "rgba(255,255,255,0.94)";
  sliceCtx.fillRect(0, 0, width, height);

  sliceCtx.save();
  sliceCtx.setLineDash([6, 6]);
  const axisTop = projectToCanvas(model, 0, model.viewExtent, width, height);
  const axisBottom = projectToCanvas(model, 0, -model.viewExtent, width, height);
  sliceCtx.strokeStyle = "rgba(47, 127, 183, 0.45)";
  sliceCtx.lineWidth = 2;
  sliceCtx.beginPath();
  sliceCtx.moveTo(axisTop.x, axisTop.y);
  sliceCtx.lineTo(axisBottom.x, axisBottom.y);
  sliceCtx.stroke();
  sliceCtx.restore();

  const center = projectToCanvas(model, 0, 0, width, height);
  const topShell = projectToCanvas(model, 0, model.radius, width, height);
  const chargePoint = projectToCanvas(model, 0, model.a, width, height);
  const radiusPixels = center.scale * model.radius;
  const leftMeasureX = center.x - radiusPixels - 74;
  const rightMeasureX = center.x + radiusPixels + 88;

  if (params.showEquipotentialSurfaces) {
    const contourColors = ["#df6d3f", "#d79837", "#7b9f3e"];
    state.contourSegments.forEach((segments, levelIndex) => {
      sliceCtx.save();
      sliceCtx.strokeStyle = contourColors[levelIndex % contourColors.length];
      sliceCtx.lineWidth = 1.6;
      sliceCtx.globalAlpha = 0.85;

      segments.forEach((segment) => {
        const p1 = projectToCanvas(model, segment.a.x, segment.a.y, width, height);
        const p2 = projectToCanvas(model, segment.b.x, segment.b.y, width, height);
        sliceCtx.beginPath();
        sliceCtx.moveTo(p1.x, p1.y);
        sliceCtx.lineTo(p2.x, p2.y);
        sliceCtx.stroke();
      });
      sliceCtx.restore();
    });
  }

  if (params.showFieldLines) {
    sliceCtx.save();
    sliceCtx.strokeStyle = "#2f7fb7";
    sliceCtx.lineWidth = 1.5;
    sliceCtx.globalAlpha = 0.9;

    state.meridianLines.forEach((line) => {
      if (line.length < 2) {
        return;
      }

      sliceCtx.beginPath();
      line.forEach((point, index) => {
        const canvasPoint = projectToCanvas(model, point.x, point.y, width, height);
        if (index === 0) {
          sliceCtx.moveTo(canvasPoint.x, canvasPoint.y);
        } else {
          sliceCtx.lineTo(canvasPoint.x, canvasPoint.y);
        }
      });
      sliceCtx.stroke();

      for (let i = 18; i < line.length - 1; i += 30) {
        const from = projectToCanvas(model, line[i - 1].x, line[i - 1].y, width, height);
        const to = projectToCanvas(model, line[i].x, line[i].y, width, height);
        drawArrowHead(sliceCtx, from, to, "#2f7fb7");
      }
    });
    sliceCtx.restore();
  }

  sliceCtx.save();
  sliceCtx.fillStyle = "rgba(25, 72, 78, 0.05)";
  sliceCtx.strokeStyle = "#19484e";
  sliceCtx.lineWidth = 3;
  sliceCtx.beginPath();
  sliceCtx.arc(center.x, center.y, radiusPixels, 0, Math.PI * 2);
  sliceCtx.fill();
  sliceCtx.stroke();
  sliceCtx.restore();

  const groundTop = projectToCanvas(model, 0, -model.radius, width, height);
  sliceCtx.save();
  sliceCtx.strokeStyle = "#19484e";
  sliceCtx.lineWidth = 2;
  sliceCtx.beginPath();
  sliceCtx.moveTo(groundTop.x, groundTop.y);
  sliceCtx.lineTo(groundTop.x, groundTop.y + 28);
  sliceCtx.moveTo(groundTop.x - 18, groundTop.y + 28);
  sliceCtx.lineTo(groundTop.x + 18, groundTop.y + 28);
  sliceCtx.moveTo(groundTop.x - 12, groundTop.y + 35);
  sliceCtx.lineTo(groundTop.x + 12, groundTop.y + 35);
  sliceCtx.moveTo(groundTop.x - 6, groundTop.y + 42);
  sliceCtx.lineTo(groundTop.x + 6, groundTop.y + 42);
  sliceCtx.stroke();
  sliceCtx.restore();

  sliceCtx.save();
  sliceCtx.strokeStyle = "rgba(25, 72, 78, 0.22)";
  sliceCtx.lineWidth = 1;
  sliceCtx.beginPath();
  sliceCtx.moveTo(leftMeasureX, center.y);
  sliceCtx.lineTo(center.x, center.y);
  sliceCtx.moveTo(leftMeasureX, topShell.y);
  sliceCtx.lineTo(center.x, topShell.y);
  sliceCtx.moveTo(rightMeasureX, topShell.y);
  sliceCtx.lineTo(center.x, topShell.y);
  sliceCtx.moveTo(rightMeasureX, chargePoint.y);
  sliceCtx.lineTo(center.x, chargePoint.y);
  sliceCtx.stroke();
  sliceCtx.restore();

  drawMeasureSegment(
    sliceCtx,
    leftMeasureX,
    center.y,
    topShell.y,
    `R = ${fmt(model.radius, 2)}`,
    "#19484e",
    { labelSide: "left" }
  );
  drawMeasureSegment(
    sliceCtx,
    rightMeasureX,
    topShell.y,
    chargePoint.y,
    `d = a - R = ${fmt(model.gap, 2)}`,
    "#c77434",
    { labelSide: "right" }
  );

  if (params.showImageCharge) {
    const imagePoint = projectToCanvas(model, 0, model.b, width, height);
    const imageMeasureX = center.x - Math.max(radiusPixels * 0.46, 56);
    const imageLabelX = center.x + Math.max(radiusPixels * 0.6, 68);
    const imageLabelY = imagePoint.y - 20;

    sliceCtx.save();
    sliceCtx.setLineDash([6, 5]);
    sliceCtx.strokeStyle = "rgba(96, 112, 120, 0.9)";
    sliceCtx.lineWidth = 2;
    sliceCtx.beginPath();
    sliceCtx.moveTo(imageMeasureX, center.y);
    sliceCtx.lineTo(imageMeasureX, imagePoint.y);
    sliceCtx.moveTo(imageMeasureX, center.y);
    sliceCtx.lineTo(center.x, center.y);
    sliceCtx.moveTo(imageMeasureX, imagePoint.y);
    sliceCtx.lineTo(center.x, imagePoint.y);
    sliceCtx.moveTo(imagePoint.x + 7, imagePoint.y - 3);
    sliceCtx.lineTo(imageLabelX - 12, imageLabelY);
    sliceCtx.stroke();
    sliceCtx.restore();

    drawMeasureSegment(
      sliceCtx,
      imageMeasureX,
      center.y,
      imagePoint.y,
      `b = ${fmt(model.b, 2)}`,
      "#607078",
      { labelSide: "left" }
    );

    sliceCtx.beginPath();
    sliceCtx.fillStyle = "rgba(96, 112, 120, 0.78)";
    sliceCtx.arc(imagePoint.x, imagePoint.y, 5, 0, Math.PI * 2);
    sliceCtx.fill();

    drawTextChip(sliceCtx, "A'", imageLabelX, imageLabelY, {
      align: "left",
      font: "700 17px 'Microsoft YaHei'",
      textColor: "#607078",
      fill: "rgba(255, 255, 255, 0.96)",
      stroke: "rgba(96, 112, 120, 0.18)",
    });
  }

  const labelOffsets = {
    A: { dx: 20, dy: -16, align: "left" },
    B: { dx: -18, dy: -28, align: "right" },
    O: { dx: 18, dy: 24, align: "left" },
    M: { dx: -20, dy: -18, align: "right" },
    N: { dx: 18, dy: -18, align: "left" },
  };

  Object.entries(model.points).forEach(([key, point]) => {
    const canvasPoint = projectToCanvas(model, point.x, point.y, width, height);

    if (key === "A") {
      sliceCtx.beginPath();
      sliceCtx.fillStyle = model.q > 0 ? "#e1583b" : "#2d72d2";
      sliceCtx.arc(canvasPoint.x, canvasPoint.y, 8, 0, Math.PI * 2);
      sliceCtx.fill();
    } else {
      sliceCtx.beginPath();
      sliceCtx.fillStyle = "#1b292c";
      sliceCtx.arc(canvasPoint.x, canvasPoint.y, 5, 0, Math.PI * 2);
      sliceCtx.fill();
    }

    sliceCtx.fillStyle = "#1b292c";
    sliceCtx.font = "italic 24px 'Times New Roman'";
    sliceCtx.lineWidth = 6;
    sliceCtx.strokeStyle = "rgba(255, 255, 255, 0.96)";
    const label = labelOffsets[key] || { dx: 14, dy: -10, align: "left" };
    const textX = canvasPoint.x + label.dx;
    const textY = canvasPoint.y + label.dy;
    sliceCtx.textAlign = label.align;
    sliceCtx.textBaseline = "middle";
    sliceCtx.strokeText(key, textX, textY);
    sliceCtx.fillText(key, textX, textY);
  });
}

function updateFormula(model) {
  if (!formulaBoard) {
    return;
  }

  const formulas = [
    "q' = -qR / a",
    "b = R² / a",
    "V = k(q / r₁ + q' / r₂)",
    "r < R  →  V = 0，E = 0",
  ];

  formulaBoard.innerHTML = formulas
    .map(
      (item) => `
        <div class="formula-line">
          <div class="formula-main">${item}</div>
        </div>
      `
    )
    .join("");
}

function createRenderer() {
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min((window.devicePixelRatio || 1) * 1.25, 3));
  renderer.setSize(sceneHost.clientWidth, sceneHost.clientHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0xf8f4ee, 1);
  sceneHost.innerHTML = "";
  sceneHost.appendChild(renderer.domElement);
  return renderer;
}

function initThree() {
  state.scene = new THREE.Scene();
  state.scene.background = new THREE.Color(0xf8f4ee);

  state.camera = new THREE.PerspectiveCamera(
    34,
    sceneHost.clientWidth / sceneHost.clientHeight,
    0.1,
    100
  );
  state.camera.position.set(5.2, 3.8, 5.4);

  state.renderer = createRenderer();
  state.controls = new THREE.OrbitControls(state.camera, state.renderer.domElement);
  state.controls.enableDamping = true;
  state.controls.dampingFactor = 0.06;
  state.controls.enablePan = false;
  state.controls.minDistance = 3.8;
  state.controls.maxDistance = 12;
  state.controls.minPolarAngle = 0.18;
  state.controls.maxPolarAngle = Math.PI - 0.2;
  state.controls.target.set(0, 0.5, 0);

  const ambient = new THREE.AmbientLight(0xffffff, 0.86);
  const hemisphere = new THREE.HemisphereLight(0xffffff, 0xe9dfd1, 0.72);
  const keyLight = new THREE.DirectionalLight(0xffffff, 1.25);
  keyLight.position.set(5.5, 8, 5.5);
  const fillLight = new THREE.DirectionalLight(0xe7f2ff, 0.55);
  fillLight.position.set(-7, 4, -4);
  const rimLight = new THREE.DirectionalLight(0xf6d7b6, 0.36);
  rimLight.position.set(3, 2, -7);
  state.scene.add(ambient, hemisphere, keyLight, fillLight, rimLight);

  state.shellGroup = new THREE.Group();
  state.fieldGroup = new THREE.Group();
  state.surfaceGroup = new THREE.Group();
  state.markerGroup = new THREE.Group();
  state.scene.add(state.surfaceGroup, state.fieldGroup, state.shellGroup, state.markerGroup);
}

function createPointLabelSprite(text, color = "#1b292c") {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "italic 56px 'Times New Roman'";
  ctx.lineWidth = 16;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.96)";
  ctx.strokeText(text, canvas.width / 2, canvas.height / 2);
  ctx.fillStyle = color;
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;

  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });

  const sprite = new THREE.Sprite(material);
  sprite.scale.set(0.72, 0.36, 1);
  return sprite;
}

function buildShell(model) {
  state.shellGroup.clear();
  state.markerGroup.clear();

  const shellMaterial = new THREE.MeshBasicMaterial({
    color: palette.shellFill,
    transparent: true,
    opacity: 0.24,
    side: THREE.DoubleSide,
  });
  const shellGeometry = new THREE.SphereGeometry(model.radius, 48, 36);
  const shellMesh = new THREE.Mesh(shellGeometry, shellMaterial);
  const wire = new THREE.LineSegments(
    new THREE.WireframeGeometry(shellGeometry),
    new THREE.LineBasicMaterial({
      color: palette.shellWire,
      transparent: true,
      opacity: 0.22,
    })
  );
  const shellRim = new THREE.Mesh(
    shellGeometry.clone(),
    new THREE.MeshBasicMaterial({
      color: palette.shell,
      side: THREE.BackSide,
      transparent: true,
      opacity: 0.09,
    })
  );
  shellRim.scale.setScalar(1.018);
  state.shellGroup.add(shellMesh, wire, shellRim);

  const axisMaterial = new THREE.LineDashedMaterial({
    color: 0x69a7c6,
    dashSize: 0.12,
    gapSize: 0.08,
    transparent: true,
    opacity: 0.65,
  });
  const axisGeometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, -model.viewExtent, 0),
    new THREE.Vector3(0, model.viewExtent, 0),
  ]);
  state.axisLine = new THREE.Line(axisGeometry, axisMaterial);
  state.axisLine.computeLineDistances();
  state.shellGroup.add(state.axisLine);

  const realChargeMaterial = new THREE.MeshStandardMaterial({
    color: model.q > 0 ? palette.positive : palette.negative,
    emissive: model.q > 0 ? palette.positive : palette.negative,
    emissiveIntensity: 0.32,
  });
  const realChargeGeometry = new THREE.SphereGeometry(model.chargeRadius, 24, 24);
  state.realChargeMesh = new THREE.Mesh(realChargeGeometry, realChargeMaterial);
  state.realChargeMesh.position.set(0, model.a, 0);
  state.shellGroup.add(state.realChargeMesh);

  const haloGeometry = new THREE.SphereGeometry(model.chargeRadius * 2.1, 24, 24);
  const haloMaterial = new THREE.MeshBasicMaterial({
    color: model.q > 0 ? palette.positive : palette.negative,
    transparent: true,
    opacity: 0.12,
  });
  state.realChargeHalo = new THREE.Mesh(haloGeometry, haloMaterial);
  state.realChargeHalo.position.copy(state.realChargeMesh.position);
  state.shellGroup.add(state.realChargeHalo);

  const imageMaterial = new THREE.MeshStandardMaterial({
    color: palette.image,
    transparent: true,
    opacity: params.showImageCharge ? 0.9 : 0,
  });
  state.imageChargeMesh = new THREE.Mesh(realChargeGeometry, imageMaterial);
  state.imageChargeMesh.position.set(0, model.b, 0);
  state.shellGroup.add(state.imageChargeMesh);

  if (params.showImageCharge) {
    const guideMaterial = new THREE.LineDashedMaterial({
      color: palette.image,
      dashSize: 0.08,
      gapSize: 0.05,
      transparent: true,
      opacity: 0.8,
    });
    const guideGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, model.b, 0),
      new THREE.Vector3(0, model.a, 0),
    ]);
    const guideLine = new THREE.Line(guideGeometry, guideMaterial);
    guideLine.computeLineDistances();
    state.shellGroup.add(guideLine);

    const imageHalo = new THREE.Mesh(
      new THREE.SphereGeometry(model.chargeRadius * 1.7, 18, 18),
      new THREE.MeshBasicMaterial({
        color: palette.image,
        transparent: true,
        opacity: 0.16,
      })
    );
    imageHalo.position.copy(state.imageChargeMesh.position);
    state.shellGroup.add(imageHalo);
  }

  const labelOffsets = {
    A: new THREE.Vector3(0.36, 0.18, 0),
    B: new THREE.Vector3(0.38, 0.16, 0),
    O: new THREE.Vector3(0.38, -0.22, 0),
    M: new THREE.Vector3(-0.34, 0.12, 0),
    N: new THREE.Vector3(0.34, 0.12, 0),
  };

  Object.entries(model.points)
    .filter(([name]) => name !== "A")
    .forEach(([name, point]) => {
      const marker = new THREE.Mesh(
        new THREE.SphereGeometry(model.radius * 0.025, 18, 18),
        new THREE.MeshStandardMaterial({ color: palette.point })
      );
      marker.position.set(point.x, point.y, 0);
      state.markerGroup.add(marker);

      const label = createPointLabelSprite(name);
      label.position.copy(marker.position).add(labelOffsets[name] || new THREE.Vector3(0.24, 0.14, 0));
      state.markerGroup.add(label);
    });

  const pointA = createPointLabelSprite("A", model.q > 0 ? "#e1583b" : "#2d72d2");
  pointA.position.copy(state.realChargeMesh.position).add(labelOffsets.A);
  state.markerGroup.add(pointA);
}

function buildFieldLineMeshes(model) {
  state.fieldGroup.clear();

  if (!params.showFieldLines) {
    return;
  }

  const azimuths = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2, Math.PI / 4, (5 * Math.PI) / 4];
  const haloMaterial = new THREE.MeshBasicMaterial({
    color: palette.fieldHalo,
    transparent: true,
    opacity: 0.16,
    depthWrite: false,
  });
  const coreMaterial = new THREE.MeshStandardMaterial({
    color: palette.fieldCore,
    emissive: palette.field,
    emissiveIntensity: 0.18,
    roughness: 0.32,
    metalness: 0.05,
  });
  const arrowGeometry = new THREE.ConeGeometry(model.radius * 0.02, model.radius * 0.075, 10);
  const arrowMaterial = new THREE.MeshStandardMaterial({
    color: palette.fieldCore,
    emissive: palette.field,
    emissiveIntensity: 0.24,
    roughness: 0.28,
    metalness: 0.04,
  });

  state.meridianLines.slice(0, 12).forEach((line, lineIndex) => {
    const radialProfile = compressProfile(
      line.map((point) => ({
        x: Math.abs(point.x),
        y: point.y,
      }))
    );

    azimuths.forEach((phi) => {
      const points = radialProfile.map(
        (point) => new THREE.Vector3(point.x * Math.cos(phi), point.y, point.x * Math.sin(phi))
      );
      if (points.length < 4) {
        return;
      }

      const curve = new THREE.CatmullRomCurve3(points, false, "centripetal", 0.35);
      const tubularSegments = Math.max(points.length * 3, 54);
      const haloGeometry = new THREE.TubeGeometry(curve, tubularSegments, model.radius * 0.0085, 6, false);
      const coreGeometry = new THREE.TubeGeometry(curve, tubularSegments, model.radius * 0.0038, 8, false);

      const haloMesh = new THREE.Mesh(haloGeometry, haloMaterial);
      haloMesh.renderOrder = 1;
      const coreMesh = new THREE.Mesh(coreGeometry, coreMaterial);
      coreMesh.renderOrder = 2;
      state.fieldGroup.add(haloMesh, coreMesh);

      if (lineIndex % 2 === 0) {
        [0.36, 0.68].forEach((t) => {
          const position = curve.getPointAt(t);
          const tangent = curve.getTangentAt(t).normalize();
          const arrow = new THREE.Mesh(arrowGeometry, arrowMaterial);
          arrow.position.copy(position).addScaledVector(tangent, model.radius * 0.02);
          arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tangent);
          arrow.renderOrder = 3;
          state.fieldGroup.add(arrow);
        });
      }
    });
  });
}

function buildEquipotentialMeshes(model) {
  state.surfaceGroup.clear();

  if (!params.showEquipotentialSurfaces) {
    return;
  }

  state.equipotentialProfiles.forEach((profiles, levelIndex) => {
    profiles.forEach((profile) => {
      const compact = compressProfile(profile);
      if (compact.length < 10) {
        return;
      }

      const points = compact.map(
        (point) => new THREE.Vector2(Math.max(Math.abs(point.x), 1e-3), point.y)
      );

      const geometry = new THREE.LatheGeometry(points, 72);
      const material = new THREE.MeshBasicMaterial({
        color: palette.equipotential[levelIndex % palette.equipotential.length],
        transparent: true,
        opacity: 0.07,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.renderOrder = 0;
      state.surfaceGroup.add(mesh);
    });
  });
}

function refreshComputation() {
  state.model = buildModel();
  state.viewExtent = state.model.viewExtent;
  state.meridianLines = buildFieldLines(state.model);

  const contours = buildContours(state.model);
  state.equipotentialLevels = contours.levels;
  state.contourSegments = contours.fullSegments;
  state.equipotentialProfiles = contours.halfProfiles;
  state.points = state.model.points;

  buildShell(state.model);
  buildFieldLineMeshes(state.model);
  buildEquipotentialMeshes(state.model);
  updateFormula(state.model);
  drawSlice(state.model);

  if (state.camera && !state.hasInitialFrame) {
    state.camera.position.set(5.8, 4.4, 6.1);
    state.controls.target.set(0, 0.9, 0);
    state.controls.update();
    state.hasInitialFrame = true;
  }
}

function resizeScene() {
  if (!state.renderer || !state.camera) {
    return;
  }
  const width = sceneHost.clientWidth;
  const height = sceneHost.clientHeight;
  state.camera.aspect = width / height;
  state.camera.updateProjectionMatrix();
  state.renderer.setSize(width, height);
}

function animate() {
  requestAnimationFrame(animate);
  if (state.controls) {
    state.controls.update();
  }
  if (state.renderer && state.scene && state.camera) {
    state.renderer.render(state.scene, state.camera);
  }
}

function attachEvents() {
  if (fieldToggle) {
    fieldToggle.addEventListener("change", (event) => {
      params.showFieldLines = event.target.checked;
      refreshComputation();
    });
  }

  if (surfaceToggle) {
    surfaceToggle.addEventListener("change", (event) => {
      params.showEquipotentialSurfaces = event.target.checked;
      refreshComputation();
    });
  }

  window.addEventListener("resize", () => {
    resizeScene();
    drawSlice(state.model);
  });
}

function updateFormula(model) {
  if (!formulaBoard) {
    return;
  }

  const formulas = ["q&prime; = -qR / a", "b = R<sup>2</sup> / a", "r &lt; R 时：V = 0，E = 0"];

  formulaBoard.innerHTML = formulas
    .map(
      (item) => `
        <div class="formula-line">
          <div class="formula-main">${item}</div>
        </div>
      `
    )
    .join("");
}

function init() {
  initThree();
  attachEvents();
  refreshComputation();
  resizeScene();
  animate();
}

init();
