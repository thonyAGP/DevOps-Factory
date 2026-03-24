import { AI_PROVIDERS, GEMINI_URL } from './constants.js';
import type { FailedJob, GeminiResponse } from './types.js';

export const buildPrompt = (jobs: FailedJob[], files: Map<string, string>): string => {
  const errorsSection = jobs
    .map((j) => {
      const annots = j.annotations
        .map((a) => `  - ${a.path}:${a.start_line}: ${a.message}`)
        .join('\n');
      return `### ${j.name}\n${annots || '(no structured errors)'}`;
    })
    .join('\n\n');

  const logsSection = jobs
    .filter((j) => j.annotations.length === 0)
    .map((j) => `### ${j.name} (raw logs)\n\`\`\`\n${j.logs.slice(0, 3000)}\n\`\`\``)
    .join('\n\n');

  const filesSection = [...files.entries()]
    .map(([path, content]) => `### ${path}\n\`\`\`\n${content}\n\`\`\``)
    .join('\n\n');

  return `You are a CI/CD fix assistant. Analyze the structured errors and source files below.

## Errors by Job
${errorsSection}

${logsSection ? `## Additional Logs\n${logsSection}\n` : ''}
## Source Files
${filesSection.slice(0, 60000)}

## Instructions
- Focus on BUILD/COMPILE errors first, but also fix formatting issues (trailing whitespace, missing blank lines) if present
- For "already contains a definition" errors: the class exists in TWO files. Remove the DUPLICATE (the one embedded in a larger file), keep the standalone file.
- Propose the MINIMAL fix (fewest lines changed)
- For PARTIAL files (marked "showing context around errors"): use "replacements" array instead of "content"
  - Each replacement has "search" (exact multi-line text to find) and "replace" (exact text to replace with)
  - "search" must be unique in the file - include 2-5 lines of context around the change
  - Do NOT use "content" for partial files - only "replacements"
- For COMPLETE files: use "content" with the full file content including fix
- If you cannot fix it, return empty fixes with an explanation

## Response Format (JSON only)
{
  "fixes": [
    {
      "path": "relative/path/to/file.ext",
      "content": "full file content with fix applied (for complete files)",
      "replacements": [{"search": "exact old text", "replace": "exact new text"}]
    }
  ],
  "explanation": "Brief explanation of what was wrong and what was fixed"
}
Note: Use EITHER "content" OR "replacements" per fix, never both.`;
};

export const askOpenAIProvider = async (
  provider: (typeof AI_PROVIDERS)[number],
  jobs: FailedJob[],
  files: Map<string, string>,
  patternHint = ''
): Promise<GeminiResponse> => {
  const apiKey = process.env[provider.envKey];
  if (!apiKey) {
    console.log(`${provider.envKey} not set - skipping ${provider.name}`);
    return { fixes: [], explanation: `Missing ${provider.envKey}` };
  }

  const prompt = buildPrompt(jobs, files) + patternHint;
  console.log(
    `Asking ${provider.name} (${provider.model}, ${Math.round(prompt.length / 1024)}KB)...`
  );

  try {
    const response = await fetch(provider.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: provider.model,
        max_tokens: 8192,
        temperature: 0.2,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: AbortSignal.timeout(provider.timeout),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`${provider.name} API error ${response.status}: ${errText.slice(0, 200)}`);
      return { fixes: [], explanation: `${provider.name} API error: ${response.status}` };
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    const text = data.choices?.[0]?.message?.content;
    if (!text) {
      console.error(`No response from ${provider.name}`);
      return { fixes: [], explanation: `Empty response from ${provider.name}` };
    }

    const jsonMatch = text.match(/\{[\s\S]*"fixes"[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]) as GeminiResponse;
        for (const fix of parsed.fixes) {
          const mode = fix.replacements?.length
            ? `${fix.replacements.length} replacement(s)`
            : fix.content
              ? `${Math.round(fix.content.length / 1024)}KB content`
              : 'empty';
          console.log(`  [${provider.name}] fix: ${fix.path} (${mode})`);
        }
        return parsed;
      } catch {
        // fall through
      }
    }

    return {
      fixes: [],
      explanation: `${provider.name} response (non-JSON): ${text.slice(0, 500)}`,
    };
  } catch (e: unknown) {
    const err = e as { message?: string };
    console.error(`${provider.name} failed: ${err.message?.slice(0, 200)}`);
    return { fixes: [], explanation: `${provider.name} unavailable` };
  }
};

export const askGemini = async (
  jobs: FailedJob[],
  files: Map<string, string>,
  patternHint = ''
): Promise<GeminiResponse> => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('GEMINI_API_KEY not set');
    return { fixes: [], explanation: 'Missing GEMINI_API_KEY' };
  }

  const prompt = buildPrompt(jobs, files) + patternHint;

  console.log(`Asking Gemini 2.5 Flash (prompt: ${Math.round(prompt.length / 1024)}KB)...`);

  const response = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 8192,
        responseMimeType: 'application/json',
      },
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error(`Gemini API error ${response.status}: ${errText}`);
    return { fixes: [], explanation: `Gemini API error: ${response.status}` };
  }

  const data = (await response.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    console.error('No response from Gemini');
    return { fixes: [], explanation: 'Empty response from Gemini' };
  }

  try {
    return JSON.parse(text) as GeminiResponse;
  } catch {
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[1]) as GeminiResponse;
      } catch {
        // fall through
      }
    }
    console.error('Failed to parse Gemini response:', text.slice(0, 500));
    return { fixes: [], explanation: 'Could not parse Gemini response' };
  }
};
