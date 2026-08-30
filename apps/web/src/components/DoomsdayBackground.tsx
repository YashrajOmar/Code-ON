"use client";

import { useEffect, useRef, useState } from "react";
import { useTheme } from "@/components/ThemeProvider";

/**
 * DoomsdayBackground — Avengers cycle → Doctor Doom → Doomsday destruction.
 * 
 * Smooth crossfade: old image fades out while new image fades in simultaneously.
 * No "gallery flip" — both images stay mounted during the 4s transition.
 */
export default function DoomsdayBackground() {
  const { theme } = useTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [phase, setPhase] = useState(0);
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    if (theme !== "doomsday") return;
    setPhase(0);

    const timers: ReturnType<typeof setTimeout>[] = [];
    const sequence = [0, 1, 2, 3, 4, 5, 6, 7, 8];
    let accumulated = 0;

    for (let i = 0; i < sequence.length; i++) {
      const duration = i === 8 ? 12000 : 8000;
      timers.push(setTimeout(() => setPhase(sequence[i]), accumulated));
      accumulated += duration;
    }

    const totalDuration = accumulated;
    const repeatTimer = setInterval(() => {
      let acc = 0;
      for (let i = 0; i < sequence.length; i++) {
        const duration = i === 8 ? 12000 : 8000;
        timers.push(setTimeout(() => setPhase(sequence[i]), acc));
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
        x: Math.random() * canvas!.width, y: canvas!.height + 20,
        vx: (Math.random() - 0.5) * 0.3, vy: -(0.3 + Math.random() * 1),
        size: 1 + Math.random() * 2, opacity: 0.3 + Math.random() * 0.4,
        hue: 120, type: "ember", life: 0, maxLife: 300,
      });
    }

    function spawnBomb() {
      particles.push({
        x: Math.random() * canvas!.width, y: -20,
        vx: (Math.random() - 0.5) * 0.5, vy: 2.5 + Math.random() * 3,
        size: 3 + Math.random() * 3, opacity: 1, hue: 120,
        type: "bomb", life: 0, maxLife: 200,
      });
    }

    function spawnExplosion(x: number, y: number) {
      for (let i = 0; i < 30; i++) {
        const angle = (Math.PI * 2 * i) / 30;
        const speed = 2 + Math.random() * 6;
        particles.push({
          x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
          size: 2 + Math.random() * 5, opacity: 1,
          hue: Math.random() > 0.5 ? 120 : 60, type: "explosion",
          life: 0, maxLife: 40 + Math.random() * 30,
        });
      }
      for (let i = 0; i < 20; i++) {
        particles.push({
          x: x + (Math.random() - 0.5) * 30, y: y + (Math.random() - 0.5) * 30,
          vx: (Math.random() - 0.5) * 2, vy: -(1 + Math.random() * 3),
          size: 3 + Math.random() * 6, opacity: 0.8,
          hue: 60 + Math.random() * 60, type: "fire",
          life: 0, maxLife: 60 + Math.random() * 40,
        });
      }
      for (let i = 0; i < 12; i++) {
        const angle = Math.random() * Math.PI * 2;
        particles.push({
          x, y, vx: Math.cos(angle) * (2 + Math.random() * 5),
          vy: Math.sin(angle) * (2 + Math.random() * 5) - 2,
          size: 2 + Math.random() * 3, opacity: 0.9, hue: 100,
          type: "debris", life: 0, maxLife: 80 + Math.random() * 40,
        });
      }
      for (let i = 0; i < 8; i++) {
        particles.push({
          x: x + (Math.random() - 0.5) * 50, y: y + (Math.random() - 0.5) * 30,
          vx: (Math.random() - 0.5) * 0.5, vy: -(0.5 + Math.random() * 1),
          size: 20 + Math.random() * 30, opacity: 0.3 + Math.random() * 0.3,
          hue: 100, type: "smoke", life: 0, maxLife: 120 + Math.random() * 60,
        });
      }
      shakeX = (Math.random() - 0.5) * 12;
      shakeY = (Math.random() - 0.5) * 12;
    }

    function spawnSmoke() {
      particles.push({
        x: Math.random() * canvas!.width, y: canvas!.height + 20,
        vx: (Math.random() - 0.5) * 0.3, vy: -(0.2 + Math.random() * 0.5),
        size: 30 + Math.random() * 50, opacity: 0.05 + Math.random() * 0.1,
        hue: 100, type: "smoke", life: 0, maxLife: 200 + Math.random() * 100,
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
        x, y, vx, vy, size: 1 + Math.random() * 2,
        opacity: 0.3 + Math.random() * 0.3, hue: 120,
        type: "horror", life: 0, maxLife: 150 + Math.random() * 50,
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
      ctx!.fillStyle = isDoomsday ? `rgba(0, 8, 0, 0.04)` : "rgba(0, 5, 0, 0.06)";
      ctx!.fillRect(0, 0, canvas!.width, canvas!.height);
      frame++;

      if (isDoomsday) greenOverlay = Math.min(1, greenOverlay + 0.002);
      else greenOverlay = Math.max(0, greenOverlay - 0.01);

      if (isDoomsday && frame % 40 === 0) {
        shakeX = (Math.random() - 0.5) * 6;
        shakeY = (Math.random() - 0.5) * 6;
      }
      shakeX *= 0.92;
      shakeY *= 0.92;

      ctx!.save();
      ctx!.translate(shakeX, shakeY);

      const reactorX = 60, reactorY = canvas!.height - 60;
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

      if (particles.filter(p => p.type === "ember").length < 25 && frame % 15 === 0) spawnEmber();

      if (isDoomsday) {
        if (frame - lastBombFrame > 50 + Math.random() * 60) { spawnBomb(); lastBombFrame = frame; }
        if (frame - lastSmokeFrame > 20) { spawnSmoke(); lastSmokeFrame = frame; }
        if (frame % 30 === 0 && Math.random() > 0.5) spawnHorrorParticle();
      }

      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.life++;

        if (p.type === "bomb") {
          ctx!.fillStyle = `rgba(0, 255, 157, 0.4)`;
          ctx!.beginPath(); ctx!.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx!.fill();
          ctx!.fillStyle = `rgba(200, 255, 200, 0.9)`;
          ctx!.beginPath(); ctx!.arc(p.x, p.y, p.size * 0.5, 0, Math.PI * 2); ctx!.fill();
          p.x += p.vx; p.y += p.vy;
          if (p.y > canvas!.height - 50 || (p.life > 50 && Math.random() > 0.95)) {
            spawnExplosion(p.x, p.y); particles.splice(i, 1);
          }
        } else if (p.type === "explosion") {
          const lr = p.life / p.maxLife;
          if (lr >= 1) { particles.splice(i, 1); continue; }
          const op = 1 - lr;
          const g = ctx!.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size);
          g.addColorStop(0, `hsla(${p.hue}, 100%, 85%, ${op})`);
          g.addColorStop(0.5, `hsla(${p.hue}, 100%, 60%, ${op * 0.5})`);
          g.addColorStop(1, `hsla(${p.hue}, 100%, 40%, 0)`);
          ctx!.fillStyle = g;
          ctx!.beginPath(); ctx!.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx!.fill();
          p.x += p.vx; p.y += p.vy; p.vy += 0.1; p.size *= 0.96;
        } else if (p.type === "fire") {
          const lr = p.life / p.maxLife;
          if (lr >= 1) { particles.splice(i, 1); continue; }
          const op = (1 - lr) * 0.8;
          const g = ctx!.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size * 2);
          g.addColorStop(0, `hsla(${p.hue}, 100%, 70%, ${op})`);
          g.addColorStop(0.5, `hsla(${p.hue}, 100%, 50%, ${op * 0.3})`);
          g.addColorStop(1, `hsla(${p.hue}, 100%, 40%, 0)`);
          ctx!.fillStyle = g;
          ctx!.beginPath(); ctx!.arc(p.x, p.y, p.size * 2, 0, Math.PI * 2); ctx!.fill();
          ctx!.fillStyle = `hsla(${p.hue}, 100%, 80%, ${op * 0.5})`;
          ctx!.beginPath(); ctx!.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx!.fill();
          p.x += p.vx; p.y += p.vy; p.vy -= 0.05; p.size *= 0.98;
        } else if (p.type === "smoke") {
          const lr = p.life / p.maxLife;
          if (lr >= 1) { particles.splice(i, 1); continue; }
          const op = (1 - lr) * p.opacity;
          const sz = p.size * (1 + lr * 2);
          const g = ctx!.createRadialGradient(p.x, p.y, 0, p.x, p.y, sz);
          g.addColorStop(0, `hsla(${p.hue}, 30%, 20%, ${op})`);
          g.addColorStop(0.5, `hsla(${p.hue}, 20%, 15%, ${op * 0.5})`);
          g.addColorStop(1, `hsla(${p.hue}, 10%, 10%, 0)`);
          ctx!.fillStyle = g;
          ctx!.beginPath(); ctx!.arc(p.x, p.y, sz, 0, Math.PI * 2); ctx!.fill();
          p.x += p.vx; p.y += p.vy;
        } else if (p.type === "debris") {
          const lr = p.life / p.maxLife;
          if (lr >= 1) { particles.splice(i, 1); continue; }
          const op = 1 - lr;
          ctx!.fillStyle = `hsla(${p.hue}, 60%, 40%, ${op * 0.7})`;
          ctx!.beginPath(); ctx!.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx!.fill();
          p.x += p.vx; p.y += p.vy; p.vy += 0.15; p.vx *= 0.99;
        } else if (p.type === "horror") {
          const lr = p.life / p.maxLife;
          if (lr >= 1) { particles.splice(i, 1); continue; }
          const op = (1 - lr) * p.opacity;
          ctx!.fillStyle = `hsla(${p.hue}, 100%, 60%, ${op})`;
          ctx!.beginPath(); ctx!.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx!.fill();
          ctx!.fillStyle = `hsla(${p.hue}, 100%, 80%, ${op * 0.3})`;
          ctx!.beginPath(); ctx!.arc(p.x, p.y, p.size * 3, 0, Math.PI * 2); ctx!.fill();
          p.x += p.vx; p.y += p.vy;
        } else {
          if (p.opacity <= 0 || p.y < -20) { particles.splice(i, 1); continue; }
          const g = ctx!.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size * 3);
          g.addColorStop(0, `hsla(${p.hue}, 100%, 70%, ${p.opacity})`);
          g.addColorStop(0.5, `hsla(${p.hue}, 100%, 50%, ${p.opacity * 0.3})`);
          g.addColorStop(1, `hsla(${p.hue}, 100%, 40%, 0)`);
          ctx!.fillStyle = g;
          ctx!.beginPath(); ctx!.arc(p.x, p.y, p.size * 3, 0, Math.PI * 2); ctx!.fill();
          ctx!.fillStyle = `hsla(${p.hue}, 100%, 80%, ${p.opacity})`;
          ctx!.beginPath(); ctx!.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx!.fill();
          p.y += p.vy; p.x += p.vx; p.opacity -= 0.002;
        }
      }

      for (let i = shockwaves.length - 1; i >= 0; i--) {
        const s = shockwaves[i];
        s.radius += 4; s.opacity -= 0.015;
        if (s.opacity <= 0) { shockwaves.splice(i, 1); continue; }
        const g = ctx!.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.radius);
        g.addColorStop(0, `hsla(${s.hue}, 100%, 85%, ${s.opacity * 0.6})`);
        g.addColorStop(0.3, `hsla(${s.hue}, 100%, 70%, ${s.opacity * 0.4})`);
        g.addColorStop(1, `hsla(${s.hue}, 100%, 50%, 0)`);
        ctx!.fillStyle = g;
        ctx!.beginPath(); ctx!.arc(s.x, s.y, s.radius, 0, Math.PI * 2); ctx!.fill();
        ctx!.strokeStyle = `hsla(${s.hue}, 100%, 90%, ${s.opacity})`;
        ctx!.lineWidth = 3;
        ctx!.beginPath(); ctx!.arc(s.x, s.y, s.radius, 0, Math.PI * 2); ctx!.stroke();
        ctx!.fillStyle = `hsla(${s.hue}, 100%, 95%, ${s.opacity * 0.8})`;
        ctx!.beginPath(); ctx!.arc(s.x, s.y, 6, 0, Math.PI * 2); ctx!.fill();
        ctx!.strokeStyle = `hsla(${s.hue}, 100%, 100%, ${s.opacity})`;
        ctx!.lineWidth = 2;
        const sl = s.radius * 0.3;
        ctx!.beginPath();
        ctx!.moveTo(s.x - sl, s.y); ctx!.lineTo(s.x + sl, s.y);
        ctx!.moveTo(s.x, s.y - sl); ctx!.lineTo(s.x, s.y + sl);
        ctx!.stroke();
      }

      ctx!.restore();

      if (greenOverlay > 0) {
        ctx!.fillStyle = `rgba(0, 60, 30, ${greenOverlay * 0.06})`;
        ctx!.fillRect(0, 0, canvas!.width, canvas!.height);
        const vg = ctx!.createRadialGradient(
          canvas!.width / 2, canvas!.height / 2, 0,
          canvas!.width / 2, canvas!.height / 2, Math.max(canvas!.width, canvas!.height) / 2
        );
        vg.addColorStop(0, "rgba(0,0,0,0)");
        vg.addColorStop(1, `rgba(0, 20, 0, ${greenOverlay * 0.5})`);
        ctx!.fillStyle = vg;
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
    { name: "DOCTOR DOOM", img: "/avengers/doctor-doom.jpg", glow: "rgba(0,150,255,0.15)" },
  ];

  const isDoomsday = phase === 8;

  // Render ALL avenger layers simultaneously, each with its own opacity
  // based on distance from current phase. Only the current one is fully visible,
  // adjacent ones fade in/out smoothly. No unmount = no gallery flip.
  return (
    <>
      {/* All Avenger images stacked, each crossfading independently */}
      {avengers.map((av, i) => {
        // Calculate opacity based on distance from current phase
        let opacity = 0;
        if (i === phase) {
          opacity = 1; // fully visible
        } else if (i === phase - 1) {
          opacity = 0; // just left — already faded out
        }

        return (
          <div
            key={i}
            style={{
              position: "fixed", inset: 0, zIndex: 0,
              display: "flex", alignItems: "center", justifyContent: "center",
              pointerEvents: "none",
              background: `radial-gradient(ellipse at center, ${av.glow}, transparent 70%)`,
              opacity: opacity,
              transition: "opacity 4s ease-in-out",
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={av.img}
              alt={av.name}
              style={{
                maxHeight: "85vh", maxWidth: "85vw",
                objectFit: "contain", opacity: 0.4,
              }}
            />
          </div>
        );
      })}

      {/* Name watermark */}
      <div style={{
        position: "fixed", bottom: 20, right: 30, zIndex: 0,
        pointerEvents: "none", fontSize: 18, fontWeight: 900,
        letterSpacing: "0.3em",
        color: isDoomsday ? "#00ff66" : "#888",
        opacity: 0.15, transition: "color 4s ease, opacity 4s ease",
      }}>
        {isDoomsday ? "DOOMSDAY" : avengers[phase]?.name}
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

      {/* Audio */}
      <audio loop autoPlay muted={muted} style={{ display: "none" }}>
        <source src="https://cdn.pixabay.com/audio/2022/10/30/audio_347a343730.mp3" type="audio/mpeg" />
      </audio>
    </>
  );
}
