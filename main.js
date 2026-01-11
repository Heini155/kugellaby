import * as THREE from "https://unpkg.com/three@0.158.0/build/three.module.js";

const maxPlaygrndLength = 128;
const maxAngle = 20;
const levelPeriod = 120;
const aniStep = 25;

const plateLength = 1.0;
const plateHeight = 0.3 * plateLength;
const wallHeight = 0.25 * plateLength;
const wallWidth = 0.25 * plateLength;
const holeRad = 0.4 * plateLength;
const subdiv = 20;
const ballRad = 0.25 * plateLength;

const StopMoving = 0.01;
const StopSpeed = 0.01;

const state = {
  width: 600,
  height: 600,
  eyeX: 0,
  eyeY: 10,
  eyeZ: 0.1,
  dynamicCamMode: false,
  angleX: 0,
  angleY: 0,
  angleZ: 0,
  ballX: 0,
  ballY: plateHeight + ballRad,
  ballZ: 0,
  ballSpeedX: 0,
  ballSpeedZ: 0,
  ballAccX: 0,
  ballAccZ: 0,
  gravity: 9.81,
  wallBrake: 0.6,
  rubbing: 0.0005,
  level: 0,
  levelTime: 0,
  levelStart: 0,
  fovy: 65,
  playgroundX: 0,
  playgroundY: 0,
  playground: Array.from({ length: maxPlaygrndLength }, () =>
    Array.from({ length: maxPlaygrndLength }, () => " ")
  ),
  moveBoard: false,
  mouseSensity: 1,
  tiltEnabled: false,
  tiltBaseline: { beta: 0, gamma: 0 },
  lastTilt: { beta: 0, gamma: 0 },
  stopped: false,
};

const ui = {
  toggleCam: document.getElementById("toggleCam"),
  gravity: document.getElementById("gravity"),
  elasticity: document.getElementById("elasticity"),
  rubbing: document.getElementById("rubbing"),
  mouseSensity: document.getElementById("mouseSensity"),
  enableTilt: document.getElementById("enableTilt"),
  calibrateTilt: document.getElementById("calibrateTilt"),
  exitGame: document.getElementById("exitGame"),
  panel: document.getElementById("ui"),
};

const app = document.getElementById("app");
const hud = document.getElementById("hud");
const hudCtx = hud.getContext("2d");

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setClearColor(0xe6e6e6, 1);
app.insertBefore(renderer.domElement, hud);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(state.fovy, 1, 0.1, 100);

const ambient = new THREE.AmbientLight(0xffffff, 0.6);
const light = new THREE.DirectionalLight(0xffffff, 0.8);
light.position.set(0, 10, 0);
scene.add(ambient, light);

const boardRoot = new THREE.Group();
const boardOffset = new THREE.Group();
boardRoot.add(boardOffset);
scene.add(boardRoot);

const ballGroup = new THREE.Group();
boardOffset.add(ballGroup);

let ballMesh = null;
let ballQuat = new THREE.Quaternion();

const materials = {};
const meshes = [];

function resize() {
  state.width = window.innerWidth;
  state.height = window.innerHeight;
  renderer.setSize(state.width, state.height, false);
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  camera.aspect = state.width / state.height;
  camera.updateProjectionMatrix();
  hud.width = Math.floor(state.width * (window.devicePixelRatio || 1));
  hud.height = Math.floor(state.height * (window.devicePixelRatio || 1));
  hud.style.width = `${state.width}px`;
  hud.style.height = `${state.height}px`;
  hudCtx.setTransform(window.devicePixelRatio || 1, 0, 0, window.devicePixelRatio || 1, 0, 0);
}

window.addEventListener("resize", resize);

function validField(field) {
  return (
    field === "." ||
    field === "*" ||
    field === " " ||
    field === "u" ||
    field === "d" ||
    field === "l" ||
    field === "r" ||
    field === "a" ||
    field === "b" ||
    field === "c" ||
    field === "e"
  );
}

function initPlayground() {
  for (let x = 0; x < maxPlaygrndLength; x += 1) {
    for (let y = 0; y < maxPlaygrndLength; y += 1) {
      state.playground[x][y] = " ";
    }
  }
  state.playgroundX = 0;
  state.playgroundY = 0;
}

