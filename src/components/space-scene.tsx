"use client";

/**
 * 3D ambient backdrop (raw Three.js, no react-three-fiber).
 *
 * A low-poly UFO arcs in from off-screen on load, then settles into a slow
 * idle hover. A ringed planet drifts in the background and everything reacts
 * subtly to the pointer for parallax depth. The canvas is transparent so the
 * CSS nebula/starfield behind it still reads through.
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
    camera.position.set(0, 0, 14);

    // --- Lighting (tuned to the lime/violet/sky accent system) -------------
    scene.add(new THREE.AmbientLight(0x223355, 1.2));
    const key = new THREE.DirectionalLight(0xa3e635, 1.4);
    key.position.set(5, 6, 8);
    scene.add(key);
    const rim = new THREE.PointLight(0xa78bfa, 2.2, 40);
    rim.position.set(-6, -2, 6);
    scene.add(rim);

    // --- UFO -----------------------------------------------------------------
    const ufo = new THREE.Group();

    const bodyGeo = new THREE.CylinderGeometry(1.6, 1.6, 0.5, 32);
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x1a2233,
      metalness: 0.8,
      roughness: 0.35,
    });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.scale.y = 0.35;
    ufo.add(body);

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
      emissiveIntensity: 0.4,
      transparent: true,
      opacity: 0.85,
    });
    const dome = new THREE.Mesh(domeGeo, domeMat);
    dome.position.y = 0.18;
    ufo.add(dome);

    const ringGeo = new THREE.TorusGeometry(1.6, 0.08, 16, 48);
    const ringMat = new THREE.MeshStandardMaterial({
      color: 0xa3e635,
      emissive: 0xa3e635,
      emissiveIntensity: 2.2,
      metalness: 0.4,
      roughness: 0.3,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = Math.PI / 2;
    ufo.add(ring);

    const lightGeo = new THREE.SphereGeometry(0.12, 12, 12);
    const lightMat = new THREE.MeshStandardMaterial({
      color: 0xa3e635,
      emissive: 0xa3e635,
      emissiveIntensity: 3,
    });
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const bulb = new THREE.Mesh(lightGeo, lightMat);
      bulb.position.set(Math.cos(a) * 1.2, -0.18, Math.sin(a) * 1.2);
      ufo.add(bulb);
    }

    ufo.scale.setScalar(1.1);
    scene.add(ufo);

    // --- Ringed planet (background) -----------------------------------------
    const planet = new THREE.Group();
    const planetGeo = new THREE.SphereGeometry(2.4, 48, 48);
    const planetMat = new THREE.MeshStandardMaterial({
      color: 0x2a1f4a,
      roughness: 0.9,
      metalness: 0.1,
      emissive: 0x140a2a,
      emissiveIntensity: 0.3,
    });
    planet.add(new THREE.Mesh(planetGeo, planetMat));

    const planetRingGeo = new THREE.RingGeometry(3.2, 4.6, 64);
    const planetRingMat = new THREE.MeshBasicMaterial({
      color: 0xa78bfa,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.35,
    });
    const planetRing = new THREE.Mesh(planetRingGeo, planetRingMat);
    planetRing.rotation.x = Math.PI / 2.4;
    planetRing.rotation.y = 0.3;
    planet.add(planetRing);

    const planetHome = new THREE.Vector3(-5.5, 2.5, -8);
    planet.position.copy(planetHome);
    planet.scale.setScalar(0.9);
    scene.add(planet);

    // --- 3D starfield (adds depth behind the CSS starfield) -----------------
    const starCount = 400;
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
      opacity: 0.7,
      sizeAttenuation: true,
    });
    const stars = new THREE.Points(starGeo, starMat);
    scene.add(stars);

    // --- Entrance: arc in from off-screen, then idle hover ------------------
    const startPos = new THREE.Vector3(9, 6, 2);
    const hoverPos = new THREE.Vector3(3.2, 1.6, 0);
    ufo.position.copy(startPos);
    const entranceDuration = reduceMotion ? 0 : 2.6; // seconds
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

    const loop = () => {
      if (!running) return;
      const now = performance.now();
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      const t = (now - startTime) / 1000;

      if (t < entranceDuration) {
        const p = t / entranceDuration;
        const e = 1 - Math.pow(1 - p, 3); // easeOutCubic
        ufo.position.lerpVectors(startPos, hoverPos, e);
        ufo.rotation.y = e * Math.PI * 2;
      } else {
        ufo.position.x = hoverPos.x + Math.sin(t * 0.6) * 0.4;
        ufo.position.y = hoverPos.y + Math.sin(t * 1.1) * 0.18;
        ufo.rotation.y += dt * 0.3;
      }
      ufo.rotation.z = THREE.MathUtils.lerp(
        ufo.rotation.z,
        -pointer.x * 0.15,
        0.05,
      );

      planet.rotation.y += dt * 0.05;
      planet.position.x = planetHome.x + pointer.x * 0.6;
      planet.position.y = planetHome.y - pointer.y * 0.4;

      stars.rotation.y += dt * 0.01;

      camera.position.x = THREE.MathUtils.lerp(
        camera.position.x,
        pointer.x * 0.6,
        0.04,
      );
      camera.position.y = THREE.MathUtils.lerp(
        camera.position.y,
        -pointer.y * 0.4,
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
      // Static frame: UFO parked at its hover pose, no animation loop.
      ufo.position.copy(hoverPos);
      ufo.rotation.y = Math.PI;
      renderer.render(scene, camera);
    } else {
      requestAnimationFrame(loop);
    }

    return () => {
      running = false;
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVisibility);

      bodyGeo.dispose();
      bodyMat.dispose();
      domeGeo.dispose();
      domeMat.dispose();
      ringGeo.dispose();
      ringMat.dispose();
      lightGeo.dispose();
      lightMat.dispose();
      planetGeo.dispose();
      planetMat.dispose();
      planetRingGeo.dispose();
      planetRingMat.dispose();
      starGeo.dispose();
      starMat.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) {
        mount.removeChild(renderer.domElement);
      }
    };
  }, []);

  return <div ref={mountRef} className="space-scene-canvas" aria-hidden />;
}
