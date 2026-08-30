"use client";

import { useEffect, useRef } from "react";
import { useTheme } from "@/components/ThemeProvider";

/**
 * DoomsdayBackground — Avengers Doomsday theme.
 * 
 * - Falling ember/debris particles (gold + red)
 * - Pulsing arc reactor glow in bottom-left corner
 * - Click to explode a bright shockwave
 * 
 * Only renders when theme is "doomsday".
 */
export default function DoomsdayBackground() {
  const { theme } = useTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);

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

    // Ember particles
    interface Ember {
      x: number;
      y: number;
      size: number;
      speedY: number;
      speedX: number;
      opacity: number;
      hue: number;
      flicker: number;
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
        hue: Math.random() > 0.6 ? 0 : 45, // red or gold
        flicker: Math.random() * Math.PI * 2,
      });
    }

    // Pre-spawn some embers
    for (let i = 0; i < 30; i++) {
      spawnEmber();
      embers[i].y = Math.random() * canvas!.height;
    }

    // Click shockwaves
    interface Shockwave {
      x: number;
      y: number;
      radius: number;
      opacity: number;
      hue: number;
    }
    const shockwaves: Shockwave[] = [];

    function onPointer(e: PointerEvent) {
      const hue = Math.random() > 0.5 ? 45 : 0; // gold or red
      shockwaves.push({
        x: e.clientX,
        y: e.clientY,
        radius: 0,
        opacity: 1.5,
        hue,
      });

      // Spawn burst of embers at click point
      for (let i = 0; i < 15; i++) {
        const angle = (Math.PI * 2 * i) / 15;
        embers.push({
          x: e.clientX,
          y: e.clientY,
          size: 2 + Math.random() * 3,
          speedY: Math.sin(angle) * (1 + Math.random() * 2),
          speedX: Math.cos(angle) * (1 + Math.random() * 2),
          opacity: 0.8,
          hue: Math.random() > 0.5 ? 45 : 0,
          flicker: Math.random() * Math.PI * 2,
        });
      }
    }
    window.addEventListener("pointerdown", onPointer);

    let animationId: number;
    let frame = 0;

    function draw() {
      // Clear with slight trail for smooth ember movement
      ctx!.fillStyle = "rgba(8, 0, 0, 0.12)";
      ctx!.fillRect(0, 0, canvas!.width, canvas!.height);
      frame++;

      // ── Arc reactor glow (bottom-left corner) ──
      const reactorX = 80;
      const reactorY = canvas!.height - 80;
      const pulse = 0.5 + Math.sin(frame * 0.03) * 0.3;
      const reactorRadius = 60 + pulse * 20;

      const reactorGrad = ctx!.createRadialGradient(reactorX, reactorY, 0, reactorX, reactorY, reactorRadius);
      reactorGrad.addColorStop(0, `rgba(255, 220, 100, ${pulse * 0.4})`);
      reactorGrad.addColorStop(0.3, `rgba(255, 180, 0, ${pulse * 0.2})`);
      reactorGrad.addColorStop(0.6, `rgba(200, 40, 40, ${pulse * 0.1})`);
      reactorGrad.addColorStop(1, `rgba(0, 0, 0, 0)`);
      ctx!.fillStyle = reactorGrad;
      ctx!.beginPath();
      ctx!.arc(reactorX, reactorY, reactorRadius, 0, Math.PI * 2);
      ctx!.fill();

      // Reactor ring
      ctx!.strokeStyle = `rgba(255, 200, 50, ${pulse * 0.5})`;
      ctx!.lineWidth = 2;
      ctx!.beginPath();
      ctx!.arc(reactorX, reactorY, 20 + pulse * 5, 0, Math.PI * 2);
      ctx!.stroke();

      // ── Embers ──
      // Spawn new embers
      if (embers.length < maxEmbers && frame % 8 === 0) {
        spawnEmber();
      }

      for (let i = embers.length - 1; i >= 0; i--) {
        const e = embers[i];

        // Flicker
        e.flicker += 0.1;
        const flickerOpacity = e.opacity * (0.7 + Math.sin(e.flicker) * 0.3);

        // Draw ember with glow
        const grad = ctx!.createRadialGradient(e.x, e.y, 0, e.x, e.y, e.size * 3);
        grad.addColorStop(0, `hsla(${e.hue}, 100%, 70%, ${flickerOpacity})`);
        grad.addColorStop(0.5, `hsla(${e.hue}, 100%, 50%, ${flickerOpacity * 0.3})`);
        grad.addColorStop(1, `hsla(${e.hue}, 100%, 40%, 0)`);
        ctx!.fillStyle = grad;
        ctx!.beginPath();
        ctx!.arc(e.x, e.y, e.size * 3, 0, Math.PI * 2);
        ctx!.fill();

        // Bright core
        ctx!.fillStyle = `hsla(${e.hue}, 100%, 85%, ${flickerOpacity})`;
        ctx!.beginPath();
        ctx!.arc(e.x, e.y, e.size, 0, Math.PI * 2);
        ctx!.fill();

        // Move
        e.y += e.speedY;
        e.x += e.speedX;
        e.opacity -= 0.003;

        // Remove if faded or off screen
        if (e.opacity <= 0 || e.y < -20 || e.x < -20 || e.x > canvas!.width + 20) {
          embers.splice(i, 1);
        }
      }

      // ── Shockwaves ──
      for (let i = shockwaves.length - 1; i >= 0; i--) {
        const s = shockwaves[i];
        s.radius += 4;
        s.opacity -= 0.015;

        if (s.opacity <= 0) {
          shockwaves.splice(i, 1);
          continue;
        }

        // Expanding glow
        const grad = ctx!.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.radius);
        grad.addColorStop(0, `hsla(${s.hue}, 100%, 85%, ${s.opacity * 0.6})`);
        grad.addColorStop(0.3, `hsla(${s.hue}, 100%, 70%, ${s.opacity * 0.4})`);
        grad.addColorStop(0.6, `hsla(${s.hue}, 100%, 60%, ${s.opacity * 0.2})`);
        grad.addColorStop(1, `hsla(${s.hue}, 100%, 50%, 0)`);
        ctx!.fillStyle = grad;
        ctx!.beginPath();
        ctx!.arc(s.x, s.y, s.radius, 0, Math.PI * 2);
        ctx!.fill();

        // Ring
        ctx!.strokeStyle = `hsla(${s.hue}, 100%, 90%, ${s.opacity})`;
        ctx!.lineWidth = 3;
        ctx!.beginPath();
        ctx!.arc(s.x, s.y, s.radius, 0, Math.PI * 2);
        ctx!.stroke();

        // Center flash
        ctx!.fillStyle = `hsla(${s.hue}, 100%, 95%, ${s.opacity * 0.8})`;
        ctx!.beginPath();
        ctx!.arc(s.x, s.y, 8, 0, Math.PI * 2);
        ctx!.fill();

        // Sparkle cross
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
  }, [theme]);

  if (theme !== "doomsday") return null;

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100vw",
        height: "100vh",
        zIndex: 9990,
        pointerEvents: "none",
        opacity: 0.45,
      }}
    />
  );
}
