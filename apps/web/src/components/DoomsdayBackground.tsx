"use client";

import { useEffect, useRef } from "react";
import { useTheme } from "@/components/ThemeProvider";

/**
 * DoomsdayBackground — anime/cyberpunk matrix rain effect.
 * Renders a canvas with falling neon green characters.
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
    const fontSize = 14;
    let columns: number = 0;
    let drops: number[] = [];

    function resize() {
      canvas!.width = window.innerWidth;
      canvas!.height = window.innerHeight;
      columns = Math.floor(canvas!.width / fontSize);
      drops = Array(columns).fill(1).map(() => Math.random() * -100);
    }
    resize();
    window.addEventListener("resize", resize);

    let animationId: number;

    function draw() {
      // Semi-transparent black to create trail effect
      ctx!.fillStyle = "rgba(0, 5, 5, 0.05)";
      ctx!.fillRect(0, 0, canvas!.width, canvas!.height);

      ctx!.font = `${fontSize}px JetBrains Mono, monospace`;

      for (let i = 0; i < drops.length; i++) {
        const char = chars[Math.floor(Math.random() * chars.length)];
        const x = i * fontSize;
        const y = drops[i] * fontSize;

        // Bright head, fading trail
        if (Math.random() > 0.975) {
          ctx!.fillStyle = "#ffffff";
        } else {
          ctx!.fillStyle = `rgba(0, 255, 157, ${0.3 + Math.random() * 0.5})`;
        }
        ctx!.fillText(char, x, y);

        if (y > canvas!.height && Math.random() > 0.98) {
          drops[i] = 0;
        }
        drops[i]++;
      }

      animationId = requestAnimationFrame(draw);
    }
    draw();

    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener("resize", resize);
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
        opacity: 0.12,
      }}
    />
  );
}
