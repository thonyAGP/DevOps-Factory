// Test Generator Agent - MVP Version
// Génère automatiquement des tests unitaires pour fichiers sans coverage

import Anthropic from '@anthropic-ai/sdk';
import { Redis } from 'ioredis';
import { Pool } from 'pg';
import { readFile, writeFile } from 'fs/promises';
import { join, relative, dirname } from 'path';
import { z } from 'zod';
import { glob } from 'glob';

// === Configuration ===

const config = {
  agentId: process.env.AGENT_ID || 'test-generator',
  model: process.env.AGENT_MODEL || 'claude-haiku-4-5',
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  dbUrl: process.env.DB_URL || 'postgresql://localhost:5432/swarm_results',
  workspacePath: '/workspace',
  outputPath: '/output',
  maxConcurrentTasks: parseInt(process.env.MAX_CONCURRENT_TASKS || '3', 10),
  logLevel: process.env.LOG_LEVEL || 'info',
};

// === Schemas ===

const TaskSchema = z.object({
  taskId: z.string().uuid(),
  scanId: z.string().uuid(),
  projectName: z.string(),
  projectPath: z.string(),
  options: z.object({
    includeExistingTests: z.boolean().default(false),
    minFunctionLines: z.number().default(5),
    excludePatterns: z
      .array(z.string())
      .default(['**/node_modules/**', '**/dist/**', '**/build/**', '**/*.test.ts', '**/*.spec.ts']),
  }),
});

type Task = z.infer<typeof TaskSchema>;

interface GeneratedTest {
  sourceFile: string;
  testFile: string;
  testCode: string;
  testCount: number;
  reasoning: string;
}

interface AgentResult {
  taskId: string;
  scanId: string;
  agentName: string;
  results: {
    filesAnalyzed: number;
    testsGenerated: GeneratedTest[];
    skippedFiles: string[];
    errors: string[];
  };
  duration: number;
  tokensInput: number;
  tokensOutput: number;
  costUsd: number;
}

// === Clients ===

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const redis = new Redis(config.redisUrl);

const db = new Pool({
  connectionString: config.dbUrl,
});

// === Prompt Engineering ===

const SYSTEM_PROMPT = `Tu es un expert en génération de tests unitaires TypeScript/JavaScript.

Ton rôle: Analyser du code source et générer des tests Vitest de HAUTE QUALITÉ qui ont une VRAIE VALEUR.

CRITÈRES DE GÉNÉRATION (OBLIGATOIRE):
1. Générer UNIQUEMENT pour fonctions avec logique métier (if/switch/loops/transformations)
2. IGNORER: getters/setters simples, wrappers triviaux, types/interfaces
3. Focus sur: cas limites (null, undefined, [], ""), erreurs, edge cases
4. Nommer tests: "should [comportement] when [condition]"
5. Pattern AAA: Arrange, Act, Assert
6. Mock uniquement dépendances externes (API, DB), pas logique interne

FORMAT OUTPUT (JSON):
{
  "shouldGenerate": boolean,
  "reasoning": "Pourquoi générer ou non",
  "tests": [
    {
      "testName": "descriptif",
      "testCode": "code Vitest complet",
      "category": "edge-case | happy-path | error-handling"
    }
  ]
}

Si shouldGenerate = false, retourner tests = [].`;

const generateTestPrompt = (sourceCode: string, filePath: string) => `
Fichier: ${filePath}

\`\`\`typescript
${sourceCode}
\`\`\`

Analyse ce fichier et génère des tests Vitest si pertinent.

RAPPEL:
- Générer SEULEMENT si logique métier non triviale
- Tests avec vraie valeur (pas juste pour coverage)
- Cas limites et erreurs prioritaires

Retourne JSON format spécifié dans system prompt.
`;

// === Core Logic ===

class TestGeneratorAgent {
  private taskQueue: string[] = [];
  private processing = false;

  async start() {
    log('info', 'Agent Test Generator démarré', {
      model: config.model,
      maxConcurrent: config.maxConcurrentTasks,
    });

    // S'abonner aux tâches Redis
    await redis.subscribe('tasks:test-generator');

    redis.on('message', async (channel, message) => {
      if (channel === 'tasks:test-generator') {
        this.taskQueue.push(message);
        this.processTasks();
      }
    });

    // Healthcheck périodique
    setInterval(() => this.publishHealthcheck(), 30000);

    log('info', 'Agent prêt - en attente de tâches');
  }

