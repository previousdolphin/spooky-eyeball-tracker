/* ========================================================================
   SPOOKY EYEBALL TRACKER — scripts.js
   Builds a procedural glossy/drippy bloodshot eyeball in Three.js and aims
   it using a hand-rolled, local-only webcam centroid tracker (no ML, no
   external services). Falls back to cursor-driven gaze, and to a static
   CSS eyeball if WebGL/Three is unavailable. Respects reduced-motion.
   ======================================================================== */
(function () {
  'use strict';

  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var canvas = document.getElementById('eye-canvas');
  var enableBtn = document.getElementById('enable-camera');
  var permChip = document.getElementById('perm-status');
  var videoEl = document.getElementById('subject-video');
  var reticleCanvas = document.getElementById('reticle-canvas');
  var feedPanel = document.getElementById('feed-panel');
  var teleX = document.getElementById('tele-x');
  var teleY = document.getElementById('tele-y');
  var teleProx = document.getElementById('tele-prox');
  var teleLock = document.getElementById('tele-lock');

  // Graceful degrade: no Three.js available, or no canvas in the DOM.
  if (typeof THREE === 'undefined' || !canvas) {
    if (permChip) permChip.textContent = 'RENDERER OFFLINE';
    if (enableBtn) {
      enableBtn.disabled = true;
      enableBtn.textContent = 'VISUALS UNAVAILABLE';
    }
    return;
  }

  /* ---------------- renderer / scene / camera ---------------- */
  var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

  var scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x2a2116, 0.07);

  var camera = new THREE.PerspectiveCamera(42, 1, 0.1, 50);
  camera.position.set(0, 0, 6);

  function resize() {
    var w = canvas.clientWidth || window.innerWidth;
    var h = canvas.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  /* ---------------- lights ---------------- */
  scene.add(new THREE.AmbientLight(0x2a2116, 0.7));
  var key = new THREE.PointLight(0xfff1d6, 2.4, 20); key.position.set(3, 4, 5); scene.add(key);
  var rim = new THREE.PointLight(0x6fa8c7, 1.1, 20); rim.position.set(-4, -2, -3); scene.add(rim);
  var warm = new THREE.PointLight(0xe39e4a, 1.3, 15); warm.position.set(-2, 3, 2); scene.add(warm);

  /* ---------------- procedural sclera (vein) texture ---------------- */
  function buildScleraTexture() {
    var size = 1024;
    var cv = document.createElement('canvas');
    cv.width = cv.height = size;
    var ctx = cv.getContext('2d');

    var base = ctx.createRadialGradient(size / 2, size / 2, size * 0.04, size / 2, size / 2, size * 0.6);
    base.addColorStop(0, '#f6ead9');
    base.addColorStop(0.55, '#e9dcc2');
    base.addColorStop(1, '#c6b495');
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, size, size);

    var reds = ['#8b1e1e', '#a52a2a', '#c23b2a', '#7a1414'];
    function vein(cx, cy, ang, len, color) {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1 + Math.random() * 2.2;
      ctx.globalAlpha = 0.3 + Math.random() * 0.4;
      ctx.beginPath();
      var x = cx, y = cy, a = ang;
      ctx.moveTo(x, y);
      var segs = 10 + Math.floor(Math.random() * 9);
      for (var i = 0; i < segs; i++) {
        a += (Math.random() - 0.5) * 0.8;
        x += Math.cos(a) * (len / segs);
        y += Math.sin(a) * (len / segs);
        ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    for (var i = 0; i < 150; i++) {
      var ang = Math.random() * Math.PI * 2;
      var rr = size * 0.5 * Math.sqrt(Math.random());
      var cx = size / 2 + Math.cos(ang) * rr;
      var cy = size / 2 + Math.sin(ang) * rr;
      vein(cx, cy, Math.random() * Math.PI * 2, 40 + Math.random() * 170, reds[i % reds.length]);
    }

    var vg = ctx.createRadialGradient(size / 2, size / 2, size * 0.32, size / 2, size / 2, size * 0.52);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(20,14,8,0.55)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, size, size);

    var tex = new THREE.CanvasTexture(cv);
    tex.anisotropy = 4;
    return tex;
  }

  /* ---------------- procedural iris texture ---------------- */
  function buildIrisTexture() {
    var size = 512;
    var cv = document.createElement('canvas');
    cv.width = cv.height = size;
    var ctx = cv.getContext('2d');

    var grad = ctx.createRadialGradient(size / 2, size / 2, 8, size / 2, size / 2, size / 2);
    grad.addColorStop(0, '#1a0505');
    grad.addColorStop(0.18, '#3d0a0a');
    grad.addColorStop(0.45, '#8f1d1d');
    grad.addColorStop(0.75, '#c23b2a');
    grad.addColorStop(1, '#5c1313');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalCompositeOperation = 'overlay';
    for (var i = 0; i < 170; i++) {
      var a = Math.random() * Math.PI * 2;
      ctx.strokeStyle = Math.random() > 0.5 ? 'rgba(255,200,170,0.28)' : 'rgba(40,0,0,0.32)';
      ctx.lineWidth = 1 + Math.random() * 2;
      ctx.beginPath();
      ctx.moveTo(size / 2 + Math.cos(a) * size * 0.08, size / 2 + Math.sin(a) * size * 0.08);
      ctx.lineTo(size / 2 + Math.cos(a) * size * 0.5, size / 2 + Math.sin(a) * size * 0.5);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';

    ctx.fillStyle = '#060202';
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size * 0.17, 0, Math.PI * 2);
    ctx.fill();

    return new THREE.CanvasTexture(cv);
  }

  /* ---------------- sclera geometry with drip displacement ---------------- */
  var geo = new THREE.SphereGeometry(1, 96, 96);
  var posAttr = geo.attributes.position;
  var dripAngles = [];
  var dripCount = 6 + Math.floor(Math.random() * 3);
  for (var d = 0; d < dripCount; d++) {
    dripAngles.push({
      a: Math.random() * Math.PI * 2,
      w: 0.22 + Math.random() * 0.22,
      len: 0.45 + Math.random() * 0.65
    });
  }
  var v = new THREE.Vector3();
  for (var i = 0; i < posAttr.count; i++) {
    v.fromBufferAttribute(posAttr, i);
    var n = v.clone().normalize();
    var phi = Math.acos(Math.max(-1, Math.min(1, n.y)));
    var theta = Math.atan2(n.z, n.x);

    var bump = 0;
    bump += Math.sin(theta * 5 + phi * 3) * 0.015;
    bump += Math.sin(theta * 11 - phi * 6) * 0.008;

    if (phi > 1.65) {
      var lowerFactor = (phi - 1.65) / (Math.PI - 1.65);
      var dripAmt = 0;
      for (var dd = 0; dd < dripAngles.length; dd++) {
        var dr = dripAngles[dd];
        var diff = Math.atan2(Math.sin(theta - dr.a), Math.cos(theta - dr.a));
        var falloff = Math.exp(-(diff * diff) / (dr.w * dr.w));
        dripAmt += falloff * dr.len * lowerFactor * lowerFactor;
      }
      bump += dripAmt;
    }

    var nv = n.clone().multiplyScalar(1 + bump);
    posAttr.setXYZ(i, nv.x, nv.y, nv.z);
  }
  geo.computeVertexNormals();

  var scleraMat = new THREE.MeshPhysicalMaterial({
    map: buildScleraTexture(),
    roughness: 0.3,
    metalness: 0.0,
    clearcoat: 1,
    clearcoatRoughness: 0.14
  });
  var sclera = new THREE.Mesh(geo, scleraMat);

  var irisMat = new THREE.MeshPhysicalMaterial({
    map: buildIrisTexture(),
    roughness: 0.22,
    clearcoat: 1,
    clearcoatRoughness: 0.08,
    emissive: new THREE.Color(0x3a0b0b),
    emissiveIntensity: 0.25
  });
  var iris = new THREE.Mesh(new THREE.CircleGeometry(0.42, 48), irisMat);
  iris.position.set(0, 0, 0.985);

  var corneaMat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    roughness: 0.03,
    transmission: 1,
    thickness: 0.3,
    clearcoat: 1,
    transparent: true,
    opacity: 0.4,
    side: THREE.DoubleSide
  });
  var cornea = new THREE.Mesh(new THREE.SphereGeometry(0.46, 32, 32, 0, Math.PI * 2, 0, Math.PI * 0.55), corneaMat);
  cornea.position.set(0, 0, 0.88);
  cornea.rotation.x = Math.PI / 2;

  var gazeGroup = new THREE.Group();
  gazeGroup.add(sclera, iris, cornea);

  var floatGroup = new THREE.Group();
  floatGroup.add(gazeGroup);
  scene.add(floatGroup);

  /* ---------------- ambient dust particles ---------------- */
  var pCount = 220;
  var pGeo = new THREE.BufferGeometry();
  var pPos = new Float32Array(pCount * 3);
  for (var pi = 0; pi < pCount; pi++) {
    pPos[pi * 3] = (Math.random() - 0.5) * 14;
    pPos[pi * 3 + 1] = (Math.random() - 0.5) * 10;
    pPos[pi * 3 + 2] = (Math.random() - 0.5) * 10 - 2;
  }
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  var pMat = new THREE.PointsMaterial({ color: 0xe39e4a, size: 0.025, transparent: true, opacity: 0.5 });
  var particles = new THREE.Points(pGeo, pMat);
  scene.add(particles);

  window.addEventListener('resize', resize);
  resize();

  /* ---------------- gaze target + fallback cursor control ---------------- */
  var targetDir = new THREE.Vector3(0, 0, 1);
  var usingCamera = false;
  var lastMouseMove = -999;
  var clockStart = performance.now() / 1000;

  function setTargetFromScreen(nx, ny) {
    var cx = Math.max(-1, Math.min(1, nx)) * 0.5;
    var cy = Math.max(-1, Math.min(1, ny)) * 0.4;
    targetDir.set(cx, cy, 1).normalize();
  }

  window.addEventListener('mousemove', function (e) {
    if (usingCamera) return;
    lastMouseMove = performance.now() / 1000 - clockStart;
    var nx = (e.clientX / window.innerWidth) * 2 - 1;
    var ny = -((e.clientY / window.innerHeight) * 2 - 1);
    setTargetFromScreen(nx * 0.9, ny * 0.9);
  });

  /* ---------------- local webcam centroid tracker (no ML) ---------------- */
  var trackCanvas = document.createElement('canvas');
  trackCanvas.width = 64;
  trackCanvas.height = 48;
  var trackCtx = trackCanvas.getContext('2d', { willReadFrequently: true });
  var prevFrame = null;
  var missCounter = 0;

  function drawReticle(nx, ny, visible) {
    if (!reticleCanvas) return;
    var rctx = reticleCanvas.getContext('2d');
    rctx.clearRect(0, 0, reticleCanvas.width, reticleCanvas.height);
    if (!visible) return;
    var x = nx * reticleCanvas.width;
    var y = ny * reticleCanvas.height;
    rctx.strokeStyle = '#e39e4a';
    rctx.lineWidth = 2;
    rctx.beginPath();
    rctx.arc(x, y, 18, 0, Math.PI * 2);
    rctx.stroke();
    rctx.beginPath();
    rctx.moveTo(x - 26, y); rctx.lineTo(x - 10, y);
    rctx.moveTo(x + 10, y); rctx.lineTo(x + 26, y);
    rctx.moveTo(x, y - 26); rctx.lineTo(x, y - 10);
    rctx.moveTo(x, y + 10); rctx.lineTo(x, y + 26);
    rctx.stroke();
  }

  function processFrame() {
    if (!usingCamera || !videoEl.videoWidth) return;
    try {
      trackCtx.drawImage(videoEl, 0, 0, trackCanvas.width, trackCanvas.height);
      var frame = trackCtx.getImageData(0, 0, trackCanvas.width, trackCanvas.height);
      var data = frame.data;
      var w = trackCanvas.width, h = trackCanvas.height;
      var sumX = 0, sumY = 0, weight = 0;

      for (var y = 0; y < h; y++) {
        for (var x = 0; x < w; x++) {
          var idx = (y * w + x) * 4;
          var r = data[idx], g = data[idx + 1], b = data[idx + 2];
          var lum = r * 0.299 + g * 0.587 + b * 0.114;
          var skin = (r > 60 && r > g && r > b * 0.9 && (r - g) > 8 && (r - b) > 15) ? 1 : 0;
          var motion = 0;
          if (prevFrame) {
            var pr = prevFrame[idx], pg = prevFrame[idx + 1], pb = prevFrame[idx + 2];
            motion = (Math.abs(r - pr) + Math.abs(g - pg) + Math.abs(b - pb)) > 28 ? 1 : 0;
          }
          var score = skin * 1.4 + motion * 1.0 + (lum > 40 ? 0.15 : 0);
          if (score > 0) {
            sumX += x * score;
            sumY += y * score;
            weight += score;
          }
        }
      }
      prevFrame = new Uint8ClampedArray(data);

      if (weight > 6) {
        var cx = sumX / weight, cy = sumY / weight;
        var nx = (cx / w) * 2 - 1;
        var ny = -((cy / h) * 2 - 1);
        setTargetFromScreen(-nx, ny); // mirror to match selfie view
        missCounter = 0;
        var proximity = weight > 260 ? 'NEAR' : (weight > 100 ? 'MEDIUM' : 'FAR');
        if (teleX) teleX.textContent = cx.toFixed(0);
        if (teleY) teleY.textContent = cy.toFixed(0);
        if (teleProx) teleProx.textContent = proximity;
        if (teleLock) teleLock.textContent = 'LOCKED';
        drawReticle(cx / w, cy / h, true);
      } else {
        missCounter++;
        if (teleLock) teleLock.textContent = missCounter > 20 ? 'SEARCHING' : 'LOCKED';
        drawReticle(0, 0, false);
      }
    } catch (err) {
      /* video not yet decoding a frame — safe to ignore */
    }
  }

  if (enableBtn) {
    enableBtn.addEventListener('click', function () {
      if (usingCamera) return;
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        if (permChip) permChip.textContent = 'CAMERA UNSUPPORTED';
        return;
      }
      if (permChip) permChip.textContent = 'REQUESTING…';
      navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false })
        .then(function (stream) {
          videoEl.srcObject = stream;
          videoEl.play();
          usingCamera = true;
          if (permChip) permChip.textContent = 'PERMISSION: GRANTED';
          enableBtn.textContent = 'TRACKING ACTIVE';
          enableBtn.disabled = true;
          if (feedPanel) feedPanel.classList.add('is-active');
          if (teleLock) teleLock.textContent = 'SEARCHING';
        })
        .catch(function () {
          if (permChip) permChip.textContent = 'PERMISSION: DENIED';
        });
    });
  }

  /* ---------------- animation loop ---------------- */
  var clock = new THREE.Clock();

  function animate() {
    requestAnimationFrame(animate);
    var dt = clock.getDelta();
    var t = clock.elapsedTime;

    if (usingCamera) {
      processFrame();
    } else if (t - lastMouseMove > 2.5) {
      var wx = Math.sin(t * 0.3) * 0.5;
      var wy = Math.sin(t * 0.21) * 0.3;
      setTargetFromScreen(wx, wy);
    }

    var amp = reduceMotion ? 0.03 : 0.14;
    floatGroup.position.y = Math.sin(t * 0.6) * amp;
    floatGroup.rotation.y = Math.sin(t * 0.25) * (reduceMotion ? 0.015 : 0.08);
    floatGroup.rotation.z = Math.cos(t * 0.18) * (reduceMotion ? 0.01 : 0.04);

    var desired = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 0, 1),
      targetDir.clone().normalize()
    );
    gazeGroup.quaternion.slerp(desired, reduceMotion ? 0.03 : 0.07);

    particles.rotation.y += dt * 0.01;

    renderer.render(scene, camera);
  }
  animate();
})();