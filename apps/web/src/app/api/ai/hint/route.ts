import { NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';
import { prisma } from '@/lib/prisma';
import { decryptKey } from '@/lib/crypto';

const DEMO_USER_EMAIL = 'demo@codeon.dev';

async function getActiveApiKey(): Promise<string | null> {
  try {
    const user = await prisma.user.findUnique({
      where: { email: DEMO_USER_EMAIL },
      include: { apiKeys: true },
    });
    if (!user) return null;

    const providers = ['gemini', 'openai', 'anthropic'];
    for (const provider of providers) {
      const keyObj = (user.apiKeys as any[]).find((k) => k.provider === provider);
      if (keyObj) {
        const decrypted = decryptKey(keyObj.encryptedKey);
        if (decrypted) return decrypted;
      }
    }
    return null;
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  try {
    const { code, language, problemTitle, problemStatement, editorialMarkdown } = await req.json();

    const apiKey = await getActiveApiKey();
    if (!apiKey) {
      return NextResponse.json(
        { error: 'No API key configured.' },
        { status: 400 }
      );
    }

    const prompt = `You are an expert Socratic AI Coding Mentor. 
Your goal is to guide the student towards the correct solution WITHOUT giving them the direct answer or writing the code for them.

PROBLEM: ${problemTitle || 'Unknown'}
DESCRIPTION:
${problemStatement || 'Not provided'}

Here is the user's current code:
\`\`\`${language}
${code || 'No code yet'}
\`\`\`
Evaluate this specific code before giving a Socratic hint. Do not assume they are using a brute-force approach if their code is already optimized.

OFFICIAL EDITORIAL / SOLUTION STRATEGY:
${editorialMarkdown || 'Not provided. Try to infer the optimal approach.'}

INSTRUCTIONS:
1. Analyze the student's current code. Identify any logic errors, edge cases they missed, or if they are entirely on the wrong path.
2. Compare their approach to the OFFICIAL EDITORIAL.
3. Provide 1-2 probing Socratic questions or hints to guide them toward the optimal approach described in the editorial.
4. DO NOT provide the full solution or write the corrected code. Keep your response concise, encouraging, and thought-provoking.
`;

    const ai = new GoogleGenAI({ apiKey });
    const responseStream = await ai.models.generateContentStream({
      model: 'gemini-2.5-flash',
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
    });
    
    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of responseStream) {
            const chunkText = chunk.text;
            if (chunkText) {
              controller.enqueue(new TextEncoder().encode(chunkText));
            }
          }
          controller.close();
        } catch (e) {
          controller.error(e);
        }
      }
    });
    
    return new Response(stream, {
      headers: {
        'Content-Type': 'text/plain',
        'Cache-Control': 'no-cache',
      }
    });

  } catch (error: any) {
    console.error('Hint error:', error);
    return NextResponse.json(
      { error: 'Failed to generate hint' },
      { status: 503 }
    );
  }
}
