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
  circuitCanvas: document.querySelector("#circuitCanvas"),
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
  speedButtons: document.querySelectorAll(".speed-chip"),
  momentButtons: document.querySelectorAll(".moment-card"),
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
  const current = -Math.sin(t);
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
  const count = Math.max(5, Math.min(9, Math.round(plateWidth / 16)));
  const magnitude = Math.abs(q);
  const sign = positivePlate ? "+" : "-";
  const color = positivePlate ? "#ff3b30" : "#007aff";

  ctx.save();
  ctx.globalAlpha = 0.22 + magnitude * 0.78;
  ctx.fillStyle = color;
  ctx.font = "700 18px SF Pro Display, Microsoft YaHei, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  for (let index = 0; index < count; index += 1) {
    const x = cx - plateWidth * 0.42 + (plateWidth * 0.84 * index) / (count - 1);
    ctx.beginPath();
    ctx.arc(x, plateY, 13, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.fillText(sign, x, plateY + 1);
    ctx.fillStyle = color;
  }

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

function drawCircuit() {
  const { ctx, width, height } = getCanvasContext(nodes.circuitCanvas);
  const data = model(state.theta);
  const compact = width < 520;
  const coilScale = compact ? 0.52 : width < 760 ? 0.82 : 1;
  const leftX = width * (compact ? 0.3 : 0.24);
  const rightX = width * (compact ? 0.62 : 0.77);
  const topY = height * 0.22;
  const bottomY = height * 0.72;
  const capTopY = height * 0.41;
  const capBottomY = height * 0.52;
  const plateWidth = Math.min(150, width * 0.22);
  const coilTopY = topY + 42;
  const coilBottomY = bottomY - 42;
  const wireColor = "#172a32";
  const currentColor = "#007aff";
  const currentMagnitude = Math.abs(data.current);
  const currentAlpha = Math.max(0.18, currentMagnitude);
  const clockwise = data.current < 0;

  clearCanvas(ctx, width, height);

  ctx.save();
  ctx.strokeStyle = "rgba(0, 122, 255, 0.05)";
  ctx.lineWidth = 1;
  for (let y = 50; y < height; y += 42) {
    ctx.beginPath();
    ctx.moveTo(36, y);
    ctx.lineTo(width - 36, y);
    ctx.stroke();
  }
  for (let x = 42; x < width; x += 54) {
    ctx.beginPath();
    ctx.moveTo(x, 36);
    ctx.lineTo(x, height - 36);
    ctx.stroke();
  }
  ctx.restore();

  strokeLine(ctx, leftX, topY, rightX, topY, wireColor);
  strokeLine(ctx, rightX, topY, rightX, coilTopY, wireColor);
  strokeLine(ctx, rightX, coilBottomY, rightX, bottomY, wireColor);
  strokeLine(ctx, rightX, bottomY, leftX, bottomY, wireColor);
  strokeLine(ctx, leftX, topY, leftX, capTopY - 34, wireColor);
  strokeLine(ctx, leftX, capBottomY + 34, leftX, bottomY, wireColor);

  ctx.save();
  ctx.strokeStyle = "#1f2937";
  ctx.lineWidth = 9;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(leftX - plateWidth / 2, capTopY);
  ctx.lineTo(leftX + plateWidth / 2, capTopY);
  ctx.moveTo(leftX - plateWidth / 2, capBottomY);
  ctx.lineTo(leftX + plateWidth / 2, capBottomY);
  ctx.stroke();
  ctx.restore();

  drawElectricField(ctx, leftX, capTopY, capBottomY, plateWidth, data.q);
  drawCharges(ctx, leftX, capTopY - 24, plateWidth, data.q, data.q >= 0);
  drawCharges(ctx, leftX, capBottomY + 24, plateWidth, data.q, data.q < 0);
  drawCoil(ctx, rightX, coilTopY, coilBottomY, data.current, coilScale);

  const arrowSize = 15 + currentMagnitude * 6;
  if (currentMagnitude > 0.035) {
    drawArrow(ctx, (leftX + rightX) / 2, topY, clockwise ? 0 : Math.PI, arrowSize, currentColor, currentAlpha);
    drawArrow(ctx, rightX, (topY + bottomY) / 2, clockwise ? Math.PI / 2 : -Math.PI / 2, arrowSize, currentColor, currentAlpha);
    drawArrow(ctx, (leftX + rightX) / 2, bottomY, clockwise ? Math.PI : 0, arrowSize, currentColor, currentAlpha);
    drawArrow(ctx, leftX, (capBottomY + bottomY) / 2, clockwise ? -Math.PI / 2 : Math.PI / 2, arrowSize, currentColor, currentAlpha);
  }

  ctx.save();
  ctx.fillStyle = "#111827";
  ctx.font = "800 21px SF Pro Display, Microsoft YaHei, sans-serif";
  ctx.fillText("C", leftX + plateWidth / 2 + 28, (capTopY + capBottomY) / 2 + 7);
  ctx.fillText("L", rightX + 60, topY + 16);
  ctx.fillStyle = "#667085";
  ctx.font = "700 16px SF Pro Display, Microsoft YaHei, sans-serif";
  ctx.fillText(`q = ${data.q.toFixed(2)} Qm`, leftX - plateWidth / 2, capBottomY + 78);
  ctx.fillText(`i = ${data.current.toFixed(2)} Im`, rightX - 54, bottomY + 50);
  ctx.restore();
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
  curve("#34c759", (t) => -Math.sin(t));

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
  ctx.arc(markerX, mid - -Math.sin(theta) * amp, 5, 0, TAU);
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
    nodes.chargeText.textContent = "上极板为正，下极板为负";
  } else {
    nodes.chargeText.textContent = "上极板为负，下极板为正";
  }

  if (currentSmall) {
    nodes.currentText.textContent = "瞬时电流为零";
  } else if (data.current < 0) {
    nodes.currentText.textContent = "顺时针，正在向线圈转移能量";
  } else {
    nodes.currentText.textContent = "逆时针，电容反向充放电";
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
