import { create } from "zustand";

export const SUPPORTED_LANGUAGES = [
  "C++17",
  "C++20",
  "Python 3",
  "Java",
  "JavaScript",
  "TypeScript",
] as const;

export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export const STARTER_TEMPLATES: Record<string, string> = {
  "C++17": `#include <iostream>
#include <vector>
#include <algorithm>
#include <string>

using namespace std;

int main() {
    ios_base::sync_with_stdio(false);
    cin.tie(NULL);

    int n, target;
    if (cin >> n >> target) {
        vector<int> nums(n);
        for (int i = 0; i < n; i++) cin >> nums[i];

        // Brute force O(n²)
        for (int i = 0; i < n; i++) {
            for (int j = i + 1; j < n; j++) {
                if (nums[i] + nums[j] == target) {
                    cout << i << " " << j << "\\n";
                    return 0;
                }
            }
        }
    }
    return 0;
}`,
  "C++20": `#include <iostream>
#include <vector>
#include <algorithm>
#include <ranges>

using namespace std;

int main() {
    ios_base::sync_with_stdio(false);
    cin.tie(NULL);

    // Your solution here
    return 0;
}`,
  "Python 3": `import sys

def solve():
    input_data = sys.stdin.read().split()
    if not input_data:
        return
    n = int(input_data[0])
    target = int(input_data[1])
    nums = [int(x) for x in input_data[2:2+n]]

    # Two Sum O(n) lookup
    seen = {}
    for i, num in enumerate(nums):
        complement = target - num
        if complement in seen:
            print(f"{seen[complement]} {i}")
            return
        seen[num] = i

if __name__ == '__main__':
    solve()
`,
  "Java": `import java.util.*;
import java.io.*;

public class Main {
    public static void main(String[] args) throws IOException {
        BufferedReader br = new BufferedReader(new InputStreamReader(System.in));
        String line = br.readLine();
        if (line == null) return;
        
        StringTokenizer st = new StringTokenizer(line);
        int n = Integer.parseInt(st.nextToken());
        int target = Integer.parseInt(st.nextToken());
        
        int[] nums = new int[n];
        st = new StringTokenizer(br.readLine());
        for (int i = 0; i < n; i++) {
            nums[i] = Integer.parseInt(st.nextToken());
        }
        
        Map<Integer, Integer> map = new HashMap<>();
        for (int i = 0; i < n; i++) {
            int comp = target - nums[i];
            if (map.containsKey(comp)) {
                System.out.println(map.get(comp) + " " + i);
                return;
            }
            map.put(nums[i], i);
        }
    }
}`,
  "JavaScript": `const fs = require('fs');

function solve() {
    const input = fs.readFileSync(0, 'utf-8').trim().split(/\\s+/);
    if (!input || input.length < 2) return;
    
    const n = parseInt(input[0], 10);
    const target = parseInt(input[1], 10);
    const nums = input.slice(2, 2 + n).map(Number);
    
    const map = new Map();
    for (let i = 0; i < nums.length; i++) {
        const comp = target - nums[i];
        if (map.has(comp)) {
            console.log(\`\${map.get(comp)} \${i}\`);
            return;
        }
        map.set(nums[i], i);
    }
}

solve();
`,
  "TypeScript": `import * as fs from 'fs';

function solve(): void {
    const input = fs.readFileSync(0, 'utf-8').trim().split(/\\s+/);
    if (!input || input.length < 2) return;
    
    const n = parseInt(input[0], 10);
    const target = parseInt(input[1], 10);
    const nums = input.slice(2, 2 + n).map(Number);
    
    const map = new Map<number, number>();
    for (let i = 0; i < nums.length; i++) {
        const comp = target - nums[i];
        if (map.has(comp)) {
            console.log(\`\${map.get(comp)} \${i}\`);
            return;
        }
        map.set(nums[i], i);
    }
}

solve();
`,
};

export function getFileExtension(language: string): string {
  const l = language.toLowerCase();
  if (l.includes("c++") || l.includes("cpp")) return "cpp";
  if (l.includes("python") || l.includes("py")) return "py";
  if (l.includes("java") && !l.includes("javascript")) return "java";
  if (l.includes("javascript") || l.includes("js")) return "js";
  if (l.includes("typescript") || l.includes("ts")) return "ts";
  if (l.includes("rust") || l.includes("rs")) return "rs";
  if (l.includes("go")) return "go";
  return "cpp";
}

export function getFileName(language: string): string {
  const l = language.toLowerCase();
  if (l.includes("java") && !l.includes("javascript")) return "Main.java";
  return `main.${getFileExtension(language)}`;
}

export type Verdict = "AC" | "WA" | "TLE" | "RE" | "CE" | null;

export interface IDEState {
  language: string;
  code: string;
  codeByLanguage: Record<string, string>;
  isRunning: boolean;
  verdict: Verdict;
  verdictMessage: string | null;
  setLanguage: (language: string) => void;
  setCode: (code: string) => void;
  setIsRunning: (isRunning: boolean) => void;
  setVerdict: (verdict: Verdict, message?: string | null) => void;
  resetToTemplate: () => void;
}

export const useIDEStore = create<IDEState>((set, get) => ({
  language: "C++17",
  code: STARTER_TEMPLATES["C++17"] || "",
  codeByLanguage: { ...STARTER_TEMPLATES },
  isRunning: false,
  verdict: null,
  verdictMessage: null,

  setLanguage: (newLang: string) => {
    const state = get();
    // Save current code to cache
    const updatedCache = {
      ...state.codeByLanguage,
      [state.language]: state.code,
    };
    // Retrieve cached code or default template
    const nextCode =
      updatedCache[newLang] || STARTER_TEMPLATES[newLang] || STARTER_TEMPLATES["C++17"];

    set({
      language: newLang,
      code: nextCode,
      codeByLanguage: updatedCache,
    });
  },

  setCode: (code: string) =>
    set((state) => ({
      code,
      codeByLanguage: {
        ...state.codeByLanguage,
        [state.language]: code,
      },
    })),

  setIsRunning: (isRunning: boolean) => set({ isRunning }),

  setVerdict: (verdict: Verdict, verdictMessage: string | null = null) =>
    set({ verdict, verdictMessage }),

  resetToTemplate: () => {
    const lang = get().language;
    const template = STARTER_TEMPLATES[lang] || STARTER_TEMPLATES["C++17"];
    set((state) => ({
      code: template,
      codeByLanguage: {
        ...state.codeByLanguage,
        [lang]: template,
      },
    }));
  },
}));
