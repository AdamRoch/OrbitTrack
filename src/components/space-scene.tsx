"use client";

/**
 * 3D ambient backdrop (raw Three.js, no react-three-fiber).
 *
 * A low-poly UFO arcs in from off-screen on load, then settles into a slow,
 * wide idle hover with a pulsing tractor beam and an additive glow so it reads
 * as a real light source. A ringed planet drifts in the background, accent
 * nebula blobs + a 3D starfield add depth, and everything reacts to the pointer
 * for parallax. The canvas is transparent so the CSS nebula/starfield behind it
 * still reads through.
 *
 * Hardening:
 *  - Client-only (this module is loaded via `dynamic(..., { ssr: false })`).
 *  - Honors `prefers-reduced-motion`: renders a single static frame, no loop.
 *  - Pauses the rAF loop when the tab is hidden (saves GPU).
 *  - Caps DPR at 1.5 and disposes all GPU resources on unmount.
 *  - Wraps WebGL creation in try/catch so a missing/blocked context degrades
 *    gracefully to the CSS-only backdrop instead of crashing the page.
 */

import { useEffect, useRef } from "react";
import * as THREE from "three";

/** Soft radial sprite texture (white; tinted per-use via material color). */
function makeGlowTexture(): THREE.CanvasTexture {
  const size = 128;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(
    size / 2,
    size / 2,
    0,
    size / 2,
    size / 2,
    size / 2,
  );
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.25, "rgba(255,255,255,0.55)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(c);
}

const easeOutCubic = (x: number) => 1 - Math.pow(1 - x, 3);
const easeOutBack = (x: number) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
};

/** Builds a low-poly saucer. `detailed` adds under-lights (used for the hero). */
function buildUfo(
  scale: number,
  ringColor: number,
  detailed: boolean,
  disposables: { dispose(): void }[],
) {
  const group = new THREE.Group();

  const bodyGeo = new THREE.CylinderGeometry(1.6, 1.6, 0.5, 32);
  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0x1a2233,
    metalness: 0.85,
    roughness: 0.3,
  });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.scale.y = 0.35;
  group.add(body);

  const domeGeo = new THREE.SphereGeometry(
    0.8,
    32,
    16,
    0,
    Math.PI * 2,
    0,
    Math.PI / 2,
  );
  const domeMat = new THREE.MeshStandardMaterial({
    color: 0x7dd3fc,
    metalness: 0.2,
    roughness: 0.1,
    emissive: 0x123047,
    emissiveIntensity: 0.7,
    transparent: true,
    opacity: 0.85,
  });
  const dome = new THREE.Mesh(domeGeo, domeMat);
  dome.position.y = 0.18;
  group.add(dome);

  const ringGeo = new THREE.TorusGeometry(1.6, 0.08, 16, 48);
  const ringMat = new THREE.MeshStandardMaterial({
    color: ringColor,
    emissive: ringColor,
    emissiveIntensity: 3.2,
    metalness: 0.4,
    roughness: 0.3,
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = Math.PI / 2;
  group.add(ring);

  let bulbMat: THREE.MeshStandardMaterial | undefined;
  if (detailed) {
    const lightGeo = new THREE.SphereGeometry(0.12, 12, 12);
    bulbMat = new THREE.MeshStandardMaterial({
      color: 0xa3e635,
      emissive: 0xa3e635,
      emissiveIntensity: 4,
    });
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const bulb = new THREE.Mesh(lightGeo, bulbMat);
      bulb.position.set(Math.cos(a) * 1.2, -0.18, Math.sin(a) * 1.2);
      group.add(bulb);
    }
    disposables.push(lightGeo, bulbMat);
  }

  group.scale.setScalar(scale);
  disposables.push(bodyGeo, bodyMat, domeGeo, domeMat, ringGeo, ringMat);
  return { group, ringMat };
}