async function loadLevel(name) {
  const response = await fetch(name);
  if (!response.ok) {
    throw new Error(`Missing level file: ${name}`);
  }
  const text = await response.text();
  let x = 0;
  let y = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "\n") {
      y += 1;
      if (x > state.playgroundX) {
        state.playgroundX = x;
      }
      x = 0;
    } else if (validField(ch)) {
      state.playground[x][y] = ch;
      x += 1;
    } else if (ch !== "\r") {
      throw new Error(`Invalid char '${ch}' at x:${x} y:${y}`);
    }
  }
  state.playgroundY = y;
}

function setBallStartPos() {
  state.ballX = plateLength / 2;
  state.ballZ = plateLength / 2;
}

function nextLevel() {
  state.level += 1;
  state.levelStart = performance.now() / 1000;
  const fname = `level${state.level}.txt`;
  return loadLevel(fname).then(() => {
    setBallStartPos();
    state.angleX = 0;
    state.angleY = 0;
    state.angleZ = 0;
    state.ballAccX = 0;
    state.ballAccZ = 0;
    state.ballSpeedX = 0;
    state.ballSpeedZ = 0;
    rebuildPlaygroundMeshes();
  });
}

function floatModulo(numerator, denominator) {
  let v = numerator;
  while (v >= denominator) {
    v -= denominator;
  }
  return v;
}

function kollisionTest(x, z) {
  const ix = Math.floor(x / plateLength);
  const iz = Math.floor(z / plateLength);
  const f = state.playground[ix]?.[iz] ?? " ";
  const x_ = floatModulo(x, plateLength);
  const z_ = floatModulo(z, plateLength);
  switch (f) {
    case ".":
    case "*":
    case " ":
      return false;
    case "u":
      return z_ <= wallWidth;
    case "d":
      return z_ >= plateLength - wallWidth;
    case "l":
      return x_ <= wallWidth;
    case "r":
      return x_ >= plateLength - wallWidth;
    case "a":
      return z_ <= wallWidth || x_ <= wallWidth;
    case "b":
      return z_ >= plateLength - wallWidth || x_ <= wallWidth;
    case "c":
      return z_ <= wallWidth || x_ >= plateLength - wallWidth;
    case "e":
      return z_ >= plateLength - wallWidth || x_ >= plateLength - wallWidth;
    default:
      return false;
  }
}

function holeTest(x, z) {
  const ix = Math.floor(x / plateLength);
  const iz = Math.floor(z / plateLength);
  const f = state.playground[ix]?.[iz] ?? " ";
  if (f !== "*") {
    return false;
  }
  const x_ = floatModulo(x, plateLength);
  const z_ = floatModulo(z, plateLength);
  const dx = plateLength / 2 - x_;
  const dz = plateLength / 2 - z_;
  return Math.sqrt(dx * dx + dz * dz) < holeRad;
}

function goalTest(x, z) {
  return (
    Math.floor(x / plateLength) === state.playgroundX - 1 &&
    Math.floor(z / plateLength) === state.playgroundY - 1
  );
}

function myAbs(value) {
  return value >= 0 ? value : -value;
}

function correctPosZ() {
  if (kollisionTest(state.ballX, state.ballZ + ballRad)) {
    state.ballZ -= StopMoving;
  }
  if (kollisionTest(state.ballX, state.ballZ - ballRad)) {
    state.ballZ += StopMoving;
  }
}

function correctPosX() {
  if (kollisionTest(state.ballX + ballRad, state.ballZ)) {
    state.ballX -= StopMoving;
  }
  if (kollisionTest(state.ballX - ballRad, state.ballZ)) {
    state.ballX += StopMoving;
  }
}

