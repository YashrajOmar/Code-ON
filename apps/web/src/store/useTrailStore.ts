import { create } from "zustand";

export interface TrailMilestone {
  tier: "Brute Force" | "Sub-Optimal" | "Optimal";
  complexity: { time: string; space: string };
  hint: string;
  algorithmicPivot: string;
  level: string;
}

interface TrailState {
  trail: TrailMilestone[];
  currentLevel: string | null;
  currentIndex: number;
  detectedTechniques: string[];
  timeComplexity: string | null;
  spaceComplexity: string | null;
  isLoading: boolean;
  error: string | null;
  unlockedIndex: number;
  fetchTrail: (code: string, problemUrl: string, problemTags?: string[]) => Promise<void>;
  unlockNext: () => void;
  resetTrail: () => void;
  loadCachedTrail: (problemUrl: string) => void;
}

export const useTrailStore = create<TrailState>((set, get) => ({
  trail: [],
  currentLevel: null,
  currentIndex: 0,
  detectedTechniques: [],
  timeComplexity: null,
  spaceComplexity: null,
  isLoading: false,
  error: null,
  unlockedIndex: 0,

  fetchTrail: async (code: string, problemUrl: string, problemTags?: string[]) => {
    set({ isLoading: true, error: null });
    try {
      const res = await fetch("/api/trail", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, problemUrl, problemTags }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Failed to fetch trail" }));
        throw new Error(err.error || "Failed to fetch trail");
      }
      const data = await res.json();
      const trail = data.trail || [];
      const currentIndex = data.currentIndex || 0;

      // Progressive disclosure: unlock current + 1 next
      const unlockedIndex = Math.min(currentIndex + 1, trail.length);

      set({
        trail,
        currentLevel: data.currentLevel,
        currentIndex,
        detectedTechniques: data.detectedTechniques || [],
        timeComplexity: data.timeComplexity,
        spaceComplexity: data.spaceComplexity,
        unlockedIndex,
        isLoading: false,
      });

      // Cache to localStorage
      try {
        localStorage.setItem(`codeon_trail_${problemUrl}`, JSON.stringify({
          trail,
          currentLevel: data.currentLevel,
          currentIndex,
          unlockedIndex,
          detectedTechniques: data.detectedTechniques || [],
          timeComplexity: data.timeComplexity,
          spaceComplexity: data.spaceComplexity,
        }));
      } catch {}
    } catch (e: any) {
      set({ isLoading: false, error: e?.message || "Failed to fetch trail" });
    }
  },

  unlockNext: () => {
    const { unlockedIndex, trail } = get();
    if (unlockedIndex < trail.length) {
      set({ unlockedIndex: unlockedIndex + 1 });
    }
  },

  resetTrail: () => {
    set({
      trail: [],
      currentLevel: null,
      currentIndex: 0,
      unlockedIndex: 0,
      detectedTechniques: [],
      timeComplexity: null,
      spaceComplexity: null,
    });
  },

  loadCachedTrail: (problemUrl: string) => {
    try {
      const cached = localStorage.getItem(`codeon_trail_${problemUrl}`);
      if (cached) {
        const data = JSON.parse(cached);
        set({
          trail: data.trail || [],
          currentLevel: data.currentLevel,
          currentIndex: data.currentIndex,
          unlockedIndex: data.unlockedIndex,
          detectedTechniques: data.detectedTechniques || [],
          timeComplexity: data.timeComplexity,
          spaceComplexity: data.spaceComplexity,
        });
      }
    } catch {}
  },
}));
