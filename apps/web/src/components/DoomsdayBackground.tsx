"use client";

import { useEffect, useRef, useState } from "react";
import { useTheme } from "@/components/ThemeProvider";

/**
 * DoomsdayBackground — Avengers Doomsday intro + ember background.
 * 
 * Intro sequence:
 *   1. Shows Avenger-style cards (Iron Man gold, Thor blue, Hulk green, Cap red) one by one
 *   2. "SNAP" — everything turns green
 *   3. Fades into ember background with green glow
 * 
 * Only renders when theme is "doomsday".
 */
export default function DoomsdayBackground() {
  const { theme } = useTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [showIntro, setShowIntro] = useState(false);
  const [introStep, setIntroStep] = useState(0);

  useEffect(() => {
    if (theme !== "doomsday") return;
    setShowIntro(true);
    setIntroStep(0);
  }, [theme]);

  // Intro animation
  useEffect(() => {
    if (!showIntro) return;

    const timers: ReturnType<typeof setTimeout>[] = [];

    // Step 0-3: Show each Avenger card (1.5s each)
    for (let i = 0; i < 4; i++) {
      timers.push(setTimeout(() => setIntroStep(i + 1), i * 1500));
    }

    // Step 4: SNAP (green flash)
    timers.push(setTimeout(() => setIntroStep(4), 6000));

    // Step 5: Fade to embers
    timers.push(setTimeout(() => setIntroStep(5), 7500));

    // Step 6: Done — hide intro
    timers.push(setTimeout(() => {
      setShowIntro(false);
      setIntroStep(0);
    }, 9000));

    return () => timers.forEach(t => clearTimeout(t));
  }, [showIntro]);

  useEffect(() => {
    if (theme !== "doomsday") return;
    if (showIntro && introStep < 5) return;

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
    const maxEmbers = 60;

    function spawnEmber() {
      embers.push({
        x: Math.random() * canvas!.width,
        y: canvas!.height + Math.random() * 100,
        size: 1 + Math.random() * 3,
        speedY: -(0.5 + Math.random() * 1.5),
        speedX: (Math.random() - 0.5) * 0.5,
        opacity: 0.4 + Math.random() * 0.5,
        hue: Math.random() > 0.5 ? 120 : 45, // green or gold
        flicker: Math.random() * Math.PI * 2,
      });
    }

    for (let i = 0; i < 30; i++) {
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
      for (let i = 0; i < 15; i++) {
        const angle = (Math.PI * 2 * i) / 15;
        embers.push({
          x: e.clientX, y: e.clientY,
          size: 2 + Math.random() * 3,
          speedY: Math.sin(angle) * (1 + Math.random() * 2),
          speedX: Math.cos(angle) * (1 + Math.random() * 2),
          opacity: 0.8,
          hue: 120,
          flicker: Math.random() * Math.PI * 2,
        });
      }
    }
    window.addEventListener("pointerdown", onPointer);

    let animationId: number;
    let frame = 0;

    function draw() {
      ctx!.fillStyle = "rgba(0, 8, 0, 0.12)";
      ctx!.fillRect(0, 0, canvas!.width, canvas!.height);
      frame++;

      // Arc reactor glow (green after snap)
      const reactorX = 80;
      const reactorY = canvas!.height - 80;
      const pulse = 0.5 + Math.sin(frame * 0.03) * 0.3;
      const reactorRadius = 60 + pulse * 20;

      const reactorGrad = ctx!.createRadialGradient(reactorX, reactorY, 0, reactorX, reactorY, reactorRadius);
      reactorGrad.addColorStop(0, `rgba(100, 255, 100, ${pulse * 0.4})`);
      reactorGrad.addColorStop(0.3, `rgba(0, 220, 100, ${pulse * 0.2})`);
      reactorGrad.addColorStop(0.6, `rgba(0, 150, 50, ${pulse * 0.1})`);
      reactorGrad.addColorStop(1, `rgba(0, 0, 0, 0)`);
      ctx!.fillStyle = reactorGrad;
      ctx!.beginPath();
      ctx!.arc(reactorX, reactorY, reactorRadius, 0, Math.PI * 2);
      ctx!.fill();

      ctx!.strokeStyle = `rgba(100, 255, 100, ${pulse * 0.5})`;
      ctx!.lineWidth = 2;
      ctx!.beginPath();
      ctx!.arc(reactorX, reactorY, 20 + pulse * 5, 0, Math.PI * 2);
      ctx!.stroke();

      if (embers.length < maxEmbers && frame % 8 === 0) spawnEmber();

      for (let i = embers.length - 1; i >= 0; i--) {
        const e = embers[i];
        e.flicker += 0.1;
        const flickerOpacity = e.opacity * (0.7 + Math.sin(e.flicker) * 0.3);

        const grad = ctx!.createRadialGradient(e.x, e.y, 0, e.x, e.y, e.size * 3);
        grad.addColorStop(0, `hsla(${e.hue}, 100%, 70%, ${flickerOpacity})`);
        grad.addColorStop(0.5, `hsla(${e.hue}, 100%, 50%, ${flickerOpacity * 0.3})`);
        grad.addColorStop(1, `hsla(${e.hue}, 100%, 40%, 0)`);
        ctx!.fillStyle = grad;
        ctx!.beginPath();
        ctx!.arc(e.x, e.y, e.size * 3, 0, Math.PI * 2);
        ctx!.fill();

        ctx!.fillStyle = `hsla(${e.hue}, 100%, 85%, ${flickerOpacity})`;
        ctx!.beginPath();
        ctx!.arc(e.x, e.y, e.size, 0, Math.PI * 2);
        ctx!.fill();

        e.y += e.speedY;
        e.x += e.speedX;
        e.opacity -= 0.003;

        if (e.opacity <= 0 || e.y < -20 || e.x < -20 || e.x > canvas!.width + 20) {
          embers.splice(i, 1);
        }
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
        grad.addColorStop(0.6, `hsla(${s.hue}, 100%, 60%, ${s.opacity * 0.2})`);
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
        ctx!.arc(s.x, s.y, 8, 0, Math.PI * 2);
        ctx!.fill();

        ctx!.strokeStyle = `hsla(${s.hue}, 100%, 100%, ${s.opacity})`;
        ctx!.lineWidth = 2;
        const sparkLen = s.radius * 0.35;
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
  }, [theme, showIntro, introStep]);

  if (theme !== "doomsday") return null;

  const avengers = [
    { name: "IRON MAN", color: "#ffb800", symbol: "⚙", bg: "#1a1400" },
    { name: "THOR", color: "#42a5f5", symbol: "⚡", bg: "#0a0a20" },
    { name: "HULK", color: "#2ecc71", symbol: "✊", bg: "#0a1a0a" },
    { name: "CAPTAIN", color: "#e63946", symbol: "★", bg: "#1a0008" },
  ];

  // Intro overlay
  if (showIntro) {
    const isSnap = introStep === 4;
    const isFading = introStep === 5;
    const currentAvenger = introStep > 0 && introStep <= 4 ? avengers[introStep - 1] : null;

    return (
      <>
        {/* Intro overlay */}
        <div style={{
          position: "fixed", inset: 0, zIndex: 2147483647,
          background: isSnap ? "#00ff00" : isFading ? "#001500" : (currentAvenger ? currentAvenger.bg : "#000"),
          display: "flex", alignItems: "center", justifyContent: "center",
          flexDirection: "column", gap: 24,
          transition: "background 0.5s ease",
          pointerEvents: "none",
          opacity: isFading ? 0 : 1,
          transitionProperty: "opacity, background",
          transitionDuration: "1.5s, 0.5s",
        }}>
          {currentAvenger && (
            <>
              <div style={{
                fontSize: 120, color: currentAvenger.color,
                textShadow: `0 0 60px ${currentAvenger.color}, 0 0 100px ${currentAvenger.color}`,
                animation: "fadeIn 0.5s ease",
                fontWeight: "bold",
              }}>
                {currentAvenger.symbol}
              </div>
              <div style={{
                fontSize: 42, fontWeight: 900, color: currentAvenger.color,
                letterSpacing: "0.2em",
                textShadow: `0 0 30px ${currentAvenger.color}`,
                fontFamily: "'Inter', sans-serif",
                animation: "fadeIn 0.8s ease",
              }}>
                {currentAvenger.name}
              </div>
            </>
          )}

          {isSnap && (
            <div style={{
              fontSize: 80, fontWeight: 900, color: "#001500",
              letterSpacing: "0.1em",
              animation: "fadeIn 0.3s ease",
            }}>
              SNAP
            </div>
          )}
        </div>

        {/* Canvas (starts after intro) */}
        {!isFading && <canvas ref={canvasRef} style={{
          position: "fixed", top: 0, left: 0,
          width: "100vw", height: "100vh",
          zIndex: 9990, pointerEvents: "none", opacity: 0,
        }} />}
      </>
    );
  }

  // After intro — just the canvas
  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "fixed", top: 0, left: 0,
        width: "100vw", height: "100vh",
        zIndex: 9990, pointerEvents: "none", opacity: 0.45,
      }}
    />
  );
}