function newKoord() {
  state.ballAccX = Math.sin(-state.angleZ / maxAngle) * state.gravity;
  state.ballAccZ = Math.sin(state.angleX / maxAngle) * state.gravity;

  state.ballSpeedX += state.ballAccX / 1000;
  state.ballSpeedZ += state.ballAccZ / 1000;

  if (
    (kollisionTest(state.ballX, state.ballZ + ballRad + StopMoving) &&
      state.ballSpeedZ <= StopSpeed &&
      state.ballSpeedZ >= 0) ||
    (kollisionTest(state.ballX, state.ballZ - ballRad - StopMoving) &&
      state.ballSpeedZ >= -StopSpeed &&
      state.ballSpeedZ <= 0)
  ) {
    state.ballSpeedZ = 0;
    correctPosZ();
  } else {
    if (myAbs(state.ballSpeedZ) <= state.rubbing) {
      state.ballSpeedZ = 0;
    } else if (state.ballSpeedZ > 0) {
      state.ballSpeedZ -= state.rubbing;
    } else {
      state.ballSpeedZ += state.rubbing;
    }
  }

  if (
    (kollisionTest(state.ballX + ballRad + StopMoving, state.ballZ) &&
      state.ballSpeedX <= StopSpeed &&
      state.ballSpeedX >= 0) ||
    (kollisionTest(state.ballX - ballRad - StopMoving, state.ballZ) &&
      state.ballSpeedX >= -StopSpeed &&
      state.ballSpeedX <= 0)
  ) {
    state.ballSpeedX = 0;
    correctPosX();
  } else {
    if (myAbs(state.ballSpeedX) <= state.rubbing) {
      state.ballSpeedX = 0;
    } else if (state.ballSpeedX > 0) {
      state.ballSpeedX -= state.rubbing;
    } else {
      state.ballSpeedX += state.rubbing;
    }
  }

  state.ballX += state.ballSpeedX;
  state.ballZ += state.ballSpeedZ;
}

function direction(z, x) {
  if (z === 0) {
    return x >= 0 ? Math.PI / 2 : -Math.PI / 2;
  }
  const angle = Math.atan(x / z);
  return z <= 0 ? angle + Math.PI : angle;
}

function setNewSpeed(angle) {
  const s = Math.sqrt(state.ballSpeedX * state.ballSpeedX + state.ballSpeedZ * state.ballSpeedZ);
  state.ballSpeedX = Math.sin(angle) * s * state.wallBrake;
  state.ballSpeedZ = Math.cos(angle) * s * state.wallBrake;
}

function stepPhysics() {
  if (holeTest(state.ballX, state.ballZ)) {
    stopGame("Fell into a hole.");
    return;
  }

  let i = 1;
  let collisionDetect = false;
  let point1Ok = false;
  let point1X = 0;
  let point1Z = 0;
  let point2X = 0;
  let point2Z = 0;

  while (i < subdiv) {
    const dir = direction(state.ballSpeedZ, state.ballSpeedX);
    const x = ballRad * Math.sin(dir - Math.PI / 2 + (Math.PI * i) / subdiv) + state.ballX;
    const z = ballRad * Math.cos(dir - Math.PI / 2 + (Math.PI * i) / subdiv) + state.ballZ;

    if (kollisionTest(x, z)) {
      collisionDetect = true;
      if (point1Ok) {
        point2X = x;
        point2Z = z;
      } else {
        point1X = x;
        point1Z = z;
        point2X = x;
        point2Z = z;
        point1Ok = true;
      }
    }
    i += 1;
  }

  if (point1X === point2X && point1Z === point2Z) {
    let angle = direction(point1Z - state.ballZ, point1X - state.ballX);
    angle -= Math.PI / 2;
    point2X += Math.sin(angle);
    point2Z += Math.cos(angle);
  }

  if (collisionDetect) {
    const newAngle =
      direction(point2Z - point1Z, point2X - point1X) * 2 -
      direction(state.ballSpeedZ, state.ballSpeedX);
    setNewSpeed(newAngle);
  }

  newKoord();

  if (goalTest(state.ballX, state.ballZ)) {
    nextLevel().catch(() => stopGame("No more levels."));
  }
}

