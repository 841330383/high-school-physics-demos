import * as THREE from "./vendor/three.module.js";
import { OrbitControls } from "./vendor/OrbitControls.js";

const params = {
  radius: 1.4,
  distanceFactor: 1.85,
  chargeMagnitude: 1.0,
  chargeSign: -1,
  showFieldLines: true,
  showEquipotentialSurfaces: true,
  showImageCharge: false,
};

const sceneHost = document.querySelector("#scene3d");
const sliceCanvas = document.querySelector("#sliceCanvas");
const sliceCtx = sliceCanvas.getContext("2d");
const readoutList = document.querySelector("#readoutList");
const formulaText = document.querySelector("#formulaText");

const radiusInput = document.querySelector("#radiusInput");
const distanceInput = document.querySelector("#distanceInput");
const chargeInput = document.querySelector("#chargeInput");
const fieldToggle = document.querySelector("#fieldToggle");
const surfaceToggle = document.querySelector("#surfaceToggle");
const imageToggle = document.querySelector("#imageToggle");
const signToggle = document.querySelector("#signToggle");

const radiusValue = document.querySelector("#radiusValue");
const distanceValue = document.querySelector("#distanceValue");
const chargeValue = document.querySelector("#chargeValue");

const palette = {
  shell: 0x19484e,
  field: 0x2f7fb7,
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
};

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
  const a = radius * params.distanceFactor;
  const q = params.chargeMagnitude * params.chargeSign;
  const qi = -q * radius / a;
  const b = (radius * radius) / a;
  const extent = Math.max(radius * 3.4, a + radius * 1.8);

  const points = {
    A: { x: 0, y: a, label: "A（锁定外电荷）", kind: "charge" },
    B: { x: 0, y: radius * 0.42, label: "B（壳内）" },
    O: { x: 0, y: 0, label: "O（球心）" },
    M: { x: -radius * 1.45, y: radius * 0.58, label: "M（球外）" },
    N: { x: radius * 1.45, y: radius * 0.58, label: "N（球外）" },
  };

  return {
    radius,
    a,
    b,
    q,
    qi,
    extent,
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
  const scale = Math.min((width - margin * 2) / (model.extent * 2), (height - margin * 2) / (model.extent * 2));
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

function drawSlice(model) {
  const width = sliceCanvas.width;
  const height = sliceCanvas.height;

  sliceCtx.clearRect(0, 0, width, height);
  sliceCtx.fillStyle = "rgba(255,255,255,0.94)";
  sliceCtx.fillRect(0, 0, width, height);

  sliceCtx.save();
  sliceCtx.setLineDash([6, 6]);
  const axisTop = projectToCanvas(model, 0, model.extent, width, height);
  const axisBottom = projectToCanvas(model, 0, -model.extent, width, height);
  sliceCtx.strokeStyle = "rgba(47, 127, 183, 0.45)";
  sliceCtx.lineWidth = 2;
  sliceCtx.beginPath();
  sliceCtx.moveTo(axisTop.x, axisTop.y);
  sliceCtx.lineTo(axisBottom.x, axisBottom.y);
  sliceCtx.stroke();
  sliceCtx.restore();

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

  const center = projectToCanvas(model, 0, 0, width, height);
  const radiusPixels = center.scale * model.radius;

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

  if (params.showImageCharge) {
    const imagePoint = projectToCanvas(model, 0, model.b, width, height);
    sliceCtx.save();
    sliceCtx.setLineDash([6, 5]);
    sliceCtx.strokeStyle = "rgba(126, 143, 149, 0.8)";
    sliceCtx.lineWidth = 2;
    sliceCtx.beginPath();
    sliceCtx.arc(imagePoint.x, imagePoint.y, 9, 0, Math.PI * 2);
    sliceCtx.stroke();
    sliceCtx.restore();
    sliceCtx.fillStyle = "#607078";
    sliceCtx.font = "600 18px 'Microsoft YaHei'";
    sliceCtx.fillText("A'", imagePoint.x + 12, imagePoint.y - 12);
  }

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
    const xOffset = key === "M" ? -28 : 14;
    sliceCtx.fillText(key, canvasPoint.x + xOffset, canvasPoint.y - 10);
  });
}

