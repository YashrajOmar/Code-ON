"use client";

import { useEffect, useRef, useState } from "react";
import { useTheme } from "@/components/ThemeProvider";

/**
 * DoomsdayBackground — Avengers cycle → Doctor Doom → Doomsday destruction.
 * 
 * Cycle (continuous, smooth transitions):
 *   Phases 0-6: Avenger faces (6s each, smooth crossfade)
 *   Phase 7: DOCTOR DOOM (6s, final face)
 *   Phase 8: DOOMSDAY — destruction takes over:
 *     - Screen slowly fills with dark green smoke
 *     - Bombs falling with trails
 *     - Explosions with fire + debris
 *     - Screen shakes
 *     - Horror atmosphere
 *   → Back to phase 0, repeat
 * 
 * Only renders when theme is "doomsday".
 */
export default function DoomsdayBackground() {
  const { theme } = useTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [phase, setPhase] = useState(0);
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    if (theme !== "doomsday") return;
    setPhase(0);

    // 6s per Avenger, 8s for Doomsday
    const timers: ReturnType<typeof setTimeout>[] = [];
    const sequence = [0, 1, 2, 3, 4, 5, 6, 7, 8];
    let accumulated = 0;
    
    for (let i = 0; i < sequence.length; i++) {
        const duration = i === 8 ? 12000 : 8000;
      timers.push(setTimeout(() => setPhase(sequence[i]), accumulated));
      accumulated += duration;
    }
    
    // Repeat cycle
    const totalDuration = accumulated;
    const repeatTimer = setInterval(() => {
      let acc = 0;
      for (let i = 0; i < sequence.length; i++) {
      const duration = i === 8 ? 12000 : 8000;
        const idx = i;
        timers.push(setTimeout(() => setPhase(sequence[idx]), acc));
        acc += duration;
      }
    }, totalDuration);

    return () => {
      timers.forEach(t => clearTimeout(t));
      clearInterval(repeatTimer);
    };
  }, [theme]);

  useEffect(() => {
    if (theme !== "doomsday") return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    function resize() {
      canvas!.width = window.innerWidth;
      canvas!.height = window.innerHeight;
    }
    resize();
    window.addEventListener("resize", resize);

    interface Particle {
      x: number; y: number; vx: number; vy: number;
      size: number; opacity: number; hue: number;
      type: "ember" | "bomb" | "explosion" | "debris" | "fire" | "smoke" | "horror";
      life: number; maxLife: number;
    }

    const particles: Particle[] = [];
    let shakeX = 0, shakeY = 0;

    function spawnEmber() {
      particles.push({
        x: Math.random() * canvas!.width,
        y: canvas!.height + 20,
        vx: (Math.random() - 0.5) * 0.3,
        vy: -(0.3 + Math.random() * 1),
        size: 1 + Math.random() * 2,
        opacity: 0.3 + Math.random() * 0.4,
        hue: 120,
        type: "ember",
        life: 0, maxLife: 300,
      });
    }

    function spawnBomb() {
      particles.push({
        x: Math.random() * canvas!.width,
        y: -20,
        vx: (Math.random() - 0.5) * 0.5,
        vy: 2.5 + Math.random() * 3,
        size: 3 + Math.random() * 3,
        opacity: 1,
        hue: 120,
        type: "bomb",
        life: 0, maxLife: 200,
      });
    }

    function spawnExplosion(x: number, y: number) {
      for (let i = 0; i < 30; i++) {
        const angle = (Math.PI * 2 * i) / 30;
        const speed = 2 + Math.random() * 6;
        particles.push({
          x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
          size: 2 + Math.random() * 5, opacity: 1,
          hue: Math.random() > 0.5 ? 120 : 60,
          type: "explosion", life: 0, maxLife: 40 + Math.random() * 30,
        });
      }
      for (let i = 0; i < 20; i++) {
        particles.push({
          x: x + (Math.random() - 0.5) * 30,
          y: y + (Math.random() - 0.5) * 30,
          vx: (Math.random() - 0.5) * 2, vy: -(1 + Math.random() * 3),
          size: 3 + Math.random() * 6, opacity: 0.8,
          hue: 60 + Math.random() * 60,
          type: "fire", life: 0, maxLife: 60 + Math.random() * 40,
        });
      }
      for (let i = 0; i < 12; i++) {
        const angle = Math.random() * Math.PI * 2;
        particles.push({
          x, y, vx: Math.cos(angle) * (2 + Math.random() * 5),
          vy: Math.sin(angle) * (2 + Math.random() * 5) - 2,
          size: 2 + Math.random() * 3, opacity: 0.9,
          hue: 100, type: "debris", life: 0, maxLife: 80 + Math.random() * 40,
        });
      }
      // Smoke after explosion
      for (let i = 0; i < 8; i++) {
        particles.push({
          x: x + (Math.random() - 0.5) * 50,
          y: y + (Math.random() - 0.5) * 30,
          vx: (Math.random() - 0.5) * 0.5,
          vy: -(0.5 + Math.random() * 1),
          size: 20 + Math.random() * 30,
          opacity: 0.3 + Math.random() * 0.3,
          hue: 100, type: "smoke", life: 0, maxLife: 120 + Math.random() * 60,
        });
      }
      shakeX = (Math.random() - 0.5) * 12;
      shakeY = (Math.random() - 0.5) * 12;
    }

    function spawnSmoke() {
      particles.push({
        x: Math.random() * canvas!.width,
        y: canvas!.height + 20,
        vx: (Math.random() - 0.5) * 0.3,
        vy: -(0.2 + Math.random() * 0.5),
        size: 30 + Math.random() * 50,
        opacity: 0.05 + Math.random() * 0.1,
        hue: 100,
        type: "smoke",
        life: 0, maxLife: 200 + Math.random() * 100,
      });
    }

    function spawnHorrorParticle() {
      const side = Math.random() * 4;
      let x = 0, y = 0, vx = 0, vy = 0;
      if (side < 1) { x = 0; y = Math.random() * canvas!.height; vx = 0.3 + Math.random(); }
      else if (side < 2) { x = canvas!.width; y = Math.random() * canvas!.height; vx = -(0.3 + Math.random()); }
      else if (side < 3) { x = Math.random() * canvas!.width; y = 0; vy = 0.3 + Math.random(); }
      else { x = Math.random() * canvas!.width; y = canvas!.height; vy = -(0.3 + Math.random()); }
      
      particles.push({
        x, y, vx, vy,
        size: 1 + Math.random() * 2,
        opacity: 0.3 + Math.random() * 0.3,
        hue: 120,
        type: "horror",
        life: 0, maxLife: 150 + Math.random() * 50,
      });
    }

    interface Shockwave {
      x: number; y: number; radius: number; opacity: number; hue: number;
    }
    const shockwaves: Shockwave[] = [];

    function onPointer(e: PointerEvent) {
      shockwaves.push({ x: e.clientX, y: e.clientY, radius: 0, opacity: 1.5, hue: 120 });
      spawnExplosion(e.clientX, e.clientY);
    }
    window.addEventListener("pointerdown", onPointer);

    let animationId: number;
    let frame = 0;
    let greenOverlay = 0;
    let lastBombFrame = 0;
    let lastSmokeFrame = 0;

    function draw() {
      const isDoomsday = phase === 8;

      // Clear with trail
      ctx!.fillStyle = isDoomsday ? `rgba(0, 8, 0, 0.04)` : "rgba(0, 5, 0, 0.06)";
      ctx!.fillRect(0, 0, canvas!.width, canvas!.height);
      frame++;

      // Green overlay slowly fills during doomsday
      if (isDoomsday) {
        greenOverlay = Math.min(1, greenOverlay + 0.002);
      } else {
        greenOverlay = Math.max(0, greenOverlay - 0.01);
      }

      // Screen shake
      if (isDoomsday && frame % 40 === 0) {
        shakeX = (Math.random() - 0.5) * 6;
        shakeY = (Math.random() - 0.5) * 6;
      }
      shakeX *= 0.92;
      shakeY *= 0.92;

      ctx!.save();
      ctx!.translate(shakeX, shakeY);

      // Arc reactor glow
      const reactorX = 60;
      const reactorY = canvas!.height - 60;
      const pulse = 0.5 + Math.sin(frame * 0.03) * 0.3;
      const reactorRadius = 50 + pulse * 15;
      const reactorGrad = ctx!.createRadialGradient(reactorX, reactorY, 0, reactorX, reactorY, reactorRadius);
      reactorGrad.addColorStop(0, `rgba(0, 255, 157, ${pulse * 0.3})`);
      reactorGrad.addColorStop(0.3, `rgba(0, 220, 100, ${pulse * 0.15})`);
      reactorGrad.addColorStop(1, `rgba(0, 0, 0, 0)`);
      ctx!.fillStyle = reactorGrad;
      ctx!.beginPath();
      ctx!.arc(reactorX, reactorY, reactorRadius, 0, Math.PI * 2);
      ctx!.fill();
      ctx!.strokeStyle = `rgba(0, 255, 157, ${pulse * 0.4})`;
      ctx!.lineWidth = 2;
      ctx!.beginPath();
      ctx!.arc(reactorX, reactorY, 15 + pulse * 4, 0, Math.PI * 2);
      ctx!.stroke();

      // Spawn embers always
      if (particles.filter(p => p.type === "ember").length < 25 && frame % 15 === 0) spawnEmber();

      // Doomsday spawns
      if (isDoomsday) {
        if (frame - lastBombFrame > 50 + Math.random() * 60) {
          spawnBomb();
          lastBombFrame = frame;
        }
        if (frame - lastSmokeFrame > 20) {
          spawnSmoke();
          lastSmokeFrame = frame;
        }
        if (frame % 30 === 0 && Math.random() > 0.5) {
          spawnHorrorParticle();
        }
      }

      // Draw particles
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.life++;

        if (p.type === "bomb") {
          ctx!.fillStyle = `rgba(0, 255, 157, 0.4)`;
          ctx!.beginPath();
          ctx!.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          ctx!.fill();
          ctx!.fillStyle = `rgba(200, 255, 200, 0.9)`;
          ctx!.beginPath();
          ctx!.arc(p.x, p.y, p.size * 0.5, 0, Math.PI * 2);
          ctx!.fill();
          p.x += p.vx;
          p.y += p.vy;
          if (p.y > canvas!.height - 50 || (p.life > 50 && Math.random() > 0.95)) {
            spawnExplosion(p.x, p.y);
            particles.splice(i, 1);
          }
        } else if (p.type === "explosion") {
          const lifeRatio = p.life / p.maxLife;
          if (lifeRatio >= 1) { particles.splice(i, 1); continue; }
          const opacity = 1 - lifeRatio;
          const grad = ctx!.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size);
          grad.addColorStop(0, `hsla(${p.hue}, 100%, 85%, ${opacity})`);
          grad.addColorStop(0.5, `hsla(${p.hue}, 100%, 60%, ${opacity * 0.5})`);
          grad.addColorStop(1, `hsla(${p.hue}, 100%, 40%, 0)`);
          ctx!.fillStyle = grad;
          ctx!.beginPath();
          ctx!.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          ctx!.fill();
          p.x += p.vx; p.y += p.vy; p.vy += 0.1; p.size *= 0.96;
        } else if (p.type === "fire") {
          const lifeRatio = p.life / p.maxLife;
          if (lifeRatio >= 1) { particles.splice(i, 1); continue; }
          const opacity = (1 - lifeRatio) * 0.8;
          const grad = ctx!.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size * 2);
          grad.addColorStop(0, `hsla(${p.hue}, 100%, 70%, ${opacity})`);
          grad.addColorStop(0.5, `hsla(${p.hue}, 100%, 50%, ${opacity * 0.3})`);
          grad.addColorStop(1, `hsla(${p.hue}, 100%, 40%, 0)`);
          ctx!.fillStyle = grad;
          ctx!.beginPath();
          ctx!.arc(p.x, p.y, p.size * 2, 0, Math.PI * 2);
          ctx!.fill();
          ctx!.fillStyle = `hsla(${p.hue}, 100%, 80%, ${opacity * 0.5})`;
          ctx!.beginPath();
          ctx!.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          ctx!.fill();
          p.x += p.vx; p.y += p.vy; p.vy -= 0.05; p.size *= 0.98;
        } else if (p.type === "smoke") {
          const lifeRatio = p.life / p.maxLife;
          if (lifeRatio >= 1) { particles.splice(i, 1); continue; }
          const opacity = (1 - lifeRatio) * p.opacity;
          const size = p.size * (1 + lifeRatio * 2); // grows
          const grad = ctx!.createRadialGradient(p.x, p.y, 0, p.x, p.y, size);
          grad.addColorStop(0, `hsla(${p.hue}, 30%, 20%, ${opacity})`);
          grad.addColorStop(0.5, `hsla(${p.hue}, 20%, 15%, ${opacity * 0.5})`);
          grad.addColorStop(1, `hsla(${p.hue}, 10%, 10%, 0)`);
          ctx!.fillStyle = grad;
          ctx!.beginPath();
          ctx!.arc(p.x, p.y, size, 0, Math.PI * 2);
          ctx!.fill();
          p.x += p.vx; p.y += p.vy;
        } else if (p.type === "debris") {
          const lifeRatio = p.life / p.maxLife;
          if (lifeRatio >= 1) { particles.splice(i, 1); continue; }
          const opacity = 1 - lifeRatio;
          ctx!.fillStyle = `hsla(${p.hue}, 60%, 40%, ${opacity * 0.7})`;
          ctx!.beginPath();
          ctx!.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          ctx!.fill();
          p.x += p.vx; p.y += p.vy; p.vy += 0.15; p.vx *= 0.99;
        } else if (p.type === "horror") {
          const lifeRatio = p.life / p.maxLife;
          if (lifeRatio >= 1) { particles.splice(i, 1); continue; }
          const opacity = (1 - lifeRatio) * p.opacity;
          ctx!.fillStyle = `hsla(${p.hue}, 100%, 60%, ${opacity})`;
          ctx!.beginPath();
          ctx!.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          ctx!.fill();
          // Glow
          ctx!.fillStyle = `hsla(${p.hue}, 100%, 80%, ${opacity * 0.3})`;
          ctx!.beginPath();
          ctx!.arc(p.x, p.y, p.size * 3, 0, Math.PI * 2);
          ctx!.fill();
          p.x += p.vx; p.y += p.vy;
        } else {
          // ember
          if (p.opacity <= 0 || p.y < -20) { particles.splice(i, 1); continue; }
          const grad = ctx!.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size * 3);
          grad.addColorStop(0, `hsla(${p.hue}, 100%, 70%, ${p.opacity})`);
          grad.addColorStop(0.5, `hsla(${p.hue}, 100%, 50%, ${p.opacity * 0.3})`);
          grad.addColorStop(1, `hsla(${p.hue}, 100%, 40%, 0)`);
          ctx!.fillStyle = grad;
          ctx!.beginPath();
          ctx!.arc(p.x, p.y, p.size * 3, 0, Math.PI * 2);
          ctx!.fill();
          ctx!.fillStyle = `hsla(${p.hue}, 100%, 80%, ${p.opacity})`;
          ctx!.beginPath();
          ctx!.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          ctx!.fill();
          p.y += p.vy; p.x += p.vx; p.opacity -= 0.002;
        }
      }

      // Shockwaves
      for (let i = shockwaves.length - 1; i >= 0; i--) {
        const s = shockwaves[i];
        s.radius += 4;
        s.opacity -= 0.015;
        if (s.opacity <= 0) { shockwaves.splice(i, 1); continue; }
        const grad = ctx!.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.radius);
        grad.addColorStop(0, `hsla(${s.hue}, 100%, 85%, ${s.opacity * 0.6})`);
        grad.addColorStop(0.3, `hsla(${s.hue}, 100%, 70%, ${s.opacity * 0.4})`);
        grad.addColorStop(1, `hsla(${s.hue}, 100%, 50%, 0)`);
        ctx!.fillStyle = grad;
        ctx!.beginPath();
        ctx!.arc(s.x, s.y, s.radius, 0, Math.PI * 2);
        ctx!.fill();
        ctx!.strokeStyle = `hsla(${s.hue}, 100%, 90%, ${s.opacity})`;
        ctx!.lineWidth = 3;
        ctx!.beginPath();
        ctx!.arc(s.x, s.y, s.radius, 0, Math.PI * 2);
        ctx!.stroke();
        ctx!.fillStyle = `hsla(${s.hue}, 100%, 95%, ${s.opacity * 0.8})`;
        ctx!.beginPath();
        ctx!.arc(s.x, s.y, 6, 0, Math.PI * 2);
        ctx!.fill();
        ctx!.strokeStyle = `hsla(${s.hue}, 100%, 100%, ${s.opacity})`;
        ctx!.lineWidth = 2;
        const sparkLen = s.radius * 0.3;
        ctx!.beginPath();
        ctx!.moveTo(s.x - sparkLen, s.y);
        ctx!.lineTo(s.x + sparkLen, s.y);
        ctx!.moveTo(s.x, s.y - sparkLen);
        ctx!.lineTo(s.x, s.y + sparkLen);
        ctx!.stroke();
      }

      ctx!.restore();

      // Green doomsday overlay (slowly fills, darker = more horror)
      if (greenOverlay > 0) {
        ctx!.fillStyle = `rgba(0, 60, 30, ${greenOverlay * 0.06})`;
        ctx!.fillRect(0, 0, canvas!.width, canvas!.height);
        // Dark vignette during doomsday
        const vignette = ctx!.createRadialGradient(
          canvas!.width / 2, canvas!.height / 2, 0,
          canvas!.width / 2, canvas!.height / 2, Math.max(canvas!.width, canvas!.height) / 2
        );
        vignette.addColorStop(0, "rgba(0,0,0,0)");
        vignette.addColorStop(1, `rgba(0, 20, 0, ${greenOverlay * 0.5})`);
        ctx!.fillStyle = vignette;
        ctx!.fillRect(0, 0, canvas!.width, canvas!.height);
      }

      animationId = requestAnimationFrame(draw);
    }
    draw();

    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointerdown", onPointer);
    };
  }, [theme, phase]);

  if (theme !== "doomsday") return null;

  const avengers = [
    { name: "IRON MAN", img: "/avengers/neon-iron-man.jpg", glow: "rgba(255,184,0,0.15)" },
    { name: "CAPTAIN AMERICA", img: "/avengers/chris-evans-captain.jpg", glow: "rgba(230,57,70,0.15)" },
    { name: "HULK", img: "/avengers/hulk-artwork-marvel.jpg", glow: "rgba(46,204,113,0.15)" },
    { name: "DEADPOOL", img: "/avengers/deadpool-3.jpg", glow: "rgba(230,57,70,0.15)" },
    { name: "LOKI", img: "/avengers/loki.jpg", glow: "rgba(100,200,100,0.15)" },
    { name: "SPIDER-MAN", img: "/avengers/miles-morales-spider-man-neon-pink.jpg", glow: "rgba(255,100,200,0.15)" },
    { name: "AVENGERS", img: "/avengers/marvels-avengers-marvel-superheroes-playstation-4.jpg", glow: "rgba(255,200,0,0.15)" },
    // Doctor Doom is last
    { name: "DOCTOR DOOM", img: "/avengers/doctor-doom.jpg", glow: "rgba(0,150,255,0.15)" },
  ];

  const isDoomsday = phase === 8;
  const current = isDoomsday ? null : avengers[phase];

  return (
    <>
      {/* Avenger face — smooth crossfade */}
      {!isDoomsday && current && (
        <div
          key={phase}
          style={{
            position: "fixed", inset: 0, zIndex: 0,
            display: "flex", alignItems: "center", justifyContent: "center",
            pointerEvents: "none",
            background: `radial-gradient(ellipse at center, ${current.glow}, transparent 70%)`,
            animation: "avenger-fade 3s ease-in-out forwards",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={current.img}
            alt={current.name}
            style={{
              maxHeight: "85vh", maxWidth: "85vw",
              objectFit: "contain", opacity: 0.4,
            }}
          />
        </div>
      )}

      {/* Name watermark */}
      <div style={{
        position: "fixed", bottom: 20, right: 30, zIndex: 0,
        pointerEvents: "none", fontSize: 18, fontWeight: 900,
        letterSpacing: "0.3em",
        color: isDoomsday ? "#00ff66" : "#888",
        opacity: 0.15,
        transition: "color 2s ease",
      }}>
        {isDoomsday ? "DOOMSDAY" : current?.name}
      </div>

      {/* Canvas */}
      <canvas
        ref={canvasRef}
        style={{
          position: "fixed", top: 0, left: 0,
          width: "100vw", height: "100vh",
          zIndex: 1, pointerEvents: "none", opacity: 0.5,
        }}
      />

      {/* Mute button */}
      <button
        onClick={() => setMuted(!muted)}
        style={{
          position: "fixed", bottom: 20, left: 20, zIndex: 9995,
          background: "rgba(0,20,0,0.6)", border: "1px solid rgba(0,255,157,0.3)",
          color: "#00ff9d", fontSize: 12, padding: "6px 12px",
          borderRadius: 8, cursor: "pointer", fontWeight: 600,
        }}
      >
        {muted ? "🔇" : "🔊"}
      </button>

      {/* Audio — Hanging Tree style ambient horror music */}
      <audio
        ref={audioRef}
        loop
        autoPlay
        muted={muted}
        style={{ display: "none" }}
      >
        <source src="https://cdn.pixabay.com/audio/2022/10/30/audio_347a343730.mp3" type="audio/mpeg" />
      </audio>

      <style>{`
        @keyframes avenger-fade {
          0% { opacity: 0; transform: scale(1.05); }
          20% { opacity: 1; transform: scale(1); }
          80% { opacity: 1; transform: scale(1); }
          100% { opacity: 0.8; transform: scale(0.98); }
        }
      `}</style>
    </>
  );
}
