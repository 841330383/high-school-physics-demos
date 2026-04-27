const TAU = Math.PI * 2;

const state = {
  theta: 0,
  playing: true,
  speed: 1,
  showGraphs: true,
  showEnergy: true,
  lastTime: 0,
};

const nodes = {
  sceneHost: document.querySelector("#lcScene3d"),
  graphCanvas: document.querySelector("#graphCanvas"),
  playButton: document.querySelector("#playButton"),
  resetButton: document.querySelector("#resetButton"),
  timeSlider: document.querySelector("#timeSlider"),
  timeReadout: document.querySelector("#timeReadout"),
  graphToggle: document.querySelector("#graphToggle"),
  energyToggle: document.querySelector("#energyToggle"),
  graphPanel: document.querySelector("#graphPanel"),
  energyPanel: document.querySelector("#energyPanel"),
  electricBar: document.querySelector("#electricBar"),
  magneticBar: document.querySelector("#magneticBar"),
  electricValue: document.querySelector("#electricValue"),
  magneticValue: document.querySelector("#magneticValue"),
  phaseTitle: document.querySelector("#phaseTitle"),
  phaseText: document.querySelector("#phaseText"),
  chargeText: document.querySelector("#chargeText"),
  currentText: document.querySelector("#currentText"),
  particleText: document.querySelector("#particleText"),
  speedButtons: document.querySelectorAll(".speed-chip"),
  momentButtons: document.querySelectorAll(".moment-card"),
};

const threeState = {
  ready: false,
  scene: null,
  camera: null,
  renderer: null,
  controls: null,
  world: null,
  chargeDots: [],
  currentDots: [],
  fieldArrows: [],
  magneticRings: [],
  testCharge: null,
  forceArrow: null,
  forceLabel: null,
  plateTopMaterial: null,
  plateBottomMaterial: null,
  topChargeMaterial: null,
  bottomChargeMaterial: null,
  cameraMode: null,
};

function normalizeTheta(theta) {
  return ((theta % TAU) + TAU) % TAU;
}

function getCanvasContext(canvas) {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(320, rect.width);
  const height = Math.max(260, rect.height);
  const targetWidth = Math.round(width * dpr);
  const targetHeight = Math.round(height * dpr);

  if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
    canvas.width = targetWidth;
    canvas.height = targetHeight;
  }

  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, width, height };
}

function model(theta) {
  const t = normalizeTheta(theta);
  const q = Math.cos(t);
  const current = Math.sin(t);
  const electricEnergy = q * q;
  const magneticEnergy = current * current;

  let phaseTitle = "电容满电";
  let phaseText = "电场能最大，回路电流为零。";

  if (t >= Math.PI / 4 && t < (3 * Math.PI) / 4) {
    phaseTitle = "电容放电";
    phaseText = "电荷减少，电流逐渐增强，能量从电场转入磁场。";
  } else if (t >= (3 * Math.PI) / 4 && t < (5 * Math.PI) / 4) {
    phaseTitle = "反向满电";
    phaseText = "电容极板电性反向，电场能再次达到较大值。";
  } else if (t >= (5 * Math.PI) / 4 && t < (7 * Math.PI) / 4) {
    phaseTitle = "反向放电";
    phaseText = "电流方向反向，磁场能再次增加。";
  }

  return {
    t,
    q,
    current,
    electricEnergy,
    magneticEnergy,
    phaseTitle,
    phaseText,
  };
}

function clearCanvas(ctx, width, height) {
  ctx.clearRect(0, 0, width, height);
}

function drawArrow(ctx, x, y, angle, size, color, alpha = 1) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(size, 0);
  ctx.lineTo(-size * 0.65, -size * 0.48);
  ctx.lineTo(-size * 0.36, 0);
  ctx.lineTo(-size * 0.65, size * 0.48);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function strokeLine(ctx, x1, y1, x2, y2, color, width = 7) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.restore();
}

