/**
 * test-scaffold.test.ts
 *
 * Tests du generateur de squelettes de tests.
 *
 * Contrairement aux autres tests de ce depot, celui-ci importe les VRAIES
 * fonctions au lieu de redeclarer leurs constantes : un test qui verifie sa
 * propre copie ne protege de rien.
 *
 * Regression couverte : le generateur produisait `foo.test.test.ts` puis
 * `foo.test.test.test.ts`, et des squelettes qui cassaient le lint du depot
 * cible (PR CasaSync #287 et #295, fermees).
 */

import { describe, it, expect } from 'vitest';
import {
  isSkippedFile,
  findSourceFiles,
  findUncoveredFiles,
  generateTestSkeleton,
} from './test-scaffold.js';
import type { TreeNode } from './types.js';

const blob = (path: string): TreeNode => ({ path, type: 'blob' }) as TreeNode;

describe('isSkippedFile', () => {
  it('ignore les fichiers de test — sans quoi ils deviennent des candidats', () => {
    expect(isSkippedFile('src/lib/foo.test.ts')).toBe(true);
    expect(isSkippedFile('src/lib/foo.test.tsx')).toBe(true);
    expect(isSkippedFile('src/lib/foo.spec.ts')).toBe(true);
    expect(isSkippedFile('src/lib/foo.spec.tsx')).toBe(true);
  });

  it('ignore aussi les suffixes deja empiles par les anciens passages', () => {
    expect(isSkippedFile('src/lib/foo.test.test.ts')).toBe(true);
    expect(isSkippedFile('src/lib/foo.test.test.test.ts')).toBe(true);
  });

  it('laisse passer une vraie source', () => {
    expect(isSkippedFile('src/lib/foo.ts')).toBe(false);
    expect(isSkippedFile('src/components/Bar.tsx')).toBe(false);
  });

  it('conserve les exclusions historiques', () => {
    expect(isSkippedFile('src/types/global.d.ts')).toBe(true);
    expect(isSkippedFile('src/lib/vitest.config.ts')).toBe(true);
    expect(isSkippedFile('src/lib/index.ts')).toBe(true);
  });
});

describe('findSourceFiles', () => {
  it('exclut les fichiers de test de l arbre', () => {
    const tree = [
      blob('src/lib/foo.ts'),
      blob('src/lib/foo.test.ts'),
      blob('src/lib/bar.tsx'),
      blob('src/lib/bar.spec.tsx'),
    ];
    expect(findSourceFiles(tree)).toEqual(['src/lib/foo.ts', 'src/lib/bar.tsx']);
  });
});

describe('idempotence — la regression des suffixes empiles', () => {
  it('un second passage ne genere plus rien quand tout est couvert', () => {
    const tree = [blob('src/lib/foo.ts'), blob('src/lib/foo.test.ts')];
    const all = tree.map((n) => n.path);

    const premierPassage = findUncoveredFiles(findSourceFiles(tree), all);
    expect(premierPassage).toEqual([]);
  });

  it('ne propose JAMAIS foo.test.test.ts', () => {
    // Avant le correctif : `foo.test.ts` etait vu comme une source, on
    // cherchait `foo.test.test.ts`, absent, donc on le generait.
    const tree = [blob('src/lib/foo.ts'), blob('src/lib/foo.test.ts')];
    const all = tree.map((n) => n.path);

    const candidats = findUncoveredFiles(findSourceFiles(tree), all);
    const cibles = candidats.map((p) => p.replace(/\.(ts|tsx)$/, '.test.$1'));

    expect(cibles).not.toContain('src/lib/foo.test.test.ts');
    expect(cibles.some((p) => /\.test\.test\./.test(p))).toBe(false);
  });

  it('propose bien la source reellement non couverte', () => {
    const tree = [
      blob('src/lib/couvert.ts'),
      blob('src/lib/couvert.test.ts'),
      blob('src/lib/orphelin.ts'),
    ];
    const all = tree.map((n) => n.path);

    expect(findUncoveredFiles(findSourceFiles(tree), all)).toEqual(['src/lib/orphelin.ts']);
  });

  it('reconnait .spec comme une couverture valide', () => {
    const tree = [blob('src/lib/foo.ts'), blob('src/lib/foo.spec.ts')];
    const all = tree.map((n) => n.path);

    expect(findUncoveredFiles(findSourceFiles(tree), all)).toEqual([]);
  });
});

describe('generateTestSkeleton', () => {
  it('n importe que ce qu il utilise — sinon le lint de la cible casse', () => {
    const out = generateTestSkeleton('src/lib/foo.ts', ['doStuff']);

    expect(out).toContain("import { describe, it } from 'vitest';");
    expect(out).not.toContain('expect');
  });

  it('liste un it.todo par export', () => {
    const out = generateTestSkeleton('src/lib/foo.ts', ['alpha', 'beta']);

    expect(out).toContain("it.todo('should test alpha');");
    expect(out).toContain("it.todo('should test beta');");
  });

  it('reste valide sans aucun export detecte', () => {
    const out = generateTestSkeleton('src/lib/foo.ts', []);

    expect(out).toContain("it.todo('should test exported functionality');");
    expect(out).toContain("describe('foo', () => {");
  });
});