  private async processTasks() {
    if (this.processing || this.taskQueue.length === 0) return;

    this.processing = true;

    while (this.taskQueue.length > 0) {
      const taskData = this.taskQueue.shift();
      if (!taskData) continue;

      try {
        const task = TaskSchema.parse(JSON.parse(taskData));
        await this.executeTask(task);
      } catch (error) {
        log('error', 'Erreur parsing task', { error });
      }
    }

    this.processing = false;
  }

  private async executeTask(task: Task) {
    const startTime = Date.now();
    log('info', `Démarrage tâche ${task.taskId}`, { project: task.projectName });

    const result: AgentResult = {
      taskId: task.taskId,
      scanId: task.scanId,
      agentName: config.agentId,
      results: {
        filesAnalyzed: 0,
        testsGenerated: [],
        skippedFiles: [],
        errors: [],
      },
      duration: 0,
      tokensInput: 0,
      tokensOutput: 0,
      costUsd: 0,
    };

    try {
      // 1. Trouver fichiers TypeScript sans tests
      const sourceFiles = await this.findFilesWithoutTests(
        task.projectPath,
        task.options.excludePatterns
      );

      log('info', `${sourceFiles.length} fichiers sans tests trouvés`);

      // 2. Analyser chaque fichier et générer tests
      for (const sourceFile of sourceFiles) {
        try {
          const generated = await this.generateTestForFile(
            sourceFile,
            task.projectPath,
            task.options.minFunctionLines
          );

          if (generated) {
            result.results.testsGenerated.push(generated);
            result.tokensInput += generated.tokensInput || 0;
            result.tokensOutput += generated.tokensOutput || 0;

            // Sauvegarder test généré dans DB
            await this.saveGeneratedTest(task.scanId, generated);
          } else {
            result.results.skippedFiles.push(sourceFile);
          }

          result.results.filesAnalyzed++;
        } catch (error) {
          log('error', `Erreur génération test pour ${sourceFile}`, { error });
          result.results.errors.push(`${sourceFile}: ${error}`);
        }
      }

      // 3. Calculer coût
      result.costUsd = this.calculateCost(result.tokensInput, result.tokensOutput);

      // 4. Sauvegarder résultats
      result.duration = Date.now() - startTime;
      await this.saveAgentResult(result);

      // 5. Publier résultat
      await redis.publish('results:test-generator', JSON.stringify(result));

      log('info', `Tâche ${task.taskId} terminée`, {
        testsGenerated: result.results.testsGenerated.length,
        duration: result.duration,
        cost: result.costUsd,
      });
    } catch (error) {
      log('error', `Erreur critique tâche ${task.taskId}`, { error });
      result.results.errors.push(String(error));
      await this.saveAgentResult(result);
    }
  }

  private async findFilesWithoutTests(
    projectPath: string,
    excludePatterns: string[]
  ): Promise<string[]> {
    const fullPath = join(config.workspacePath, projectPath);

    // Trouver tous les fichiers .ts (pas .test.ts)
    const allFiles = await glob('**/*.ts', {
      cwd: fullPath,
      ignore: [...excludePatterns, '**/*.test.ts', '**/*.spec.ts'],
      absolute: true,
    });

    // Filtrer ceux sans fichier test correspondant
    const filesWithoutTests: string[] = [];

    for (const file of allFiles) {
      const testFile = file.replace(/\.ts$/, '.test.ts');
      const specFile = file.replace(/\.ts$/, '.spec.ts');

      const hasTest = (await fileExists(testFile)) || (await fileExists(specFile));

      if (!hasTest) {
        filesWithoutTests.push(relative(fullPath, file));
      }
    }

    return filesWithoutTests;
  }