function drawCharges(ctx, cx, plateY, plateWidth, q, positivePlate) {
  const count = Math.max(7, Math.min(11, Math.round(plateWidth / 14)));
  const activeCount = Math.round(Math.abs(q) * count);
  const magnitude = Math.abs(q);
  const sign = positivePlate ? "+" : "-";
  const color = positivePlate ? "#ff3b30" : "#007aff";

  ctx.save();
  ctx.font = "700 18px SF Pro Display, Microsoft YaHei, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  for (let index = 0; index < count; index += 1) {
    const x = cx - plateWidth * 0.42 + (plateWidth * 0.84 * index) / (count - 1);
    const centerOffset = Math.abs(index - (count - 1) / 2);
    const activeLimit = activeCount / 2;
    const isActive = centerOffset < activeLimit;
    ctx.globalAlpha = isActive ? 0.9 : 0.14;
    ctx.fillStyle = isActive ? color : "#94a3b8";
    ctx.beginPath();
    ctx.arc(x, plateY, isActive ? 13 : 8, 0, TAU);
    ctx.fill();

    if (isActive) {
      ctx.fillStyle = "#fff";
      ctx.fillText(sign, x, plateY + 1);
    }
  }

  ctx.globalAlpha = 1;
  ctx.fillStyle = color;
  ctx.font = "800 13px SF Pro Display, Microsoft YaHei, sans-serif";
  ctx.fillText(`${Math.round(magnitude * 100)}%`, cx + plateWidth * 0.62, plateY + 5);
  ctx.restore();
}

function drawElectricField(ctx, cx, y1, y2, plateWidth, q) {
  const magnitude = Math.abs(q);
  if (magnitude < 0.05) {
    return;
  }

  const fromTop = q > 0;
  const startY = fromTop ? y1 + 22 : y2 - 22;
  const endY = fromTop ? y2 - 22 : y1 + 22;
  const angle = fromTop ? Math.PI / 2 : -Math.PI / 2;

  ctx.save();
  ctx.strokeStyle = `rgba(255, 149, 0, ${0.2 + magnitude * 0.55})`;
  ctx.lineWidth = 2.2;
  ctx.setLineDash([8, 10]);

  [-0.32, 0, 0.32].forEach((ratio) => {
    const x = cx + plateWidth * ratio;
    ctx.beginPath();
    ctx.moveTo(x, startY);
    ctx.lineTo(x, endY);
    ctx.stroke();
    drawArrow(ctx, x, (startY + endY) / 2, angle, 9, "#ff9500", 0.34 + magnitude * 0.6);
  });

  ctx.restore();
}

function drawTestCharge(ctx, cx, topY, bottomY, plateWidth, q, showLabel = true) {
  const gap = bottomY - topY;
  const midY = (topY + bottomY) / 2;
  const particleY = midY + q * gap * 0.22;
  const fieldDown = q > 0;
  const magnitude = Math.abs(q);
  const forceLength = 14 + magnitude * 24;
  const forceAngle = fieldDown ? Math.PI / 2 : -Math.PI / 2;
  const alpha = 0.24 + magnitude * 0.68;

  ctx.save();
  ctx.strokeStyle = "rgba(17, 24, 39, 0.12)";
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 8]);
  ctx.beginPath();
  ctx.moveTo(cx, topY + 8);
  ctx.lineTo(cx, bottomY - 8);
  ctx.stroke();
  ctx.setLineDash([]);

  for (let offset = 1; offset <= 3; offset += 1) {
    const ghostTheta = state.theta - offset * 0.38;
    const ghostY = midY + Math.cos(ghostTheta) * gap * 0.28;
    ctx.globalAlpha = 0.16 / offset;
    ctx.fillStyle = "#ff9500";
    ctx.beginPath();
    ctx.arc(cx, ghostY, 13 - offset * 1.5, 0, TAU);
    ctx.fill();
  }

  ctx.globalAlpha = 1;
  ctx.fillStyle = "#fff7ed";
  ctx.strokeStyle = "#ff9500";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(cx, particleY, 15, 0, TAU);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#ff9500";
  ctx.font = "800 18px SF Pro Display, Microsoft YaHei, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("+", cx, particleY + 1);

  if (magnitude > 0.04) {
    ctx.strokeStyle = `rgba(255, 149, 0, ${alpha})`;
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(cx + plateWidth * 0.32, particleY);
    ctx.lineTo(
      cx + plateWidth * 0.32,
      particleY + (fieldDown ? forceLength : -forceLength)
    );
    ctx.stroke();
    drawArrow(
      ctx,
      cx + plateWidth * 0.32,
      particleY + (fieldDown ? forceLength : -forceLength),
      forceAngle,
      10,
      "#ff9500",
      alpha
    );
  }

  if (showLabel) {
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = "#92400e";
    ctx.font = "800 13px SF Pro Display, Microsoft YaHei, sans-serif";
    ctx.fillText("正试探电荷", cx + plateWidth * 0.42, particleY + 4);
  }
  ctx.restore();
}