function updateFormula(model) {
  formulaText.textContent =
    `q' = -qR / a = ${fmt(model.qi, 3)}\n` +
    `b = R² / a = ${fmt(model.b, 3)}\n` +
    `V_out = k(q / r₁ + q' / r₂)\n` +
    `r < R 时：V = 0，E = 0`;
}

function vectorText(field) {
  return `(${fmt(field.x, 3)}, ${fmt(field.y, 3)})`;
}

function updateReadouts(model) {
  const readouts = [
    {
      name: "A 点",
      text: `锁定外电荷 Q = ${model.q > 0 ? "+" : ""}${fmt(model.q, 2)}，位于球心上方 a = ${fmt(model.a, 2)}`,
    },
    ...["B", "O", "M", "N"].map((name) => {
      const point = model.points[name];
      const field = fieldAt(model, point.x, point.y);
      const magnitude = Math.hypot(field.x, field.y);
      const potential = potentialAt(model, point.x, point.y);

      return {
        name: `${name} 点`,
        text:
          `V = ${fmt(potential, 3)}，|E| = ${fmt(magnitude, 3)}，` +
          `E = ${vectorText(field)}`,
      };
    }),
  ];

  readoutList.innerHTML = readouts
    .map(
      (item) => `
        <article class="readout-card">
          <div class="readout-name">${item.name}</div>
          <div class="readout-value">${item.text}</div>
        </article>
      `
    )
    .join("");
}

function createRenderer() {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(sceneHost.clientWidth, sceneHost.clientHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  sceneHost.innerHTML = "";
  sceneHost.appendChild(renderer.domElement);
  return renderer;
}

function initThree() {
  state.scene = new THREE.Scene();
  state.scene.fog = new THREE.Fog(0xf4efe8, 11, 20);

  state.camera = new THREE.PerspectiveCamera(
    42,
    sceneHost.clientWidth / sceneHost.clientHeight,
    0.1,
    100
  );
  state.camera.position.set(5.2, 3.8, 5.4);

  state.renderer = createRenderer();
  state.controls = new OrbitControls(state.camera, state.renderer.domElement);
  state.controls.enableDamping = true;
  state.controls.target.set(0, 0.5, 0);

  const ambient = new THREE.AmbientLight(0xffffff, 0.95);
  const keyLight = new THREE.DirectionalLight(0xffffff, 1.1);
  keyLight.position.set(5, 7, 4);
  const fillLight = new THREE.DirectionalLight(0xf6e8d6, 0.55);
  fillLight.position.set(-6, 3, -5);
  state.scene.add(ambient, keyLight, fillLight);

  state.shellGroup = new THREE.Group();
  state.fieldGroup = new THREE.Group();
  state.surfaceGroup = new THREE.Group();
  state.markerGroup = new THREE.Group();
  state.scene.add(state.surfaceGroup, state.fieldGroup, state.shellGroup, state.markerGroup);
}

function buildShell(model) {
  state.shellGroup.clear();
  state.markerGroup.clear();

  const shellMaterial = new THREE.MeshPhysicalMaterial({
    color: palette.shell,
    transparent: true,
    opacity: 0.1,
    side: THREE.DoubleSide,
    roughness: 0.4,
    metalness: 0.08,
  });
  const shellGeometry = new THREE.SphereGeometry(model.radius, 72, 72);
  const shellMesh = new THREE.Mesh(shellGeometry, shellMaterial);
  const wire = new THREE.LineSegments(
    new THREE.WireframeGeometry(shellGeometry),
    new THREE.LineBasicMaterial({ color: palette.shell, transparent: true, opacity: 0.35 })
  );
  state.shellGroup.add(shellMesh, wire);

  const axisMaterial = new THREE.LineDashedMaterial({
    color: 0x69a7c6,
    dashSize: 0.12,
    gapSize: 0.08,
    transparent: true,
    opacity: 0.65,
  });
  const axisGeometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, -model.extent, 0),
    new THREE.Vector3(0, model.extent, 0),
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
    opacity: params.showImageCharge ? 0.6 : 0,
  });
  state.imageChargeMesh = new THREE.Mesh(realChargeGeometry, imageMaterial);
  state.imageChargeMesh.position.set(0, model.b, 0);
  state.shellGroup.add(state.imageChargeMesh);

  Object.entries(model.points)
    .filter(([name]) => name !== "A")
    .forEach(([, point]) => {
      const marker = new THREE.Mesh(
        new THREE.SphereGeometry(model.radius * 0.025, 18, 18),
        new THREE.MeshStandardMaterial({ color: palette.point })
      );
      marker.position.set(point.x, point.y, 0);
      state.markerGroup.add(marker);
    });
}