function updateBallMesh() {
  if (!ballMesh) {
    return;
  }
  const speed = Math.sqrt(state.ballSpeedX * state.ballSpeedX + state.ballSpeedZ * state.ballSpeedZ);
  if (speed > 0) {
    const axis = new THREE.Vector3(state.ballSpeedZ, 0, -state.ballSpeedX).normalize();
    const angle = THREE.MathUtils.degToRad(speed * 200);
    const q = new THREE.Quaternion().setFromAxisAngle(axis, angle);
    ballQuat.premultiply(q);
  }
  ballMesh.position.set(state.ballX, state.ballY, state.ballZ);
  ballMesh.quaternion.copy(ballQuat);
}

function updateCamera() {
  camera.fov = state.fovy;
  camera.updateProjectionMatrix();
  if (state.dynamicCamMode) {
    const xOffset = -plateLength * state.playgroundX / 2 + state.ballX;
    const zOffset = -plateLength * state.playgroundY / 2 + state.ballZ;
    camera.position.set(state.eyeX + xOffset, state.eyeY + state.ballY, state.eyeZ + zOffset);
    camera.lookAt(xOffset, state.ballY, zOffset);
  } else {
    camera.position.set(state.eyeX, state.eyeY, state.eyeZ);
    camera.lookAt(0, 0, 0);
  }
}

function updateBoardTransform() {
  boardRoot.rotation.set(
    THREE.MathUtils.degToRad(state.angleX),
    THREE.MathUtils.degToRad(state.angleY),
    THREE.MathUtils.degToRad(state.angleZ)
  );
  boardOffset.position.set(
    (-plateLength * state.playgroundX) / 2,
    0,
    (-plateLength * state.playgroundY) / 2
  );
}

function drawHud() {
  hudCtx.clearRect(0, 0, state.width, state.height);
  hudCtx.save();

  const barThickness = 10;
  const barLengthFactor = state.height / 3;

  const zLen = -state.angleZ / maxAngle;
  hudCtx.fillStyle = `rgb(${Math.floor(Math.abs(zLen) * 255)}, ${Math.floor(
    (1 - Math.abs(zLen)) * 255
  )}, 0)`;
  hudCtx.fillRect(state.width / 2, state.height - 10, zLen * barLengthFactor, barThickness);
  hudCtx.fillStyle = "black";
  hudCtx.fillRect(state.width / 2, state.height - 20, barThickness / 2, barThickness * 2);

  const xLen = state.angleX / maxAngle;
  hudCtx.save();
  hudCtx.translate(10, state.height / 2);
  hudCtx.rotate(Math.PI / 2);
  hudCtx.fillStyle = `rgb(${Math.floor(Math.abs(xLen) * 255)}, ${Math.floor(
    (1 - Math.abs(xLen)) * 255
  )}, 0)`;
  hudCtx.fillRect(0, 0, xLen * barLengthFactor, barThickness);
  hudCtx.fillStyle = "black";
  hudCtx.fillRect(0, -barThickness, barThickness / 2, barThickness * 2);
  hudCtx.restore();

  hudCtx.fillStyle = "red";
  hudCtx.font = "18px Helvetica";
  hudCtx.fillText(`Level: ${state.level}`, 10, state.height - 20);
  hudCtx.fillText(`Time: ${state.levelTime}`, state.width - 110, state.height - 20);

  hudCtx.restore();
}

function stopGame(reason) {
  state.stopped = true;
  alert(reason);
}

function clearMeshes() {
  while (meshes.length > 0) {
    const mesh = meshes.pop();
    boardOffset.remove(mesh);
    if (mesh.geometry) mesh.geometry.dispose();
  }
}

function addWall(x, z, width, depth) {
  const geom = new THREE.BoxGeometry(width, wallHeight, depth);
  const mesh = new THREE.Mesh(geom, materials.mahagony);
  mesh.position.set(x, plateHeight + wallHeight / 2, z);
  boardOffset.add(mesh);
  meshes.push(mesh);
}