function drawCurrentPackets(ctx, points, clockwise, current) {
  const magnitude = Math.abs(current);
  if (magnitude < 0.06) {
    return;
  }

  const route = clockwise ? points : [...points].reverse();
  const segments = [];
  let total = 0;

  for (let index = 0; index < route.length - 1; index += 1) {
    const start = route[index];
    const end = route[index + 1];
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    segments.push({ start, end, length });
    total += length;
  }

  ctx.save();
  ctx.fillStyle = "#007aff";
  ctx.globalAlpha = 0.24 + magnitude * 0.62;

  for (let index = 0; index < 10; index += 1) {
    let distance = (((state.theta / TAU) * total * 2.2 + (index / 10) * total) % total + total) % total;
    let segment = segments[0];

    for (const item of segments) {
      if (distance <= item.length) {
        segment = item;
        break;
      }
      distance -= item.length;
    }

    const ratio = segment.length ? distance / segment.length : 0;
    const x = segment.start.x + (segment.end.x - segment.start.x) * ratio;
    const y = segment.start.y + (segment.end.y - segment.start.y) * ratio;
    const pulse = 0.75 + 0.25 * Math.sin(state.theta * 3 + index);

    ctx.beginPath();
    ctx.arc(x, y, (4.5 + magnitude * 4) * pulse, 0, TAU);
    ctx.fill();
  }

  ctx.restore();
}

function drawCoil(ctx, x, topY, bottomY, current, scale = 1) {
  const loops = 6;
  const amp = 32 * scale;
  const length = bottomY - topY;
  const steps = 220;
  const magnitude = Math.abs(current);

  ctx.save();
  ctx.lineWidth = 7;
  ctx.lineCap = "round";
  ctx.strokeStyle = "#1f2937";
  ctx.beginPath();

  for (let step = 0; step <= steps; step += 1) {
    const progress = step / steps;
    const y = topY + progress * length;
    const wave = Math.sin(progress * loops * TAU);
    const px = x + wave * amp;
    if (step === 0) {
      ctx.moveTo(px, y);
    } else {
      ctx.lineTo(px, y);
    }
  }

  ctx.stroke();
  ctx.lineWidth = 2.4;
  ctx.strokeStyle = `rgba(52, 199, 89, ${0.18 + magnitude * 0.56})`;
  ctx.setLineDash([8, 9]);

  for (let index = 0; index < 4; index += 1) {
    const cy = topY + length * (0.18 + index * 0.21);
    ctx.beginPath();
    ctx.ellipse(x, cy, (76 + index * 6) * scale, (28 + index * 4) * scale, 0, 0, TAU);
    ctx.stroke();
  }

  ctx.setLineDash([]);
  ctx.fillStyle = `rgba(52, 199, 89, ${0.2 + magnitude * 0.58})`;
  ctx.font = "800 20px SF Pro Display, Microsoft YaHei, sans-serif";
  ctx.fillText("B", x + 86 * scale, topY + length * 0.47);
  ctx.restore();
}

function makeStandardMaterial(color, options = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.42,
    metalness: 0.08,
    transparent: options.transparent || false,
    opacity: options.opacity ?? 1,
    emissive: options.emissive || 0x000000,
    emissiveIntensity: options.emissiveIntensity || 0,
  });
}

function createTextSprite(text, color = "#111827", fontSize = 44) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 160;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.font = `800 ${fontSize}px SF Pro Display, Microsoft YaHei, sans-serif`;
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
    })
  );
  sprite.scale.set(0.9, 0.28, 1);
  return sprite;
}

function createCylinderBetween(start, end, radius, material) {
  const direction = new THREE.Vector3().subVectors(end, start);
  const length = direction.length();
  const geometry = new THREE.CylinderGeometry(radius, radius, length, 18);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.copy(start).add(end).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  return mesh;
}

