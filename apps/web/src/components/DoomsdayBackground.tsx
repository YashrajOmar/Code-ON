"use client";

import { useEffect, useRef, useState } from "react";
import { useTheme } from "@/components/ThemeProvider";

/**
 * DoomsdayBackground — Avengers cycle → Doomsday destruction.
 * 
 * Cycle (continuous):
 *   Phases 0-7: Each Avenger face shows clearly for 4s, one at a time
 *   Phase 8: DOOMSDAY — green destruction takes over:
 *     - Screen slowly turns green
 *     - Bombs falling from top with explosions
 *     - Fire particles rising
 *     - Debris flying
 *     - Screen shakes
 *   → Back to phase 0, repeat
 * 
 * Only renders when theme is "doomsday".
 */
export default function DoomsdayBackground() {
  const { theme } = useTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    if (theme !== "doomsday") return;
    setPhase(0);

    const interval = setInterval(() => {
      setPhase(p => (p + 1) % 9);
    }, 4000);

    return () => clearInterval(interval);
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

    // Particles: embers (normal), bombs (doomsday), explosions, debris
    interface Particle {
      x: number; y: number; vx: number; vy: number;
      size: number; opacity: number; hue: number;
      type: "ember" | "bomb" | "explosion" | "debris" | "fire";
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
        vx: (Math.random() - 0.5) * 1,
        vy: 3 + Math.random() * 4,
        size: 3 + Math.random() * 4,
        opacity: 1,
        hue: 120,
        type: "bomb",
        life: 0, maxLife: 200,
      });
    }

    function spawnExplosion(x: number, y: number) {
      // Main explosion flash
      for (let i = 0; i < 30; i++) {
        const angle = (Math.PI * 2 * i) / 30;
        const speed = 2 + Math.random() * 6;
        particles.push({
          x, y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          size: 2 + Math.random() * 5,
          opacity: 1,
          hue: Math.random() > 0.5 ? 120 : 60, // green or yellow-green
          type: "explosion",
          life: 0, maxLife: 40 + Math.random() * 30,
        });
      }
      // Fire particles
      for (let i = 0; i < 15; i++) {
        particles.push({
          x: x + (Math.random() - 0.5) * 30,
          y: y + (Math.random() - 0.5) * 30,
          vx: (Math.random() - 0.5) * 2,
          vy: -(1 + Math.random() * 3),
          size: 3 + Math.random() * 5,
          opacity: 0.8,
          hue: 60 + Math.random() * 60, // yellow-green to green
          type: "fire",
          life: 0, maxLife: 60 + Math.random() * 40,
        });
      }
      // Debris
      for (let i = 0; i < 10; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 2 + Math.random() * 5;
        particles.push({
          x, y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 2,
          size: 2 + Math.random() * 3,
          opacity: 0.9,
          hue: 100,
          type: "debris",
          life: 0, maxLife: 80 + Math.random() * 40,
        });
      }
      // Screen shake
      shakeX = (Math.random() - 0.5) * 15;
      shakeY = (Math.random() - 0.5) * 15;
    }

    // Click shockwaves
    interface Shockwave {
      x: number; y: number; radius: number; opacity: number; hue: number;
    }
    const shockwaves: Shockwave[] = [];

    function onPointer(e: PointerEvent) {
      shockwaves.push({
        x: e.clientX, y: e.clientY, radius: 0, opacity: 1.5, hue: 120,
      });
      spawnExplosion(e.clientX, e.clientY);
    }
    window.addEventListener("pointerdown", onPointer);

    let animationId: number;
    let frame = 0;
    let greenOverlay = 0; // 0 to 1, slowly increases during doomsday
    let lastBombFrame = 0;

    function draw() {
      const isDoomsday = phase === 8;

      // Clear with slight trail
      ctx!.fillStyle = isDoomsday ? `rgba(0, 10, 0, 0.06)` : "rgba(0, 5, 0, 0.08)";
      ctx!.fillRect(0, 0, canvas!.width, canvas!.height);
      frame++;

      // During doomsday: slowly increase green overlay
      if (isDoomsday) {
        greenOverlay = Math.min(1, greenOverlay + 0.005);
      } else {
        greenOverlay = Math.max(0, greenOverlay - 0.02);
      }

      // Screen shake during doomsday
      if (isDoomsday && frame % 30 === 0) {
        shakeX = (Math.random() - 0.5) * 8;
        shakeY = (Math.random() - 0.5) * 8;
      }
      shakeX *= 0.9;
      shakeY *= 0.9;

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
      if (particles.filter(p => p.type === "ember").length < 30 && frame % 12 === 0) spawnEmber();

      // Spawn bombs during doomsday
      if (isDoomsday && frame - lastBombFrame > 30 + Math.random() * 40) {
        spawnBomb();
        lastBombFrame = frame;
      }

      // Update + draw particles
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.life++;

        if (p.type === "bomb") {
          // Draw bomb trail
          ctx!.fillStyle = `rgba(0, 255, 157, 0.3)`;
          ctx!.beginPath();
          ctx!.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          ctx!.fill();

          // Bright head
          ctx!.fillStyle = `rgba(200, 255, 200, 0.8)`;
          ctx!.beginPath();
          ctx!.arc(p.x, p.y, p.size * 0.5, 0, Math.PI * 2);
          ctx!.fill();

          p.x += p.vx;
          p.y += p.vy;

          // Explode when hitting bottom or random
          if (p.y > canvas!.height - 50 || (p.life > 50 && Math.random() > 0.95)) {
            spawnExplosion(p.x, p.y);
            particles.splice(i, 1);
            continue;
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

          p.x += p.vx;
          p.y += p.vy;
          p.vy += 0.1; // gravity
          p.size *= 0.96;
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

          p.x += p.vx;
          p.y += p.vy;
          p.vy -= 0.05; // rise
          p.size *= 0.98;
        } else if (p.type === "debris") {
          const lifeRatio = p.life / p.maxLife;
          if (lifeRatio >= 1) { particles.splice(i, 1); continue; }
          const opacity = 1 - lifeRatio;

          ctx!.fillStyle = `hsla(${p.hue}, 60%, 40%, ${opacity * 0.7})`;
          ctx!.beginPath();
          ctx!.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          ctx!.fill();

          p.x += p.vx;
          p.y += p.vy;
          p.vy += 0.15; // gravity
          p.vx *= 0.99;
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

          p.y += p.vy;
          p.x += p.vx;
          p.opacity -= 0.002;
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

      // Green doomsday overlay (slowly fills screen)
      if (greenOverlay > 0) {
        ctx!.fillStyle = `rgba(0, 100, 50, ${greenOverlay * 0.08})`;
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
    { name: "DOCTOR DOOM", img: "/avengers/doctor-doom.jpg", glow: "rgba(0,150,255,0.15)" },
    { name: "LOKI", img: "/avengers/loki.jpg", glow: "rgba(100,200,100,0.15)" },
    { name: "SPIDER-MAN", img: "/avengers/miles-morales-spider-man-neon-pink.jpg", glow: "rgba(255,100,200,0.15)" },
    { name: "AVENGERS", img: "/avengers/marvels-avengers-marvel-superheroes-playstation-4.jpg", glow: "rgba(255,200,0,0.15)" },
  ];

  const isDoomsday = phase === 8;
  const current = isDoomsday ? null : avengers[phase];

  return (
    <>
      {/* Avenger face — one at a time, clear */}
      {!isDoomsday && current && (
        <div
          key={phase}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            pointerEvents: "none",
            background: `radial-gradient(ellipse at center, ${current.glow}, transparent 70%)`,
            animation: "avenger-fade-in 1s ease forwards",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={current.img}
            alt={current.name}
            style={{
              maxHeight: "85vh",
              maxWidth: "85vw",
              objectFit: "contain",
              opacity: 0.4,
            }}
          />
        </div>
      )}

      {/* Name watermark */}
      <div style={{
        position: "fixed",
        bottom: 20,
        right: 30,
        zIndex: 0,
        pointerEvents: "none",
        fontSize: 18,
        fontWeight: 900,
        letterSpacing: "0.3em",
        color: isDoomsday ? "#00ff66" : (current as any)?.glow?.replace("0.15", "0.3") ?? "#00ff9d",
        opacity: 0.15,
      }}>
        {isDoomsday ? "DOOMSDAY" : current?.name}
      </div>

      {/* Canvas — embers normally, bombs+explosions+fire+debris during doomsday */}
      <canvas
        ref={canvasRef}
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          width: "100vw",
          height: "100vh",
          zIndex: 1,
          pointerEvents: "none",
          opacity: 0.5,
        }}
      />

      <style>{`
        @keyframes avenger-fade-in {
          0% { opacity: 0; }
          100% { opacity: 1; }
        }
      `}</style>
    </>
  );
}
