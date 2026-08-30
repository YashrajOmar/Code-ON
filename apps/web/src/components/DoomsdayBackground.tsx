"use client";

import { useEffect, useRef } from "react";
import { useTheme } from "@/components/ThemeProvider";

/**
 * DoomsdayBackground — anime/cyberpunk matrix rain effect + click shine.
 * Renders a canvas with falling neon green characters.
 * On click/touch, emits a bright expanding light ring at the cursor position.
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

    // Matrix characters — mix of katakana, numbers, and code symbols
    const chars = "01<>{}[];()+-*/=&|!?$#@%アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン".split("");
    const fontSize = 28;
    let columns: number = 0;
    let drops: number[] = [];

    // Click shine effects
    interface Shine {
      x: number;
      y: number;
      radius: number;
      maxRadius: number;
      opacity: number;
      hue: number;
    }
    const shines: Shine[] = [];

    function resize() {
      canvas!.width = window.innerWidth;
      canvas!.height = window.innerHeight;
      columns = Math.floor(canvas!.width / fontSize);
      drops = Array(columns).fill(1).map(() => Math.random() * -100);
    }
    resize();
    window.addEventListener("resize", resize);

    function onPointer(e: PointerEvent) {
      const colors = [157, 157, 212, 157, 180, 157, 157, 340, 157]; // mostly green, some cyan/amber/pink
      const hue = colors[Math.floor(Math.random() * colors.length)];
      shines.push({
        x: e.clientX,
        y: e.clientY,
        radius: 0,
        maxRadius: 120 + Math.random() * 80,
        opacity: 1.5,
        hue,
      });
    }
    window.addEventListener("pointerdown", onPointer);

    let animationId: number;

    function draw() {
      // Semi-transparent black to create trail effect
      ctx!.fillStyle = "rgba(0, 5, 5, 0.05)";
      ctx!.fillRect(0, 0, canvas!.width, canvas!.height);

      ctx!.font = `${fontSize}px JetBrains Mono, monospace`;

      // Draw matrix rain
      for (let i = 0; i < drops.length; i++) {
        const char = chars[Math.floor(Math.random() * chars.length)];
        const x = i * fontSize;
        const y = drops[i] * fontSize;

        if (Math.random() > 0.975) {
          ctx!.fillStyle = "#ffffff";
        } else {
          ctx!.fillStyle = `rgba(0, 255, 157, ${0.3 + Math.random() * 0.5})`;
        }
        ctx!.fillText(char, x, y);

        if (y > canvas!.height && Math.random() > 0.98) {
          drops[i] = 0;
        }
        drops[i] += 0.3;
      }

      // Draw click shines
      for (let i = shines.length - 1; i >= 0; i--) {
        const s = shines[i];
        s.radius += 3;
        s.opacity -= 0.012;

        if (s.opacity <= 0) {
          shines.splice(i, 1);
          continue;
        }

        // Outer glow ring — much brighter
        const grad = ctx!.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.radius);
        grad.addColorStop(0, `hsla(${s.hue}, 100%, 85%, ${s.opacity * 0.7})`);
        grad.addColorStop(0.3, `hsla(${s.hue}, 100%, 70%, ${s.opacity * 0.5})`);
        grad.addColorStop(0.6, `hsla(${s.hue}, 100%, 60%, ${s.opacity * 0.2})`);
        grad.addColorStop(1, `hsla(${s.hue}, 100%, 50%, 0)`);
        ctx!.fillStyle = grad;
        ctx!.beginPath();
        ctx!.arc(s.x, s.y, s.radius, 0, Math.PI * 2);
        ctx!.fill();

        // Bright ring border — thicker + brighter
        ctx!.strokeStyle = `hsla(${s.hue}, 100%, 90%, ${s.opacity})`;
        ctx!.lineWidth = 3;
        ctx!.beginPath();
        ctx!.arc(s.x, s.y, s.radius, 0, Math.PI * 2);
        ctx!.stroke();

        // Inner bright flash
        ctx!.fillStyle = `hsla(${s.hue}, 100%, 95%, ${s.opacity * 0.9})`;
        ctx!.beginPath();
        ctx!.arc(s.x, s.y, 8, 0, Math.PI * 2);
        ctx!.fill();

        // Sparkle cross
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
        opacity: 0.35,
      }}
    />
  );
}