function createArrow3D(color, radius = 0.025, length = 0.56) {
  const group = new THREE.Group();
  const shaftMaterial = makeStandardMaterial(color, {
    transparent: true,
    opacity: 0.86,
    emissive: color,
    emissiveIntensity: 0.12,
  });
  const headMaterial = makeStandardMaterial(color, {
    transparent: true,
    opacity: 0.92,
    emissive: color,
    emissiveIntensity: 0.2,
  });
  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, length * 0.7, 14),
    shaftMaterial
  );
  shaft.position.y = length * 0.35;
  const head = new THREE.Mesh(
    new THREE.ConeGeometry(radius * 3.4, length * 0.24, 18),
    headMaterial
  );
  head.position.y = length * 0.82;
  group.add(shaft, head);
  group.userData.materials = [shaftMaterial, headMaterial];
  group.userData.baseLength = length;
  return group;
}

function setArrow3D(arrow, start, end, opacity = 1) {
  const direction = new THREE.Vector3().subVectors(end, start);
  const length = direction.length();
  if (length < 0.001) {
    arrow.visible = false;
    return;
  }

  arrow.visible = true;
  arrow.position.copy(start);
  arrow.scale.setScalar(length / arrow.userData.baseLength);
  arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  arrow.userData.materials.forEach((material) => {
    material.opacity = opacity;
  });
}

function createCoilMesh() {
  const points = [];
  const loops = 7;
  const topY = 0.96;
  const bottomY = -0.96;

  for (let step = 0; step <= 260; step += 1) {
    const p = step / 260;
    const angle = p * loops * TAU;
    points.push(
      new THREE.Vector3(
        2.1 + Math.sin(angle) * 0.22,
        topY + (bottomY - topY) * p,
        Math.cos(angle) * 0.22
      )
    );
  }

  const curve = new THREE.CatmullRomCurve3(points);
  return new THREE.Mesh(
    new THREE.TubeGeometry(curve, 260, 0.035, 12, false),
    makeStandardMaterial(0x1f2937, { emissive: 0x111827, emissiveIntensity: 0.04 })
  );
}

function getPathPoint(points, progress) {
  const segments = [];
  let total = 0;
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    const length = start.distanceTo(end);
    segments.push({ start, end, length });
    total += length;
  }

  let distance = (((progress % 1) + 1) % 1) * total;
  for (const segment of segments) {
    if (distance <= segment.length) {
      return segment.start.clone().lerp(segment.end, distance / segment.length);
    }
    distance -= segment.length;
  }

  return points[points.length - 1].clone();
}

