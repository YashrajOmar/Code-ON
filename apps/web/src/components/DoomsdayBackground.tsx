"use client";

import { useEffect, useRef } from "react";
import { useTheme } from "@/components/ThemeProvider";

/**
 * DoomsdayBackground — anime/cyberpunk matrix rain effect + click shine.
 * Characters fall slowly, stay readable, and don't overlap.
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

    const chars = "01<>{}[];()+-*/=&|!?$#@%アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン".split("");
    const fontSize = 28;
    let columns = 0;
    let drops: { y: number; char: string; speed: number }[] = [];

    function resize() {
      canvas!.width = window.innerWidth;
      canvas!.height = window.innerHeight;
      columns = Math.floor(canvas!.width / fontSize);
      drops = Array(columns).fill(0).map(() => ({
        y: Math.random() * -canvas!.height,
        char: chars[Math.floor(Math.random() * chars.length)],
        speed: 0.3 + Math.random() * 0.4,
      }));
    }
    resize();
    window.addEventListener("resize", resize);

    // Click shine effects
    interface Shine {
      x: number; y: number; radius: number; opacity: number; hue: number;
    }
    const shines: Shine[] = [];

    function onPointer(e: PointerEvent) {
      const colors = [157, 157, 212, 157, 180, 157, 340];
      shines.push({
        x: e.clientX, y: e.clientY, radius: 0,
        opacity: 1.5, hue: colors[Math.floor(Math.random() * colors.length)],
      });
    }
    window.addEventListener("pointerdown", onPointer);

    let animationId: number;
    let frame = 0;

    function draw() {
      // Clear fully each frame — no trails, no overlap
      ctx!.fillStyle = "rgba(0, 5, 5, 0.15)";
      ctx!.fillRect(0, 0, canvas!.width, canvas!.height);

      ctx!.font = `bold ${fontSize}px JetBrains Mono, monospace`;
      frame++;

      // Only change characters every 20 frames so they're readable
      if (frame % 20 === 0) {
        for (let i = 0; i < drops.length; i++) {
          if (Math.random() > 0.7) {
            drops[i].char = chars[Math.floor(Math.random() * chars.length)];
          }
        }
      }

      for (let i = 0; i < drops.length; i++) {
        const d = drops[i];
        const x = i * fontSize;
        const y = d.y;

        // Bright head + body
        ctx!.fillStyle = `rgba(0, 255, 157, 0.8)`;
        ctx!.fillText(d.char, x, y);

        // White sparkle on some
        if (frame % 30 === 0 && Math.random() > 0.8) {
          ctx!.fillStyle = "#ffffff";
          ctx!.fillText(d.char, x, y);
        }

        // Move down slowly
        d.y += d.speed;

        // Reset when off screen
        if (y > canvas!.height + fontSize) {
          d.y = -fontSize;
          d.char = chars[Math.floor(Math.random() * chars.length)];
          d.speed = 0.3 + Math.random() * 0.4;
        }
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

        const grad = ctx!.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.radius);
        grad.addColorStop(0, `hsla(${s.hue}, 100%, 85%, ${s.opacity * 0.7})`);
        grad.addColorStop(0.3, `hsla(${s.hue}, 100%, 70%, ${s.opacity * 0.5})`);
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

        ctx!.fillStyle = `hsla(${s.hue}, 100%, 95%, ${s.opacity * 0.9})`;
        ctx!.beginPath();
        ctx!.arc(s.x, s.y, 8, 0, Math.PI * 2);
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
        opacity: 0.25,
      }}
    />
  );
}