  private async generateTestForFile(
    relativeFilePath: string,
    projectPath: string,
    minFunctionLines: number
  ): Promise<GeneratedTest | null> {
    const fullPath = join(config.workspacePath, projectPath, relativeFilePath);
    const sourceCode = await readFile(fullPath, 'utf-8');

    // Filtre rapide: ignorer fichiers trop petits ou sans exports
    if (sourceCode.length < 100 || !sourceCode.includes('export')) {
      return null;
    }

    // Appel API Claude
    const response = await anthropic.messages.create({
      model: config.model,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: generateTestPrompt(sourceCode, relativeFilePath),
        },
      ],
    });

    const content = response.content[0];
    if (content.type !== 'text') return null;

    // Parser réponse JSON
    const llmResponse = JSON.parse(content.text);

    if (!llmResponse.shouldGenerate || llmResponse.tests.length === 0) {
      log('debug', `Pas de test généré pour ${relativeFilePath}`, {
        reason: llmResponse.reasoning,
      });
      return null;
    }

    // Construire fichier test complet
    const testCode = this.buildTestFile(relativeFilePath, llmResponse.tests, sourceCode);

    const testFilePath = relativeFilePath.replace(/\.ts$/, '.test.ts');

    return {
      sourceFile: relativeFilePath,
      testFile: testFilePath,
      testCode,
      testCount: llmResponse.tests.length,
      reasoning: llmResponse.reasoning,
      tokensInput: response.usage.input_tokens,
      tokensOutput: response.usage.output_tokens,
    };
  }

  private buildTestFile(sourceFile: string, tests: any[], originalCode: string): string {
    const importPath = './' + sourceFile.replace(/\.ts$/, '');

    // Extraire exports du fichier source pour imports
    const exports = this.extractExports(originalCode);

    return `// Auto-generated by Test Generator Agent
// Source: ${sourceFile}
// Generated: ${new Date().toISOString()}

import { describe, it, expect } from 'vitest'
import { ${exports.join(', ')} } from '${importPath}'

${tests.map((test) => test.testCode).join('\n\n')}
`;
  }

  private extractExports(code: string): string[] {
    // Simple regex pour extraire exports (peut être amélioré)
    const exportRegex = /export\s+(?:const|function|class)\s+(\w+)/g;
    const exports: string[] = [];
    let match;

    while ((match = exportRegex.exec(code)) !== null) {
      exports.push(match[1]);
    }

    return exports;
  }

  private calculateCost(inputTokens: number, outputTokens: number): number {
    // Prix Claude Haiku 4.5 (mars 2024)
    const PRICE_INPUT_PER_MTok = 0.25; // $0.25 / 1M tokens
    const PRICE_OUTPUT_PER_MTok = 1.25; // $1.25 / 1M tokens

    const costInput = (inputTokens / 1_000_000) * PRICE_INPUT_PER_MTok;
    const costOutput = (outputTokens / 1_000_000) * PRICE_OUTPUT_PER_MTok;

    return costInput + costOutput;
  }

  private async saveGeneratedTest(scanId: string, test: GeneratedTest) {
    await db.query(
      `INSERT INTO generated_tests (scan_id, source_file, test_file, test_code, test_count, status)
       VALUES ($1, $2, $3, $4, $5, 'pending')`,
      [scanId, test.sourceFile, test.testFile, test.testCode, test.testCount]
    );
  }

  private async saveAgentResult(result: AgentResult) {
    await db.query(
      `INSERT INTO agent_results (scan_id, agent_name, results, files_analyzed, duration_seconds, tokens_input, tokens_output, cost_usd)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        result.scanId,
        result.agentName,
        JSON.stringify(result.results),
        result.results.filesAnalyzed,
        Math.round(result.duration / 1000),
        result.tokensInput,
        result.tokensOutput,
        result.costUsd,
      ]
    );
  }

  private async publishHealthcheck() {
    await redis.publish(
      'health',
      JSON.stringify({
        agent: config.agentId,
        status: 'healthy',
        queueSize: this.taskQueue.length,
        timestamp: Date.now(),
      })
    );
  }
}

// === Helpers ===

async function fileExists(path: string): Promise<boolean> {
  try {
    await readFile(path);
    return true;
  } catch {
    return false;
  }
}

function log(level: string, message: string, meta: any = {}) {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    level,
    agent: config.agentId,
    message,
    ...meta,
  };

  if (level === 'error') {
    console.error(JSON.stringify(logEntry));
  } else if (level === 'debug' && config.logLevel !== 'debug') {
    return;
  } else {
    console.log(JSON.stringify(logEntry));
  }
}

// === Start ===

const agent = new TestGeneratorAgent();
agent.start().catch((error) => {
  log('error', 'Erreur fatale démarrage agent', { error });
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  log('info', 'Arrêt gracieux...');
  await redis.quit();
  await db.end();
  process.exit(0);
});