function initThreeScene() {
  if (threeState.ready || !nodes.sceneHost || !window.THREE) {
    return;
  }

  const host = nodes.sceneHost;
  threeState.scene = new THREE.Scene();
  threeState.scene.background = new THREE.Color(0xf8fafc);
  threeState.camera = new THREE.PerspectiveCamera(
    36,
    host.clientWidth / host.clientHeight,
    0.1,
    100
  );
  threeState.camera.position.set(3.9, 2.45, 5.4);

  threeState.renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false,
    powerPreference: "high-performance",
  });
  threeState.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  threeState.renderer.setSize(host.clientWidth, host.clientHeight);
  if (THREE.SRGBColorSpace) {
    threeState.renderer.outputColorSpace = THREE.SRGBColorSpace;
  }
  host.innerHTML = "";
  host.appendChild(threeState.renderer.domElement);

  threeState.controls = new THREE.OrbitControls(threeState.camera, threeState.renderer.domElement);
  threeState.controls.enableDamping = true;
  threeState.controls.dampingFactor = 0.08;
  threeState.controls.enablePan = false;
  threeState.controls.minDistance = 3.4;
  threeState.controls.maxDistance = 8.2;
  threeState.controls.target.set(0, 0, 0);

  const ambient = new THREE.AmbientLight(0xffffff, 0.86);
  const hemisphere = new THREE.HemisphereLight(0xffffff, 0xdbeafe, 0.8);
  const key = new THREE.DirectionalLight(0xffffff, 1.4);
  key.position.set(4, 5, 5);
  const fill = new THREE.DirectionalLight(0xdff5ff, 0.6);
  fill.position.set(-5, 3, -4);
  threeState.scene.add(ambient, hemisphere, key, fill);

  const world = new THREE.Group();
  threeState.scene.add(world);
  threeState.world = world;

  const wireMaterial = makeStandardMaterial(0x172a32);
  const wirePoints = {
    leftTop: new THREE.Vector3(-2.38, 1.25, 0),
    leftUpperGap: new THREE.Vector3(-2.38, 0.62, 0),
    leftLowerGap: new THREE.Vector3(-2.38, -0.62, 0),
    leftBottom: new THREE.Vector3(-2.38, -1.25, 0),
    rightTop: new THREE.Vector3(2.1, 1.25, 0),
    coilTop: new THREE.Vector3(2.1, 0.96, 0),
    coilBottom: new THREE.Vector3(2.1, -0.96, 0),
    rightBottom: new THREE.Vector3(2.1, -1.25, 0),
  };
  [
    [wirePoints.leftTop, wirePoints.rightTop],
    [wirePoints.rightTop, wirePoints.coilTop],
    [wirePoints.coilBottom, wirePoints.rightBottom],
    [wirePoints.rightBottom, wirePoints.leftBottom],
    [wirePoints.leftTop, wirePoints.leftUpperGap],
    [wirePoints.leftLowerGap, wirePoints.leftBottom],
  ].forEach(([start, end]) => {
    world.add(createCylinderBetween(start, end, 0.035, wireMaterial));
  });

  const grid = new THREE.GridHelper(6, 12, 0xdbe7f1, 0xeaf1f7);
  grid.position.y = -1.55;
  grid.material.transparent = true;
  grid.material.opacity = 0.46;
  world.add(grid);

  threeState.plateTopMaterial = makeStandardMaterial(0xffd7d7, {
    emissive: 0xff3b30,
    emissiveIntensity: 0.08,
  });
  threeState.plateBottomMaterial = makeStandardMaterial(0xd7e9ff, {
    emissive: 0x007aff,
    emissiveIntensity: 0.08,
  });
  const plateGeometry = new THREE.BoxGeometry(1.15, 0.055, 0.88);
  const topPlate = new THREE.Mesh(plateGeometry, threeState.plateTopMaterial);
  topPlate.position.set(-2.38, 0.48, 0);
  const bottomPlate = new THREE.Mesh(plateGeometry, threeState.plateBottomMaterial);
  bottomPlate.position.set(-2.38, -0.48, 0);
  world.add(topPlate, bottomPlate);

  threeState.topChargeMaterial = makeStandardMaterial(0xff3b30, {
    emissive: 0xff3b30,
    emissiveIntensity: 0.26,
  });
  threeState.bottomChargeMaterial = makeStandardMaterial(0x007aff, {
    emissive: 0x007aff,
    emissiveIntensity: 0.26,
  });
  const chargeGeometry = new THREE.SphereGeometry(0.07, 18, 18);
  const chargePositions = [];
  [-0.42, -0.28, -0.14, 0, 0.14, 0.28, 0.42].forEach((x) => {
    [-0.26, 0, 0.26].forEach((z) => chargePositions.push({ x, z }));
  });
  chargePositions.forEach((offset, index) => {
    const top = new THREE.Mesh(chargeGeometry, threeState.topChargeMaterial);
    top.position.set(-2.38 + offset.x, 0.59, offset.z);
    const bottom = new THREE.Mesh(chargeGeometry, threeState.bottomChargeMaterial);
    bottom.position.set(-2.38 + offset.x, -0.59, offset.z);
    threeState.chargeDots.push({ mesh: top, plate: "top", index });
    threeState.chargeDots.push({ mesh: bottom, plate: "bottom", index });
    world.add(top, bottom);
  });

  [-0.28, 0, 0.28].forEach((x) => {
    const arrow = createArrow3D(0xff9500, 0.018, 0.62);
    arrow.position.set(-2.38 + x, 0.26, 0);
    threeState.fieldArrows.push({ arrow, x });
    world.add(arrow);
  });

  const particleMaterial = makeStandardMaterial(0xff9500, {
    emissive: 0xff9500,
    emissiveIntensity: 0.32,
  });
  threeState.testCharge = new THREE.Mesh(new THREE.SphereGeometry(0.12, 28, 28), particleMaterial);
  threeState.testCharge.position.set(-2.38, 0, 0.06);
  world.add(threeState.testCharge);
  const particleLabel = createTextSprite("+ 试探电荷", "#92400e", 36);
  particleLabel.position.set(-1.58, 0.12, 0.46);
  particleLabel.scale.set(1.18, 0.34, 1);
  threeState.forceLabel = particleLabel;
  world.add(particleLabel);
  threeState.forceArrow = createArrow3D(0xff9500, 0.02, 0.5);
  world.add(threeState.forceArrow);

  world.add(createCoilMesh());
  [0.72, 0.24, -0.24, -0.72].forEach((y) => {
    const material = new THREE.MeshBasicMaterial({
      color: 0x34c759,
      transparent: true,
      opacity: 0.2,
      depthWrite: false,
    });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.58, 0.009, 8, 96), material);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(2.1, y, 0);
    threeState.magneticRings.push(ring);
    world.add(ring);
  });

  const currentMaterial = makeStandardMaterial(0x007aff, {
    transparent: true,
    opacity: 0.78,
    emissive: 0x007aff,
    emissiveIntensity: 0.36,
  });
  for (let index = 0; index < 14; index += 1) {
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.045, 16, 16), currentMaterial);
    threeState.currentDots.push(dot);
    world.add(dot);
  }

  const cLabel = createTextSprite("C", "#111827", 48);
  cLabel.position.set(-1.42, 0, 0.22);
  const lLabel = createTextSprite("L", "#111827", 48);
  lLabel.position.set(2.72, 1.18, 0.18);
  world.add(cLabel, lLabel);

  threeState.ready = true;
}