function createPlateWithHoleGeom() {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(plateLength, 0);
  shape.lineTo(plateLength, plateLength);
  shape.lineTo(0, plateLength);
  shape.lineTo(0, 0);

  const holePath = new THREE.Path();
  holePath.absarc(plateLength / 2, plateLength / 2, holeRad, 0, Math.PI * 2, true);
  shape.holes.push(holePath);

  const geom = new THREE.ExtrudeGeometry(shape, {
    depth: plateHeight,
    bevelEnabled: false,
    steps: 1,
  });
  geom.rotateX(-Math.PI / 2);
  geom.translate(0, 0, plateLength);
  return geom;
}

let plateWithHoleGeom = null;

function rebuildPlaygroundMeshes() {
  clearMeshes();

  const tileGeom = new THREE.BoxGeometry(plateLength, plateHeight, plateLength);
  if (!plateWithHoleGeom) {
    plateWithHoleGeom = createPlateWithHoleGeom();
  }

  for (let x = 0; x < state.playgroundX; x += 1) {
    for (let y = 0; y < state.playgroundY; y += 1) {
      const cell = state.playground[x][y];
      const xi = x * plateLength;
      const zi = y * plateLength;

      if (cell !== "*") {
        const mat = x === state.playgroundX - 1 && y === state.playgroundY - 1 ? materials.goal : materials.pine;
        const tile = new THREE.Mesh(tileGeom, mat);
        tile.position.set(xi + plateLength / 2, plateHeight / 2, zi + plateLength / 2);
        boardOffset.add(tile);
        meshes.push(tile);
      } else {
        const holePlate = new THREE.Mesh(plateWithHoleGeom, materials.pineHole);
        holePlate.position.set(xi, 0, zi);
        boardOffset.add(holePlate);
        meshes.push(holePlate);

        const holeDepth = plateHeight * 3;
        const holeWallGeom = new THREE.CylinderGeometry(holeRad, holeRad, holeDepth, subdiv, 1, true);
        const holeWall = new THREE.Mesh(holeWallGeom, materials.hole);
        holeWall.position.set(xi + plateLength / 2, plateHeight - holeDepth / 2, zi + plateLength / 2);
        boardOffset.add(holeWall);
        meshes.push(holeWall);

        const holeBottomGeom = new THREE.CircleGeometry(holeRad, subdiv);
        const holeBottom = new THREE.Mesh(holeBottomGeom, materials.hole);
        holeBottom.rotation.x = -Math.PI / 2;
        holeBottom.position.set(
          xi + plateLength / 2,
          plateHeight - holeDepth + 0.02,
          zi + plateLength / 2
        );
        boardOffset.add(holeBottom);
        meshes.push(holeBottom);
      }

      switch (cell) {
        case "u":
          addWall(xi + plateLength / 2, zi + wallWidth / 2, plateLength, wallWidth);
          break;
        case "d":
          addWall(xi + plateLength / 2, zi + plateLength - wallWidth / 2, plateLength, wallWidth);
          break;
        case "l":
          addWall(xi + wallWidth / 2, zi + plateLength / 2, wallWidth, plateLength);
          break;
        case "r":
          addWall(xi + plateLength - wallWidth / 2, zi + plateLength / 2, wallWidth, plateLength);
          break;
        case "a":
          addWall(xi + plateLength / 2, zi + wallWidth / 2, plateLength, wallWidth);
          addWall(xi + wallWidth / 2, zi + plateLength / 2, wallWidth, plateLength);
          break;
        case "b":
          addWall(xi + plateLength / 2, zi + plateLength - wallWidth / 2, plateLength, wallWidth);
          addWall(xi + wallWidth / 2, zi + plateLength / 2, wallWidth, plateLength);
          break;
        case "c":
          addWall(xi + plateLength / 2, zi + wallWidth / 2, plateLength, wallWidth);
          addWall(xi + plateLength - wallWidth / 2, zi + plateLength / 2, wallWidth, plateLength);
          break;
        case "e":
          addWall(xi + plateLength / 2, zi + plateLength - wallWidth / 2, plateLength, wallWidth);
          addWall(xi + plateLength - wallWidth / 2, zi + plateLength / 2, wallWidth, plateLength);
          break;
        default:
          break;
      }
    }
  }

  if (!ballMesh) {
    const ballGeom = new THREE.SphereGeometry(ballRad, subdiv, subdiv);
    ballMesh = new THREE.Mesh(ballGeom, materials.ball);
    ballGroup.add(ballMesh);
  }
}

