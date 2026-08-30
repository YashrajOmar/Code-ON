"use client";

import { useEffect, useRef, useState } from "react";
import { useTheme } from "@/components/ThemeProvider";

/**
 * DoomsdayBackground — Animated Avengers + Doomsday background.
 * 
 * Shows stylized Avenger silhouettes cycling in the background with
 * their iconic colors, then green doomsday energy overlay.
 * Runs continuously, behind content (z-index 0).
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

    // Cycle phases: 0=Iron Man, 1=Thor, 2=Hulk, 3=Cap, 4=Snap(transition to green)
    const interval = setInterval(() => {
      setPhase(p => (p + 1) % 5);
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

    // Ember particles (green after snap, themed colors during avenger phases)
    interface Ember {
      x: number; y: number; size: number;
      speedY: number; speedX: number;
      opacity: number; hue: number; flicker: number;
    }

    const embers: Ember[] = [];
    const maxEmbers = 40;

    function spawnEmber(hue: number) {
      embers.push({
        x: Math.random() * canvas!.width,
        y: canvas!.height + Math.random() * 100,
        size: 1 + Math.random() * 3,
        speedY: -(0.3 + Math.random() * 1),
        speedX: (Math.random() - 0.5) * 0.3,
        opacity: 0.3 + Math.random() * 0.4,
        hue,
        flicker: Math.random() * Math.PI * 2,
      });
    }

    for (let i = 0; i < 20; i++) {
      spawnEmber(120);
      embers[i].y = Math.random() * canvas!.height;
    }

    // Click shockwaves
    interface Shockwave {
      x: number; y: number; radius: number; opacity: number; hue: number;
    }
    const shockwaves: Shockwave[] = [];

    function onPointer(e: PointerEvent) {
      shockwaves.push({
        x: e.clientX, y: e.clientY, radius: 0,
        opacity: 1.5, hue: 120,
      });
      for (let i = 0; i < 12; i++) {
        const angle = (Math.PI * 2 * i) / 12;
        embers.push({
          x: e.clientX, y: e.clientY,
          size: 2 + Math.random() * 3,
          speedY: Math.sin(angle) * (1 + Math.random() * 2),
          speedX: Math.cos(angle) * (1 + Math.random() * 2),
          opacity: 0.8, hue: 120,
          flicker: Math.random() * Math.PI * 2,
        });
      }
    }
    window.addEventListener("pointerdown", onPointer);

    let animationId: number;
    let frame = 0;

    function draw() {
      ctx!.fillStyle = "rgba(0, 5, 0, 0.08)";
      ctx!.fillRect(0, 0, canvas!.width, canvas!.height);
      frame++;

      // Arc reactor glow (green)
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

      // Spawn embers
      if (embers.length < maxEmbers && frame % 12 === 0) spawnEmber(120);

      for (let i = embers.length - 1; i >= 0; i--) {
        const e = embers[i];
        e.flicker += 0.08;
        const flickerOpacity = e.opacity * (0.7 + Math.sin(e.flicker) * 0.3);

        const grad = ctx!.createRadialGradient(e.x, e.y, 0, e.x, e.y, e.size * 3);
        grad.addColorStop(0, `hsla(${e.hue}, 100%, 70%, ${flickerOpacity})`);
        grad.addColorStop(0.5, `hsla(${e.hue}, 100%, 50%, ${flickerOpacity * 0.3})`);
        grad.addColorStop(1, `hsla(${e.hue}, 100%, 40%, 0)`);
        ctx!.fillStyle = grad;
        ctx!.beginPath();
        ctx!.arc(e.x, e.y, e.size * 3, 0, Math.PI * 2);
        ctx!.fill();

        ctx!.fillStyle = `hsla(${e.hue}, 100%, 80%, ${flickerOpacity})`;
        ctx!.beginPath();
        ctx!.arc(e.x, e.y, e.size, 0, Math.PI * 2);
        ctx!.fill();

        e.y += e.speedY;
        e.x += e.speedX;
        e.opacity -= 0.002;

        if (e.opacity <= 0 || e.y < -20) embers.splice(i, 1);
      }

      // Shockwaves
      for (let i = shockwaves.length - 1; i >= 0; i--) {
        const s = shockwaves[i];
        s.radius += 4;
        s.opacity -= 0.015;

        if (s.opacity <= 0) {
          shockwaves.splice(i, 1);
          continue;
        }

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
    { name: "IRON MAN", color: "#ffb800", symbol: "⚙", glow: "rgba(255,184,0,0.15)" },
    { name: "THOR", color: "#42a5f5", symbol: "⚡", glow: "rgba(66,165,245,0.15)" },
    { name: "HULK", color: "#2ecc71", symbol: "✊", glow: "rgba(46,204,113,0.15)" },
    { name: "CAPTAIN", color: "#e63946", symbol: "★", glow: "rgba(230,57,70,0.15)" },
    { name: "DOOMSDAY", color: "#00ff9d", symbol: "✦", glow: "rgba(0,255,157,0.15)" },
  ];

  const current = avengers[phase];

  return (
    <>
      {/* Avenger silhouette in background — large, faded, behind content */}
      <div style={{
        position: "fixed",
        inset: 0,
        zIndex: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        pointerEvents: "none",
        background: `radial-gradient(ellipse at center, ${current.glow}, transparent 60%)`,
        transition: "background 1.5s ease",
      }}>
        <div style={{
          fontSize: "40vh",
          color: current.color,
          opacity: 0.06,
          textShadow: `0 0 100px ${current.color}`,
          transition: "opacity 1.5s ease, color 1.5s ease, textShadow 1.5s ease",
          fontWeight: "bold",
          lineHeight: 1,
        }}>
          {current.symbol}
        </div>
      </div>

      {/* Name watermark at bottom */}
      <div style={{
        position: "fixed",
        bottom: 20,
        right: 30,
        zIndex: 0,
        pointerEvents: "none",
        fontSize: 20,
        fontWeight: 900,
        letterSpacing: "0.3em",
        color: current.color,
        opacity: 0.08,
        transition: "color 1.5s ease, opacity 1.5s ease",
      }}>
        {current.name}
      </div>

      {/* Canvas for embers + shockwaves — above the silhouette but below content */}
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
          opacity: 0.35,
        }}
      />
    </>
  );
}