function resizeThreeScene() {
  if (!threeState.ready || !nodes.sceneHost) {
    return;
  }

  const width = nodes.sceneHost.clientWidth;
  const height = nodes.sceneHost.clientHeight;
  if (width <= 0 || height <= 0) {
    return;
  }

  const cameraMode = width < 520 ? "narrow" : "wide";
  if (threeState.cameraMode !== cameraMode) {
    if (cameraMode === "narrow") {
      threeState.camera.position.set(5.7, 3.1, 8.5);
    } else {
      threeState.camera.position.set(3.9, 2.45, 5.4);
    }
    threeState.controls.target.set(0, 0, 0);
    threeState.cameraMode = cameraMode;
  }

  threeState.camera.aspect = width / height;
  threeState.camera.fov = cameraMode === "narrow" ? 44 : 36;
  threeState.camera.updateProjectionMatrix();
  threeState.renderer.setSize(width, height, false);
}

function updateThreeScene() {
  initThreeScene();
  if (!threeState.ready) {
    return;
  }

  resizeThreeScene();
  const data = model(state.theta);
  const qAbs = Math.abs(data.q);
  const iAbs = Math.abs(data.current);
  const sceneAspect = nodes.sceneHost.clientWidth / nodes.sceneHost.clientHeight;
  const sceneScale = sceneAspect < 0.86 ? 0.6 : sceneAspect < 1.08 ? 0.88 : 1;
  const topPositive = data.q >= 0;
  const topColor = topPositive ? 0xff3b30 : 0x007aff;
  const bottomColor = topPositive ? 0x007aff : 0xff3b30;
  const activeCharges = Math.round(qAbs * 21);

  threeState.plateTopMaterial.color.setHex(topPositive ? 0xffd7d7 : 0xd7e9ff);
  threeState.plateBottomMaterial.color.setHex(topPositive ? 0xd7e9ff : 0xffd7d7);
  threeState.topChargeMaterial.color.setHex(topColor);
  threeState.topChargeMaterial.emissive.setHex(topColor);
  threeState.bottomChargeMaterial.color.setHex(bottomColor);
  threeState.bottomChargeMaterial.emissive.setHex(bottomColor);

  threeState.chargeDots.forEach(({ mesh, index }) => {
    mesh.visible = index < activeCharges;
    const pulse = 0.85 + 0.15 * Math.sin(state.theta * 3 + index);
    mesh.scale.setScalar(pulse);
  });

  const fieldDirection = data.q >= 0 ? -1 : 1;
  threeState.fieldArrows.forEach(({ arrow, x }) => {
    const start = new THREE.Vector3(-2.38 + x, fieldDirection > 0 ? -0.22 : 0.22, 0);
    const end = new THREE.Vector3(-2.38 + x, fieldDirection > 0 ? 0.22 : -0.22, 0);
    setArrow3D(arrow, start, end, qAbs > 0.04 ? 0.22 + qAbs * 0.62 : 0);
    arrow.visible = qAbs > 0.04;
  });

  threeState.testCharge.position.y = data.q * 0.26;
  threeState.forceLabel.position.y = threeState.testCharge.position.y + 0.08;
  const forceStart = threeState.testCharge.position.clone().add(new THREE.Vector3(0.23, 0, 0));
  const forceEnd = forceStart.clone().add(new THREE.Vector3(0, fieldDirection * qAbs * 0.54, 0));
  setArrow3D(threeState.forceArrow, forceStart, forceEnd, qAbs > 0.04 ? 0.78 : 0);
  threeState.forceArrow.visible = qAbs > 0.04;

  threeState.magneticRings.forEach((ring, index) => {
    ring.material.opacity = 0.08 + iAbs * 0.34;
    const pulse = 1 + iAbs * 0.08 * Math.sin(state.theta * 4 + index);
    ring.scale.set(pulse, pulse, pulse);
  });

  const basePath = [
    new THREE.Vector3(-2.38, 1.25, 0),
    new THREE.Vector3(2.1, 1.25, 0),
    new THREE.Vector3(2.1, -1.25, 0),
    new THREE.Vector3(-2.38, -1.25, 0),
  ];
  const path = data.current > 0 ? basePath : [...basePath].reverse();
  threeState.currentDots.forEach((dot, index) => {
    dot.visible = iAbs > 0.05;
    dot.position.copy(getPathPoint(path, state.theta / TAU + index / threeState.currentDots.length));
    dot.scale.setScalar(0.6 + iAbs * 1.35);
  });

  threeState.world.scale.setScalar(sceneScale);
  threeState.world.position.x = sceneAspect < 0.86 ? -0.1 : 0;
  threeState.world.rotation.y = Math.sin(state.theta * 0.35) * 0.04;
  threeState.controls.update();
  threeState.renderer.render(threeState.scene, threeState.camera);
}