function buildFieldLineMeshes(model) {
  state.fieldGroup.clear();

  if (!params.showFieldLines) {
    return;
  }

  const azimuths = [0, Math.PI / 3, (2 * Math.PI) / 3, Math.PI, (4 * Math.PI) / 3, (5 * Math.PI) / 3];
  const lineMaterial = new THREE.LineBasicMaterial({
    color: palette.field,
    transparent: true,
    opacity: 0.88,
  });

  state.meridianLines.forEach((line) => {
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
      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      const mesh = new THREE.Line(geometry, lineMaterial);
      state.fieldGroup.add(mesh);
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
      const material = new THREE.MeshPhysicalMaterial({
        color: palette.equipotential[levelIndex % palette.equipotential.length],
        transparent: true,
        opacity: 0.12,
        roughness: 0.32,
        metalness: 0.04,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geometry, material);
      state.surfaceGroup.add(mesh);
    });
  });
}

function refreshComputation() {
  state.model = buildModel();
  state.viewExtent = state.model.extent;
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
  updateReadouts(state.model);
  drawSlice(state.model);

  radiusValue.textContent = fmt(state.model.radius, 2);
  distanceValue.textContent = `${fmt(state.model.a / state.model.radius, 2)} R`;
  chargeValue.textContent = `${state.model.q > 0 ? "+" : ""}${fmt(state.model.q, 2)}`;

  if (state.camera) {
    const viewDistance = Math.max(state.model.extent * 1.5, 5.4);
    state.camera.position.set(viewDistance * 0.74, viewDistance * 0.56, viewDistance * 0.78);
    state.controls.target.set(0, state.model.radius * 0.35, 0);
    state.controls.update();
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
  radiusInput.addEventListener("input", (event) => {
    params.radius = Number(event.target.value);
    refreshComputation();
  });

  distanceInput.addEventListener("input", (event) => {
    params.distanceFactor = Number(event.target.value);
    refreshComputation();
  });

  chargeInput.addEventListener("input", (event) => {
    params.chargeMagnitude = Number(event.target.value);
    refreshComputation();
  });

  fieldToggle.addEventListener("change", (event) => {
    params.showFieldLines = event.target.checked;
    refreshComputation();
  });

  surfaceToggle.addEventListener("change", (event) => {
    params.showEquipotentialSurfaces = event.target.checked;
    refreshComputation();
  });

  imageToggle.addEventListener("change", (event) => {
    params.showImageCharge = event.target.checked;
    refreshComputation();
  });

  signToggle.addEventListener("click", (event) => {
    const button = event.target.closest("[data-sign]");
    if (!button) {
      return;
    }
    params.chargeSign = Number(button.dataset.sign);
    updateSignButtons();
    refreshComputation();
  });

  window.addEventListener("resize", () => {
    resizeScene();
    drawSlice(state.model);
  });
}

function updateSignButtons() {
  signToggle.querySelectorAll("[data-sign]").forEach((button) => {
    button.classList.toggle("is-active", Number(button.dataset.sign) === params.chargeSign);
  });
}

function init() {
  updateSignButtons();
  initThree();
  attachEvents();
  refreshComputation();
  resizeScene();
  animate();
}

init();
