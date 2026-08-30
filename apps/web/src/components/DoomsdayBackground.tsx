"use client";

import { useEffect, useRef, useState } from "react";
import { useTheme } from "@/components/ThemeProvider";

/**
 * DoomsdayBackground — Cycling Avenger faces + Doomsday green screen.
 * 
 * Cycle (every 4 seconds, continuous):
 *   1. Iron Man face (gold glow)
 *   2. Thor face (blue glow)
 *   3. Hulk face (green glow)
 *   4. Captain America face (red glow)
 *   5. DOOMSDAY — green screen flash + green embers take over
 *   → back to 1, repeat forever
 * 
 * Images are loaded from /avengers/ folder (public/avengers/).
 * Faces are faded behind content (opacity 0.08), not covering the page.
 * Green embers + click shockwaves float on top.
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

    // Cycle: 0-7 = Avenger faces, 8 = Doomsday green screen, then repeat
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

    interface Ember {
      x: number; y: number; size: number;
      speedY: number; speedX: number;
      opacity: number; hue: number; flicker: number;
    }

    const embers: Ember[] = [];
    const maxEmbers = 40;

    function spawnEmber() {
      embers.push({
        x: Math.random() * canvas!.width,
        y: canvas!.height + Math.random() * 100,
        size: 1 + Math.random() * 3,
        speedY: -(0.3 + Math.random() * 1),
        speedX: (Math.random() - 0.5) * 0.3,
        opacity: 0.3 + Math.random() * 0.4,
        hue: 120, // green
        flicker: Math.random() * Math.PI * 2,
      });
    }

    for (let i = 0; i < 20; i++) {
      spawnEmber();
      embers[i].y = Math.random() * canvas!.height;
    }

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

      if (embers.length < maxEmbers && frame % 12 === 0) spawnEmber();

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
  }, [theme]);

  if (theme !== "doomsday") return null;

  // All Avenger images from the user's folder, cycling continuously
  const avengers = [
    { name: "IRON MAN", img: "/avengers/neon-iron-man.jpg", glow: "rgba(255,184,0,0.12)" },
    { name: "CAPTAIN AMERICA", img: "/avengers/chris-evans-captain.jpg", glow: "rgba(230,57,70,0.12)" },
    { name: "HULK", img: "/avengers/hulk-artwork-marvel.jpg", glow: "rgba(46,204,113,0.12)" },
    { name: "DEADPOOL", img: "/avengers/deadpool-3.jpg", glow: "rgba(230,57,70,0.12)" },
    { name: "DOCTOR DOOM", img: "/avengers/doctor-doom.jpg", glow: "rgba(0,150,255,0.12)" },
    { name: "LOKI", img: "/avengers/loki.jpg", glow: "rgba(100,200,100,0.12)" },
    { name: "SPIDER-MAN", img: "/avengers/miles-morales-spider-man-neon-pink.jpg", glow: "rgba(255,100,200,0.12)" },
    { name: "AVENGERS", img: "/avengers/marvels-avengers-marvel-superheroes-playstation-4.jpg", glow: "rgba(255,200,0,0.12)" },
  ];

  const isDoomsday = phase === avengers.length;
  const current = isDoomsday ? null : avengers[phase];

  return (
    <>
      {/* Avenger face image — one at a time, keyed so no overlap */}
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
            background: `radial-gradient(ellipse at center, ${current.glow}, transparent 60%)`,
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
              opacity: 0.25,
              filter: "none",
            }}
          />
        </div>
      )}

      {/* Doomsday green flash overlay (phase 4) */}
      {isDoomsday && (
        <div style={{
          position: "fixed",
          inset: 0,
          zIndex: 0,
          pointerEvents: "none",
          background: "radial-gradient(ellipse at center, rgba(0,255,157,0.08), transparent 70%)",
          animation: "doomsday-flash 1.5s ease-out",
        }} />
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
        color: isDoomsday ? "#00ff9d" : current?.color ?? "#00ff9d",
        opacity: 0.1,
        transition: "color 1.5s ease, opacity 1.5s ease",
      }}>
        {isDoomsday ? "DOOMSDAY" : current?.name}
      </div>

      {/* Canvas for embers + shockwaves */}
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

      <style>{`
        @keyframes avenger-fade-in {
          0% { opacity: 0; }
          100% { opacity: 1; }
        }
        @keyframes doomsday-flash {
          0% { opacity: 0; background: rgba(0,255,157,0.15); }
          30% { opacity: 1; background: rgba(0,255,157,0.2); }
          100% { opacity: 0.5; background: rgba(0,255,157,0.08); }
        }
      `}</style>
    </>
  );
}