function parseTga(buffer) {
  const data = new Uint8Array(buffer);
  const idLength = data[0];
  const colorMapType = data[1];
  const imageType = data[2];
  const width = data[12] + data[13] * 256;
  const height = data[14] + data[15] * 256;
  const bpp = data[16];
  const descriptor = data[17];

  if (colorMapType !== 0) {
    throw new Error("Unsupported TGA color map.");
  }
  if (imageType !== 2 && imageType !== 3) {
    throw new Error("Unsupported TGA type.");
  }

  const pixelSize = bpp / 8;
  const offset = 18 + idLength;
  const out = new Uint8Array(width * height * 4);
  const topOrigin = (descriptor & 0x20) !== 0;

  for (let y = 0; y < height; y += 1) {
    const srcY = topOrigin ? y : height - 1 - y;
    for (let x = 0; x < width; x += 1) {
      const srcIndex = offset + (srcY * width + x) * pixelSize;
      const dstIndex = (y * width + x) * 4;
      if (bpp === 8) {
        const v = data[srcIndex];
        out[dstIndex] = v;
        out[dstIndex + 1] = v;
        out[dstIndex + 2] = v;
        out[dstIndex + 3] = 255;
      } else if (bpp === 24) {
        out[dstIndex] = data[srcIndex + 2];
        out[dstIndex + 1] = data[srcIndex + 1];
        out[dstIndex + 2] = data[srcIndex];
        out[dstIndex + 3] = 255;
      } else if (bpp === 32) {
        out[dstIndex] = data[srcIndex + 2];
        out[dstIndex + 1] = data[srcIndex + 1];
        out[dstIndex + 2] = data[srcIndex];
        out[dstIndex + 3] = data[srcIndex + 3];
      } else {
        throw new Error("Unsupported TGA bits.");
      }
    }
  }

  const texture = new THREE.DataTexture(out, width, height, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.needsUpdate = true;
  return texture;
}

async function loadTexture(name) {
  const response = await fetch(name);
  if (!response.ok) {
    throw new Error(`Missing texture: ${name}`);
  }
  const buffer = await response.arrayBuffer();
  return parseTga(buffer);
}

function setupUi() {
  ui.toggleCam.addEventListener("click", () => {
    state.dynamicCamMode = !state.dynamicCamMode;
  });
  ui.gravity.addEventListener("change", (e) => {
    state.gravity = parseFloat(e.target.value);
  });
  ui.elasticity.addEventListener("change", (e) => {
    state.wallBrake = parseFloat(e.target.value);
  });
  ui.rubbing.addEventListener("change", (e) => {
    state.rubbing = parseFloat(e.target.value);
  });
  ui.mouseSensity.addEventListener("change", (e) => {
    state.mouseSensity = parseFloat(e.target.value);
  });
  ui.enableTilt.addEventListener("click", async () => {
    const ok = await requestTiltPermission();
    if (ok) {
      state.tiltEnabled = true;
      ui.enableTilt.textContent = "Tilt Enabled";
      ui.enableTilt.disabled = true;
    }
  });
  ui.calibrateTilt.addEventListener("click", () => {
    state.tiltBaseline = { ...state.lastTilt };
  });
  ui.exitGame.addEventListener("click", () => {
    stopGame("Exited.");
  });
}

function setupInput() {
  renderer.domElement.addEventListener("mousedown", (event) => {
    if (event.button === 0) {
      state.moveBoard = !state.moveBoard;
      if (state.moveBoard) {
        renderer.domElement.requestPointerLock?.();
      } else {
        document.exitPointerLock?.();
      }
    } else if (event.button === 1) {
      ui.panel.classList.toggle("hidden");
    } else if (event.button === 2) {
      state.dynamicCamMode = !state.dynamicCamMode;
    }
  });

  document.addEventListener("pointerlockchange", () => {
    if (document.pointerLockElement !== renderer.domElement) {
      state.moveBoard = false;
    }
  });

  document.addEventListener("mousemove", (event) => {
    if (!state.moveBoard) {
      return;
    }
    if (state.tiltEnabled) {
      return;
    }
    const dx = event.movementX || 0;
    const dy = event.movementY || 0;

    if (dy < 0 && state.angleX >= -maxAngle) {
      state.angleX -= state.mouseSensity;
    }
    if (dy > 0 && state.angleX <= maxAngle) {
      state.angleX += state.mouseSensity;
    }
    if (dx < 0 && state.angleZ <= maxAngle) {
      state.angleZ += state.mouseSensity;
    }
    if (dx > 0 && state.angleZ >= -maxAngle) {
      state.angleZ -= state.mouseSensity;
    }
  });

  document.addEventListener("keydown", (event) => {
    switch (event.key) {
      case "q":
        stopGame("Exited.");
        break;
      case "-":
        state.fovy += 0.1;
        break;
      case "+":
        state.fovy -= 0.1;
        break;
      case "z":
        state.angleX = 0;
        state.angleY = 0;
        state.angleZ = 0;
        break;
      case "ArrowUp":
        state.eyeZ = Math.max(0.1, state.eyeZ - 0.1);
        break;
      case "ArrowDown":
        state.eyeZ += 0.1;
        break;
      case "ArrowLeft":
        state.eyeY += 0.1;
        break;
      case "ArrowRight":
        state.eyeY -= 0.1;
        break;
      default:
        break;
    }
  });

  renderer.domElement.addEventListener("contextmenu", (event) => {
    event.preventDefault();
  });
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

async function requestTiltPermission() {
  if (typeof DeviceOrientationEvent === "undefined") {
    alert("Device orientation not supported.");
    return false;
  }
  if (typeof DeviceOrientationEvent.requestPermission === "function") {
    try {
      const result = await DeviceOrientationEvent.requestPermission();
      return result === "granted";
    } catch (err) {
      alert("Tilt permission denied.");
      return false;
    }
  }
  return true;
}

function setupTilt() {
  window.addEventListener("deviceorientation", (event) => {
    if (event.beta == null || event.gamma == null) {
      return;
    }
    state.lastTilt = { beta: event.beta, gamma: event.gamma };
    if (!state.tiltEnabled) {
      return;
    }
    const beta = event.beta - state.tiltBaseline.beta;
    const gamma = event.gamma - state.tiltBaseline.gamma;
    const factor = 0.5;
    state.angleX = clamp(beta * factor, -maxAngle, maxAngle);
    state.angleZ = clamp(-gamma * factor, -maxAngle, maxAngle);
  });
}

async function init() {
  resize();
  setupUi();
  setupInput();
  setupTilt();
  initPlayground();

  const [pine, mahagony, ball, goal] = await Promise.all([
    loadTexture("pine.tga"),
    loadTexture("mahagony.tga"),
    loadTexture("ball.tga"),
    loadTexture("goal.tga"),
  ]);

  materials.pine = new THREE.MeshStandardMaterial({ map: pine });
  materials.pineHole = new THREE.MeshStandardMaterial({ map: pine, side: THREE.DoubleSide });
  materials.mahagony = new THREE.MeshStandardMaterial({ map: mahagony });
  materials.ball = new THREE.MeshStandardMaterial({ map: ball });
  materials.goal = new THREE.MeshStandardMaterial({ map: goal });
  materials.hole = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 1 });

  await nextLevel();

  let lastTime = performance.now();
  let accumulator = 0;
  const step = 1 / aniStep;

  function frame(now) {
    if (state.stopped) {
      return;
    }
    const dt = (now - lastTime) / 1000;
    lastTime = now;
    accumulator += dt;

    while (accumulator >= step) {
      stepPhysics();
      accumulator -= step;
    }

    const elapsed = now / 1000 - state.levelStart;
    state.levelTime = Math.max(0, Math.floor(levelPeriod - elapsed));
    if (state.levelTime <= 0 && !state.stopped) {
      stopGame("Time is up.");
    }

    updateBallMesh();
    updateBoardTransform();
    updateCamera();
    drawHud();

    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}

init().catch((err) => {
  console.error(err);
  alert(err.message);
});