function drawCircuit() {
  updateThreeScene();
}

function drawGraph() {
  if (!state.showGraphs) {
    return;
  }

  const { ctx, width, height } = getCanvasContext(nodes.graphCanvas);
  clearCanvas(ctx, width, height);

  const left = 54;
  const right = width - 28;
  const top = 34;
  const bottom = height - 42;
  const mid = (top + bottom) / 2;
  const amp = (bottom - top) * 0.34;
  const plotWidth = right - left;
  const theta = normalizeTheta(state.theta);

  ctx.save();
  ctx.strokeStyle = "rgba(17, 24, 39, 0.12)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(left, mid);
  ctx.lineTo(right, mid);
  ctx.moveTo(left, top);
  ctx.lineTo(left, bottom);
  ctx.stroke();

  ctx.fillStyle = "#667085";
  ctx.font = "700 13px SF Pro Display, Microsoft YaHei, sans-serif";
  ctx.fillText("0", left - 20, mid + 5);
  ctx.fillText("T/4", left + plotWidth * 0.25 - 12, bottom + 24);
  ctx.fillText("T/2", left + plotWidth * 0.5 - 12, bottom + 24);
  ctx.fillText("3T/4", left + plotWidth * 0.75 - 16, bottom + 24);
  ctx.fillText("T", right - 8, bottom + 24);

  function curve(color, fn) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let step = 0; step <= 360; step += 1) {
      const p = step / 360;
      const x = left + p * plotWidth;
      const y = mid - fn(p * TAU) * amp;
      if (step === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
  }

  curve("#007aff", (t) => Math.cos(t));
  curve("#34c759", (t) => Math.sin(t));

  const markerX = left + (theta / TAU) * plotWidth;
  ctx.strokeStyle = "rgba(255, 149, 0, 0.86)";
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 7]);
  ctx.beginPath();
  ctx.moveTo(markerX, top);
  ctx.lineTo(markerX, bottom);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = "#007aff";
  ctx.beginPath();
  ctx.arc(markerX, mid - Math.cos(theta) * amp, 5, 0, TAU);
  ctx.fill();
  ctx.fillStyle = "#34c759";
  ctx.beginPath();
  ctx.arc(markerX, mid - Math.sin(theta) * amp, 5, 0, TAU);
  ctx.fill();

  ctx.font = "800 14px SF Pro Display, Microsoft YaHei, sans-serif";
  ctx.fillStyle = "#007aff";
  ctx.fillText("q-t", right - 68, top + 10);
  ctx.fillStyle = "#34c759";
  ctx.fillText("i-t", right - 68, top + 32);
  ctx.restore();
}