export default function SpaceScene() {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      // No WebGL available — leave the CSS backdrop in place and bail.
      return;
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(
      50,
      mount.clientWidth / mount.clientHeight,
      0.1,
      100,
    );
    camera.position.set(0, 0, 10.5);

    // Track every GPU resource so unmount can dispose it cleanly.
    const disposables: { dispose(): void }[] = [];
    disposables.push(renderer);

    // --- Lighting (tuned to the lime/violet/sky accent system) -------------
    scene.add(new THREE.AmbientLight(0x223355, 1.2));
    const key = new THREE.DirectionalLight(0xa3e635, 1.6);
    key.position.set(5, 6, 8);
    scene.add(key);
    const rim = new THREE.PointLight(0xa78bfa, 2.6, 40);
    rim.position.set(-6, -2, 6);
    scene.add(rim);

    // --- Hero UFO -----------------------------------------------------------
    const { group: ufo, ringMat: ufoRingMat } = buildUfo(
      1.7,
      0xa3e635,
      true,
      disposables,
    );
    scene.add(ufo);

    // --- UFO FX rig (glow + tractor beam) — follows the ship, stays vertical -
    const glowTex = makeGlowTexture();
    disposables.push(glowTex);

    const ufoFx = new THREE.Group();

    const glowMat = new THREE.SpriteMaterial({
      map: glowTex,
      color: 0xa3e635,
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const glowSprite = new THREE.Sprite(glowMat);
    glowSprite.scale.setScalar(7);
    glowSprite.position.y = -0.3;
    ufoFx.add(glowSprite);
    disposables.push(glowMat);

    const beamGeo = new THREE.ConeGeometry(2.2, 4, 32, 1, true);
    const beamMat = new THREE.MeshBasicMaterial({
      color: 0xa3e635,
      transparent: true,
      opacity: 0.15,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const beamMesh = new THREE.Mesh(beamGeo, beamMat);
    beamMesh.position.y = -2.2;
    ufoFx.add(beamMesh);
    disposables.push(beamGeo, beamMat);

    scene.add(ufoFx);

    // --- Landing ripple (expanding glow ring fired when the UFO arrives) ----
    const rippleMat = new THREE.SpriteMaterial({
      map: glowTex,
      color: 0xa3e635,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const rippleSprite = new THREE.Sprite(rippleMat);
    rippleSprite.visible = false;
    scene.add(rippleSprite);
    disposables.push(rippleMat);

    // --- Distant companion UFO (adds life, kept small + subtle) -------------
    const { group: smallUfo } = buildUfo(0.45, 0xa78bfa, false, disposables);
    smallUfo.position.set(0, 3.2, -6);
    scene.add(smallUfo);

    // --- Ringed planet (background) -----------------------------------------
    const planet = new THREE.Group();
    const planetGeo = new THREE.SphereGeometry(2.4, 48, 48);
    const planetMat = new THREE.MeshStandardMaterial({
      color: 0x2a1f4a,
      roughness: 0.9,
      metalness: 0.1,
      emissive: 0x140a2a,
      emissiveIntensity: 0.4,
    });
    planet.add(new THREE.Mesh(planetGeo, planetMat));

    const planetRingGeo = new THREE.RingGeometry(3.2, 4.6, 64);
    const planetRingMat = new THREE.MeshBasicMaterial({
      color: 0xa78bfa,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.4,
    });
    const planetRing = new THREE.Mesh(planetRingGeo, planetRingMat);
    planetRing.rotation.x = Math.PI / 2.4;
    planetRing.rotation.y = 0.3;
    planet.add(planetRing);

    const planetHome = new THREE.Vector3(-5.5, 2.5, -8);
    planet.position.copy(planetHome);
    planet.scale.setScalar(0.9);
    scene.add(planet);
    disposables.push(planetGeo, planetMat, planetRingGeo, planetRingMat);

    // --- Accent nebula blobs (3D color presence behind the CSS layers) ------
    const nebulaColors = [0xa3e635, 0xa78bfa, 0x7dd3fc];
    const nebulaPos: [number, number, number][] = [
      [-8, 4, -22],
      [9, -3, -26],
      [2, 6, -30],
    ];
    nebulaColors.forEach((color, i) => {
      const mat = new THREE.SpriteMaterial({
        map: glowTex,
        color,
        transparent: true,
        opacity: 0.18,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const sprite = new THREE.Sprite(mat);
      sprite.scale.setScalar(18);
      sprite.position.set(...nebulaPos[i]);
      scene.add(sprite);
      disposables.push(mat);
    });

    // --- 3D starfield (adds depth behind the CSS starfield) -----------------
    const starCount = 900;
    const starPos = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      starPos[i * 3] = (Math.random() - 0.5) * 60;
      starPos[i * 3 + 1] = (Math.random() - 0.5) * 40;
      starPos[i * 3 + 2] = -10 - Math.random() * 30;
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute("position", new THREE.BufferAttribute(starPos, 3));
    const starMat = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.08,
      transparent: true,
      opacity: 0.8,
      sizeAttenuation: true,
    });
    const stars = new THREE.Points(starGeo, starMat);
    scene.add(stars);
    disposables.push(starGeo, starMat);

    // A handful of larger twinkling stars for sparkle.
    const brightCount = 40;
    const brightPos = new Float32Array(brightCount * 3);
    for (let i = 0; i < brightCount; i++) {
      brightPos[i * 3] = (Math.random() - 0.5) * 50;
      brightPos[i * 3 + 1] = (Math.random() - 0.5) * 34;
      brightPos[i * 3 + 2] = -8 - Math.random() * 26;
    }
    const brightGeo = new THREE.BufferGeometry();
    brightGeo.setAttribute("position", new THREE.BufferAttribute(brightPos, 3));
    const brightMat = new THREE.PointsMaterial({
      color: 0xbfe6ff,
      size: 0.22,
      transparent: true,
      opacity: 0.8,
      sizeAttenuation: true,
    });
    const brightStars = new THREE.Points(brightGeo, brightMat);
    scene.add(brightStars);
    disposables.push(brightGeo, brightMat);

    // --- Entrance: arc in from off-screen, then idle hover ------------------
    const startPos = new THREE.Vector3(11, 7, 3);
    const hoverPos = new THREE.Vector3(2.4, 1.9, 0);
    ufo.position.copy(startPos);
    const entranceDuration = reduceMotion ? 0 : 2.4; // seconds
    const startTime = performance.now();

    // --- Pointer parallax ---------------------------------------------------
    const pointer = { x: 0, y: 0 };
    const onPointerMove = (e: PointerEvent) => {
      pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
      pointer.y = (e.clientY / window.innerHeight) * 2 - 1;
    };
    window.addEventListener("pointermove", onPointerMove);

    // --- Resize -------------------------------------------------------------
    const onResize = () => {
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    window.addEventListener("resize", onResize);

    // --- Loop with tab-visibility pause -------------------------------------
    let running = true;
    let last = performance.now();
    let landed = false;
    let landingFlash = 0;
    let rippleStart: number | null = null;

    const loop = () => {
      if (!running) return;
      const now = performance.now();
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      const t = (now - startTime) / 1000;

      if (t < entranceDuration) {
        const p = t / entranceDuration;
        const e = easeOutCubic(p);
        ufo.position.lerpVectors(startPos, hoverPos, e);
        ufo.rotation.y = e * Math.PI * 2.2;
        ufo.scale.setScalar(THREE.MathUtils.lerp(0.5, 1.7, easeOutBack(p)));
      } else {
        if (!landed) {
          landed = true;
          landingFlash = 1;
          rippleStart = now;
        }
        ufo.scale.setScalar(1.7);
        ufo.position.x = hoverPos.x + Math.sin(t * 0.25) * 1.6;
        ufo.position.y =
          hoverPos.y + Math.sin(t * 0.9) * 0.5 + Math.sin(t * 0.4) * 0.3;
        ufo.rotation.y += dt * 0.35;
      }
      ufo.rotation.z = THREE.MathUtils.lerp(
        ufo.rotation.z,
        -pointer.x * 0.25,
        0.05,
      );

      // Landing flash on the emissive ring + expanding ripple.
      if (landed) {
        if (landingFlash > 0) {
          landingFlash = Math.max(0, landingFlash - dt / 0.6);
          ufoRingMat.emissiveIntensity = 3.2 + landingFlash * 5;
        }
        if (rippleStart != null) {
          const rp = (now - rippleStart) / 1000 / 0.9;
          if (rp < 1) {
            rippleSprite.visible = true;
            rippleSprite.position.copy(hoverPos);
            rippleSprite.scale.setScalar(THREE.MathUtils.lerp(0.5, 9, rp));
            rippleMat.opacity = (1 - rp) * 0.9;
          } else {
            rippleSprite.visible = false;
          }
        }
      }

      // FX rig tracks the ship; beam pulses.
      ufoFx.position.copy(ufo.position);
      beamMat.opacity = 0.12 + 0.08 * (0.5 + 0.5 * Math.sin(t * 2));

      // Companion UFO drifts slowly across the back.
      smallUfo.position.x = Math.sin(t * 0.15) * 4.5;
      smallUfo.position.y = 3.2 + Math.sin(t * 0.2) * 1.2;
      smallUfo.rotation.y += dt * 0.2;

      planet.rotation.y += dt * 0.06;
      planet.position.x = planetHome.x + pointer.x * 1.0 + Math.sin(t * 0.1) * 0.4;
      planet.position.y =
        planetHome.y - pointer.y * 0.5 + Math.sin(t * 0.13) * 0.3;

      stars.rotation.y += dt * 0.01;
      brightStars.rotation.y -= dt * 0.008;
      brightMat.opacity = 0.6 + 0.4 * Math.sin(t * 1.5);

      camera.position.x = THREE.MathUtils.lerp(
        camera.position.x,
        pointer.x * 1.1,
        0.04,
      );
      camera.position.y = THREE.MathUtils.lerp(
        camera.position.y,
        -pointer.y * 0.6,
        0.04,
      );
      camera.lookAt(0, 0, 0);

      renderer.render(scene, camera);
      requestAnimationFrame(loop);
    };

    const onVisibility = () => {
      if (document.hidden) {
        running = false;
      } else if (!running) {
        running = true;
        last = performance.now();
        requestAnimationFrame(loop);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    if (reduceMotion) {
      // Static frame: UFO posed at its hover pose, FX visible, no animation loop.
      ufo.position.copy(hoverPos);
      ufo.scale.setScalar(1.7);
      ufo.rotation.y = Math.PI;
      ufoRingMat.emissiveIntensity = 3.2;
      ufoFx.position.copy(hoverPos);
      rippleSprite.visible = false;
      renderer.render(scene, camera);
    } else {
      requestAnimationFrame(loop);
    }

    return () => {
      running = false;
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVisibility);

      for (const d of disposables) d.dispose();
      if (renderer.domElement.parentNode === mount) {
        mount.removeChild(renderer.domElement);
      }
    };
  }, []);

  return <div ref={mountRef} className="space-scene-canvas" aria-hidden />;
}