function updateReadouts() {
  const data = model(state.theta);
  const progress = normalizeTheta(state.theta) / TAU;
  const electricPercent = Math.round(data.electricEnergy * 100);
  const magneticPercent = Math.round(data.magneticEnergy * 100);
  const currentSmall = Math.abs(data.current) < 0.035;
  const chargeSmall = Math.abs(data.q) < 0.035;

  nodes.timeSlider.value = String(Math.round(progress * 1000));
  nodes.timeReadout.textContent = `${progress.toFixed(2)}T`;
  nodes.phaseTitle.textContent = data.phaseTitle;
  nodes.phaseText.textContent = data.phaseText;

  if (chargeSmall) {
    nodes.chargeText.textContent = "电容器恰好放完电";
  } else if (data.q > 0) {
    nodes.chargeText.textContent = "上正下负，电荷数量随 |q| 变化";
  } else {
    nodes.chargeText.textContent = "上负下正，电荷数量随 |q| 变化";
  }

  if (currentSmall) {
    nodes.currentText.textContent = "电流为零，自感电动势较大";
  } else if (data.current > 0) {
    nodes.currentText.textContent = chargeSmall
      ? "电流最大，自感电动势最小"
      : "顺时针，正在向线圈转移能量";
  } else {
    nodes.currentText.textContent = chargeSmall
      ? "反向电流最大，自感电动势最小"
      : "逆时针，电容反向充放电";
  }

  if (chargeSmall) {
    nodes.particleText.textContent = "电场近零，粒子回到中线附近";
  } else if (data.q > 0) {
    nodes.particleText.textContent = "正试探电荷向下偏转";
  } else {
    nodes.particleText.textContent = "正试探电荷向上偏转";
  }

  nodes.electricBar.style.width = `${electricPercent}%`;
  nodes.magneticBar.style.width = `${magneticPercent}%`;
  nodes.electricValue.textContent = `${electricPercent}%`;
  nodes.magneticValue.textContent = `${magneticPercent}%`;

  nodes.momentButtons.forEach((button) => {
    const target = Number(button.dataset.theta || 0);
    const distance = Math.abs(Math.atan2(Math.sin(data.t - target), Math.cos(data.t - target)));
    button.classList.toggle("is-active", distance < Math.PI / 8);
  });
}

function render() {
  drawCircuit();
  drawGraph();
  updateReadouts();
}

function updatePlayButton() {
  nodes.playButton.textContent = state.playing ? "暂停" : "播放";
}

function animate(time) {
  if (!state.lastTime) {
    state.lastTime = time;
  }

  const delta = Math.min(48, time - state.lastTime);
  state.lastTime = time;

  if (state.playing) {
    state.theta = normalizeTheta(state.theta + delta * 0.00105 * state.speed);
  }

  render();
  requestAnimationFrame(animate);
}

nodes.playButton.addEventListener("click", () => {
  state.playing = !state.playing;
  updatePlayButton();
});

nodes.resetButton.addEventListener("click", () => {
  state.theta = 0;
  state.playing = true;
  updatePlayButton();
  render();
});

nodes.timeSlider.addEventListener("input", (event) => {
  state.theta = (Number(event.target.value) / 1000) * TAU;
  state.playing = false;
  updatePlayButton();
  render();
});

nodes.speedButtons.forEach((button) => {
  button.addEventListener("click", () => {
    state.speed = Number(button.dataset.speed || 1);
    nodes.speedButtons.forEach((item) => item.classList.toggle("is-active", item === button));
  });
});

nodes.graphToggle.addEventListener("change", (event) => {
  state.showGraphs = event.target.checked;
  nodes.graphPanel.classList.toggle("is-collapsed", !state.showGraphs);
  render();
});

nodes.energyToggle.addEventListener("change", (event) => {
  state.showEnergy = event.target.checked;
  nodes.energyPanel.classList.toggle("is-collapsed", !state.showEnergy);
});

nodes.momentButtons.forEach((button) => {
  button.addEventListener("click", () => {
    state.theta = normalizeTheta(Number(button.dataset.theta || 0));
    state.playing = false;
    updatePlayButton();
    render();
  });
});

window.addEventListener("resize", render);

updatePlayButton();
requestAnimationFrame(animate);
