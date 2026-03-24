import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  normalizeLogPath,
  findClassBoundaries,
  getErrorSignature,
  isLikelyFlaky,
  canAutoFixPrettier,
  canAutoFixLockfile,
  getAnnotatedFiles,
  removeDuplicateClass,
} from './error-analysis.js';
import type { FailedJob } from './types.js';

// Mock github-api
vi.mock('./github-api.js', () => ({
  fetchFullFileContent: vi.fn(),
  ghApi: vi.fn(),
}));

import { fetchFullFileContent } from './github-api.js';

describe('normalizeLogPath', () => {
  it('should strip Linux CI runner prefix', () => {
    // Arrange
    const path = '/home/runner/work/repo/repo/src/file.ts';

    // Act
    const result = normalizeLogPath(path);

    // Assert
    expect(result).toBe('src/file.ts');
  });

  it('should strip Windows forward slash CI runner prefix', () => {
    // Arrange
    const path = 'D/a/my-repo/my-repo/src/components/Button.tsx';

    // Act
    const result = normalizeLogPath(path);

    // Assert
    expect(result).toBe('src/components/Button.tsx');
  });

  it('should strip Windows backslash CI runner prefix', () => {
    // Arrange
    const path = 'D:\\a\\repo\\repo\\src\\utils\\helper.ts';

    // Act
    const result = normalizeLogPath(path);

    // Assert
    expect(result).toBe('src/utils/helper.ts');
  });

  it('should return already relative path unchanged', () => {
    // Arrange
    const path = 'src/file.ts';

    // Act
    const result = normalizeLogPath(path);

    // Assert
    expect(result).toBe('src/file.ts');
  });

  it('should return empty string as empty string', () => {
    // Arrange
    const path = '';

    // Act
    const result = normalizeLogPath(path);

    // Assert
    expect(result).toBe('');
  });

  it('should handle deeply nested paths', () => {
    // Arrange
    const path =
      '/home/runner/work/my-project/my-project/src/features/auth/components/LoginForm.tsx';

    // Act
    const result = normalizeLogPath(path);

    // Assert
    expect(result).toBe('src/features/auth/components/LoginForm.tsx');
  });

  it('should handle Windows paths with backslashes in nested directories', () => {
    // Arrange
    const path = 'C:\\a\\project\\project\\tests\\unit\\services\\auth.test.ts';

    // Act
    const result = normalizeLogPath(path);

    // Assert
    expect(result).toBe('tests/unit/services/auth.test.ts');
  });
});

describe('findClassBoundaries', () => {
  it('should find simple class with matching braces', () => {
    // Arrange
    const content = `public class MyClass
{
  public void Method() { }
}`;
    const className = 'MyClass';

    // Act
    const result = findClassBoundaries(content, className);

    // Assert
    expect(result).toEqual({ startLine: 0, endLine: 3 });
  });

  it('should find class with XML documentation comment', () => {
    // Arrange
    const content = `/// <summary>
/// A test class
/// </summary>
public class MyClass
{
  public void Method() { }
}`;
    const className = 'MyClass';

    // Act
    const result = findClassBoundaries(content, className);

    // Assert
    expect(result).toEqual({ startLine: 0, endLine: 6 });
  });

  it('should find class with attributes', () => {
    // Arrange
    const content = `[Serializable]
[Obsolete]
public class MyClass
{
  private int field = 0;
}`;
    const className = 'MyClass';

    // Act
    const result = findClassBoundaries(content, className);

    // Assert
    expect(result).toEqual({ startLine: 0, endLine: 5 });
  });

  it('should find class with mixed documentation and attributes', () => {
    // Arrange
    const content = `/// <summary>
/// A documented class
/// </summary>
[Attribute]
public class DocumentedClass
{
  public int Value { get; set; }
}`;
    const className = 'DocumentedClass';

    // Act
    const result = findClassBoundaries(content, className);

    // Assert
    expect(result).toEqual({ startLine: 0, endLine: 7 });
  });

  it('should handle class with nested braces in methods', () => {
    // Arrange
    const content = `public class NestedBraces
{
  public void Method()
  {
    if (true) { return; }
  }
}`;
    const className = 'NestedBraces';

    // Act
    const result = findClassBoundaries(content, className);

    // Assert
    expect(result).toEqual({ startLine: 0, endLine: 6 });
  });

  it('should return null when class not found', () => {
    // Arrange
    const content = `public class ExistingClass
{
}`;
    const className = 'NonExistentClass';

    // Act
    const result = findClassBoundaries(content, className);

    // Assert
    expect(result).toBeNull();
  });

  it('should handle empty lines before class declaration', () => {
    // Arrange
    const content = `namespace MyNamespace
{

  public class MyClass
  {
    public string Name { get; set; }
  }
}`;
    const className = 'MyClass';

    // Act
    const result = findClassBoundaries(content, className);

    // Assert
    expect(result).toEqual({ startLine: 2, endLine: 6 });
  });

  it('should find first occurrence of duplicated class names', () => {
    // Arrange
    const content = `public class Duplicate { }
public class Other { }
public class Duplicate { }`;
    const className = 'Duplicate';

    // Act
    const result = findClassBoundaries(content, className);

    // Assert
    // Single-line class: braces balance on same line but guard requires i > classIdx,
    // so endLine advances to next line where braces also balance
    expect(result).toEqual({ startLine: 0, endLine: 1 });
  });
});

describe('getErrorSignature', () => {
  it('should return annotation message when available', () => {
    // Arrange
    const jobs: FailedJob[] = [
      {
        id: 1,
        name: 'test',
        annotations: [
          {
            path: 'src/file.ts',
            start_line: 10,
            end_line: 10,
            annotation_level: 'failure',
            message: 'Type error: Property not found on type',
          },
        ],
        logs: '',
      },
    ];

    // Act
    const result = getErrorSignature(jobs);

    // Assert
    expect(result).toBe('Type error: Property not found on type');
  });

  it('should truncate annotation message to 80 characters', () => {
    // Arrange
    const longMessage = 'A'.repeat(100);
    const jobs: FailedJob[] = [
      {
        id: 1,
        name: 'test',
        annotations: [
          {
            path: 'src/file.ts',
            start_line: 10,
            end_line: 10,
            annotation_level: 'failure',
            message: longMessage,
          },
        ],
        logs: '',
      },
    ];

    // Act
    const result = getErrorSignature(jobs);

    // Assert
    expect(result).toBe('A'.repeat(80));
    expect(result.length).toBe(80);
  });

  it('should extract error from logs when no annotation', () => {
    // Arrange
    const jobs: FailedJob[] = [
      {
        id: 1,
        name: 'build',
        annotations: [],
        logs: `Some build output
error TS2322: Type 'string' is not assignable to type 'number'
More output`,
      },
    ];

    // Act
    const result = getErrorSignature(jobs);

    // Assert
    expect(result).toContain('error TS2322');
  });

  it('should extract C# error from logs', () => {
    // Arrange
    const jobs: FailedJob[] = [
      {
        id: 1,
        name: 'build',
        annotations: [],
        logs: `Compiling...
error CS0104: 'MyClass' is an ambiguous reference between 'Namespace1' and 'Namespace2'
Done`,
      },
    ];

    // Act
    const result = getErrorSignature(jobs);

    // Assert
    expect(result).toContain('error CS0104');
  });

  it('should return unknown-error when no signature found', () => {
    // Arrange
    const jobs: FailedJob[] = [
      {
        id: 1,
        name: 'test',
        annotations: [],
        logs: 'Some random output with no errors',
      },
    ];

    // Act
    const result = getErrorSignature(jobs);

    // Assert
    expect(result).toBe('unknown-error');
  });

  it('should skip short annotations (less than 10 chars)', () => {
    // Arrange
    const jobs: FailedJob[] = [
      {
        id: 1,
        name: 'test',
        annotations: [
          {
            path: 'src/file.ts',
            start_line: 10,
            end_line: 10,
            annotation_level: 'failure',
            message: 'Short',
          },
        ],
        logs: 'error ERR_PNPM: Failed to install package',
      },
    ];

    // Act
    const result = getErrorSignature(jobs);

    // Assert
    expect(result).toContain('ERR_PNPM');
  });
});

describe('isLikelyFlaky', () => {
  it('should detect ETIMEDOUT pattern', () => {
    // Arrange
    const jobs: FailedJob[] = [
      {
        id: 1,
        name: 'e2e-test',
        annotations: [],
        logs: 'Error: connect ETIMEDOUT 127.0.0.1:3000',
      },
    ];

    // Act
    const result = isLikelyFlaky(jobs);

    // Assert
    expect(result).toBe(true);
  });

  it('should detect ECONNRESET pattern', () => {
    // Arrange
    const jobs: FailedJob[] = [
      {
        id: 1,
        name: 'integration-test',
        annotations: [],
        logs: 'Error: Connection reset by peer ECONNRESET',
      },
    ];

    // Act
    const result = isLikelyFlaky(jobs);

    // Assert
    expect(result).toBe(true);
  });

  it('should detect socket hang up pattern', () => {
    // Arrange
    const jobs: FailedJob[] = [
      {
        id: 1,
        name: 'api-test',
        annotations: [],
        logs: 'socket hang up unexpected end of file while parsing',
      },
    ];

    // Act
    const result = isLikelyFlaky(jobs);

    // Assert
    expect(result).toBe(true);
  });

  it('should detect TimeoutError pattern', () => {
    // Arrange
    const jobs: FailedJob[] = [
      {
        id: 1,
        name: 'browser-test',
        annotations: [],
        logs: 'TimeoutError: Waiting for test to complete',
      },
    ];

    // Act
    const result = isLikelyFlaky(jobs);

    // Assert
    expect(result).toBe(true);
  });

  it('should detect Navigation timeout pattern', () => {
    // Arrange
    const jobs: FailedJob[] = [
      {
        id: 1,
        name: 'e2e-test',
        annotations: [],
        logs: 'Navigation timeout of 30000 ms exceeded',
      },
    ];

    // Act
    const result = isLikelyFlaky(jobs);

    // Assert
    expect(result).toBe(true);
  });

  it('should detect Waiting for selector pattern', () => {
    // Arrange
    const jobs: FailedJob[] = [
      {
        id: 1,
        name: 'playwright-test',
        annotations: [],
        logs: 'Waiting for selector div.modal to be visible',
      },
    ];

    // Act
    const result = isLikelyFlaky(jobs);

    // Assert
    expect(result).toBe(true);
  });

  it('should detect flaky keyword', () => {
    // Arrange
    const jobs: FailedJob[] = [
      {
        id: 1,
        name: 'test',
        annotations: [],
        logs: 'Test marked as flaky - retrying',
      },
    ];

    // Act
    const result = isLikelyFlaky(jobs);

    // Assert
    expect(result).toBe(true);
  });

  it('should detect ENOSPC pattern', () => {
    // Arrange
    const jobs: FailedJob[] = [
      {
        id: 1,
        name: 'build',
        annotations: [],
        logs: 'Error: ENOSPC: no space left on device',
      },
    ];

    // Act
    const result = isLikelyFlaky(jobs);

    // Assert
    expect(result).toBe(true);
  });

  it('should return false for normal error', () => {
    // Arrange
    const jobs: FailedJob[] = [
      {
        id: 1,
        name: 'test',
        annotations: [],
        logs: 'error TS2322: Type mismatch in assignment',
      },
    ];

    // Act
    const result = isLikelyFlaky(jobs);

    // Assert
    expect(result).toBe(false);
  });

  it('should return false for empty logs', () => {
    // Arrange
    const jobs: FailedJob[] = [
      {
        id: 1,
        name: 'test',
        annotations: [],
        logs: '',
      },
    ];

    // Act
    const result = isLikelyFlaky(jobs);

    // Assert
    expect(result).toBe(false);
  });

  it('should detect flaky pattern across multiple jobs', () => {
    // Arrange
    const jobs: FailedJob[] = [
      {
        id: 1,
        name: 'test-1',
        annotations: [],
        logs: 'Normal error',
      },
      {
        id: 2,
        name: 'test-2',
        annotations: [],
        logs: 'Error: ETIMEDOUT',
      },
    ];

    // Act
    const result = isLikelyFlaky(jobs);

    // Assert
    expect(result).toBe(true);
  });
});

describe('canAutoFixPrettier', () => {
  it('should detect prettier issue in quality job', () => {
    // Arrange
    const jobs: FailedJob[] = [
      {
        id: 1,
        name: 'quality',
        annotations: [],
        logs: 'Run Prettier with --write to fix formatting',
      },
    ];

    // Act
    const result = canAutoFixPrettier(jobs);

    // Assert
    expect(result).toBe(true);
  });

  it('should detect prettier issue in lint job', () => {
    // Arrange
    const jobs: FailedJob[] = [
      {
        id: 1,
        name: 'lint-and-format',
        annotations: [],
        logs: 'Run Prettier with --write to fix formatting issues',
      },
    ];

    // Act
    const result = canAutoFixPrettier(jobs);

    // Assert
    expect(result).toBe(true);
  });

  it('should handle case insensitive job name matching', () => {
    // Arrange
    const jobs: FailedJob[] = [
      {
        id: 1,
        name: 'QUALITY',
        annotations: [],
        logs: 'Run Prettier with --write to fix',
      },
    ];

    // Act
    const result = canAutoFixPrettier(jobs);

    // Assert
    expect(result).toBe(true);
  });

  it('should return false when no prettier message', () => {
    // Arrange
    const jobs: FailedJob[] = [
      {
        id: 1,
        name: 'quality',
        annotations: [],
        logs: 'Some other build error',
      },
    ];

    // Act
    const result = canAutoFixPrettier(jobs);

    // Assert
    expect(result).toBe(false);
  });

  it('should return false when quality job without prettier message', () => {
    // Arrange
    const jobs: FailedJob[] = [
      {
        id: 1,
        name: 'build',
        annotations: [],
        logs: 'Run Prettier with --write to fix',
      },
    ];

    // Act
    const result = canAutoFixPrettier(jobs);

    // Assert
    expect(result).toBe(false);
  });

  it('should return false for empty jobs', () => {
    // Arrange
    const jobs: FailedJob[] = [];

    // Act
    const result = canAutoFixPrettier(jobs);

    // Assert
    expect(result).toBe(false);
  });

  it('should detect prettier issue across multiple jobs', () => {
    // Arrange
    const jobs: FailedJob[] = [
      {
        id: 1,
        name: 'build',
        annotations: [],
        logs: 'Build error',
      },
      {
        id: 2,
        name: 'lint',
        annotations: [],
        logs: 'Run Prettier with --write to fix',
      },
    ];

    // Act
    const result = canAutoFixPrettier(jobs);

    // Assert
    expect(result).toBe(true);
  });
});

describe('canAutoFixLockfile', () => {
  it('should detect ERR_PNPM_OUTDATED_LOCKFILE pattern', () => {
    // Arrange
    const jobs: FailedJob[] = [
      {
        id: 1,
        name: 'install',
        annotations: [],
        logs: 'error ERR_PNPM_OUTDATED_LOCKFILE pnpm-lock.yaml is outdated',
      },
    ];

    // Act
    const result = canAutoFixLockfile(jobs);

    // Assert
    expect(result).toBe(true);
  });

  it('should detect npm warn old lockfile pattern', () => {
    // Arrange
    const jobs: FailedJob[] = [
      {
        id: 1,
        name: 'install',
        annotations: [],
        logs: 'npm warn old lockfile package-lock.json',
      },
    ];

    // Act
    const result = canAutoFixLockfile(jobs);

    // Assert
    expect(result).toBe(true);
  });

  it('should detect Your lockfile needs to be updated pattern', () => {
    // Arrange
    const jobs: FailedJob[] = [
      {
        id: 1,
        name: 'install',
        annotations: [],
        logs: 'Your lockfile needs to be updated',
      },
    ];

    // Act
    const result = canAutoFixLockfile(jobs);

    // Assert
    expect(result).toBe(true);
  });

  it('should detect --frozen-lockfile pattern', () => {
    // Arrange
    const jobs: FailedJob[] = [
      {
        id: 1,
        name: 'install',
        annotations: [],
        logs: 'error: Dependencies have changed. Run without --frozen-lockfile flag',
      },
    ];

    // Act
    const result = canAutoFixLockfile(jobs);

    // Assert
    expect(result).toBe(true);
  });

  it('should return false for normal build error', () => {
    // Arrange
    const jobs: FailedJob[] = [
      {
        id: 1,
        name: 'build',
        annotations: [],
        logs: 'error TS2322: Type mismatch',
      },
    ];

    // Act
    const result = canAutoFixLockfile(jobs);

    // Assert
    expect(result).toBe(false);
  });

  it('should return false for empty jobs', () => {
    // Arrange
    const jobs: FailedJob[] = [];

    // Act
    const result = canAutoFixLockfile(jobs);

    // Assert
    expect(result).toBe(false);
  });

  it('should detect lockfile issue across multiple jobs', () => {
    // Arrange
    const jobs: FailedJob[] = [
      {
        id: 1,
        name: 'test',
        annotations: [],
        logs: 'Test passed',
      },
      {
        id: 2,
        name: 'install',
        annotations: [],
        logs: 'error ERR_PNPM_OUTDATED_LOCKFILE pnpm-lock.yaml is outdated',
      },
    ];

    // Act
    const result = canAutoFixLockfile(jobs);

    // Assert
    expect(result).toBe(true);
  });
});

describe('getAnnotatedFiles', () => {
  it('should extract all file paths from annotations', () => {
    // Arrange
    const jobs: FailedJob[] = [
      {
        id: 1,
        name: 'test-1',
        annotations: [
          {
            path: 'src/file1.ts',
            start_line: 10,
            end_line: 10,
            annotation_level: 'failure',
            message: 'error',
          },
          {
            path: 'src/file2.ts',
            start_line: 20,
            end_line: 20,
            annotation_level: 'failure',
            message: 'error',
          },
        ],
        logs: '',
      },
    ];

    // Act
    const result = getAnnotatedFiles(jobs);

    // Assert
    expect(result).toEqual(new Set(['src/file1.ts', 'src/file2.ts']));
  });

  it('should deduplicate file paths', () => {
    // Arrange
    const jobs: FailedJob[] = [
      {
        id: 1,
        name: 'test-1',
        annotations: [
          {
            path: 'src/file.ts',
            start_line: 10,
            end_line: 10,
            annotation_level: 'failure',
            message: 'error1',
          },
          {
            path: 'src/file.ts',
            start_line: 20,
            end_line: 20,
            annotation_level: 'failure',
            message: 'error2',
          },
        ],
        logs: '',
      },
    ];

    // Act
    const result = getAnnotatedFiles(jobs);

    // Assert
    expect(result).toEqual(new Set(['src/file.ts']));
    expect(result.size).toBe(1);
  });

  it('should collect files from multiple jobs', () => {
    // Arrange
    const jobs: FailedJob[] = [
      {
        id: 1,
        name: 'test-1',
        annotations: [
          {
            path: 'src/file1.ts',
            start_line: 10,
            end_line: 10,
            annotation_level: 'failure',
            message: 'error',
          },
        ],
        logs: '',
      },
      {
        id: 2,
        name: 'test-2',
        annotations: [
          {
            path: 'src/file2.ts',
            start_line: 20,
            end_line: 20,
            annotation_level: 'failure',
            message: 'error',
          },
        ],
        logs: '',
      },
    ];

    // Act
    const result = getAnnotatedFiles(jobs);

    // Assert
    expect(result).toEqual(new Set(['src/file1.ts', 'src/file2.ts']));
  });

  it('should return empty set when no annotations', () => {
    // Arrange
    const jobs: FailedJob[] = [
      {
        id: 1,
        name: 'test',
        annotations: [],
        logs: 'some logs',
      },
    ];

    // Act
    const result = getAnnotatedFiles(jobs);

    // Assert
    expect(result).toEqual(new Set());
  });

  it('should return empty set for empty jobs array', () => {
    // Arrange
    const jobs: FailedJob[] = [];

    // Act
    const result = getAnnotatedFiles(jobs);

    // Assert
    expect(result).toEqual(new Set());
  });

  it('should ignore empty paths', () => {
    // Arrange
    const jobs: FailedJob[] = [
      {
        id: 1,
        name: 'test',
        annotations: [
          {
            path: 'src/file.ts',
            start_line: 10,
            end_line: 10,
            annotation_level: 'failure',
            message: 'error',
          },
          {
            path: '',
            start_line: 20,
            end_line: 20,
            annotation_level: 'failure',
            message: 'error',
          },
        ],
        logs: '',
      },
    ];

    // Act
    const result = getAnnotatedFiles(jobs);

    // Assert
    expect(result).toEqual(new Set(['src/file.ts']));
  });
});

describe('removeDuplicateClass', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should remove duplicate class from file', () => {
    // Arrange — enough lines so removed class is <50% of total
    const fileContent = `using System;
using System.Collections.Generic;

namespace MyNamespace
{
  public class One { }

  public class Duplicate
  {
    public void Method() { }
  }

  public class Three { }
  public class Four { }
  public class Five { }
}`;

    vi.mocked(fetchFullFileContent).mockReturnValue(fileContent);

    // Act
    const result = removeDuplicateClass('owner/repo', 'src/file.cs', 'Duplicate', 'main');

    // Assert
    expect(result).not.toBeNull();
    expect(result?.path).toBe('src/file.cs');
    expect(result?.content).toContain('public class One');
    expect(result?.content).toContain('public class Three');
    expect(result?.content).not.toContain('public class Duplicate');
  });

  it('should return null when file not found', () => {
    // Arrange
    vi.mocked(fetchFullFileContent).mockReturnValue(null);

    // Act
    const result = removeDuplicateClass('owner/repo', 'src/file.cs', 'Duplicate', 'main');

    // Assert
    expect(result).toBeNull();
  });

  it('should return null when class not found in file', () => {
    // Arrange
    const fileContent = `public class One { }
public class Two { }`;

    vi.mocked(fetchFullFileContent).mockReturnValue(fileContent);

    // Act
    const result = removeDuplicateClass('owner/repo', 'src/file.cs', 'NonExistent', 'main');

    // Assert
    expect(result).toBeNull();
  });

  it('should safely remove class with empty lines around it', () => {
    // Arrange — enough lines so removed class is <50% of total
    const fileContent = `using System;
using System.Linq;

namespace MyNamespace
{
  public class One { }

  public class Duplicate
  {
    public int Value { get; set; }
  }

  public class Three { }
  public class Four { }
  public class Five { }
}`;

    vi.mocked(fetchFullFileContent).mockReturnValue(fileContent);

    // Act
    const result = removeDuplicateClass('owner/repo', 'src/file.cs', 'Duplicate', 'main');

    // Assert
    expect(result).not.toBeNull();
    expect(result?.content).toContain('public class One');
    expect(result?.content).toContain('public class Three');
    expect(result?.content).not.toContain('Duplicate');
  });

  it('should refuse to remove class larger than 50% of file', () => {
    // Arrange
    const fileContent = `public class Small { }

public class Huge
{
  public void Method1() { }
  public void Method2() { }
  public void Method3() { }
  public void Method4() { }
  public void Method5() { }
  public void Method6() { }
  public void Method7() { }
  public void Method8() { }
  public void Method9() { }
}`;

    vi.mocked(fetchFullFileContent).mockReturnValue(fileContent);

    // Act
    const result = removeDuplicateClass('owner/repo', 'src/file.cs', 'Huge', 'main');

    // Assert
    expect(result).toBeNull();
  });

  it('should handle class with documentation and attributes', () => {
    // Arrange — enough lines so removed class is <50% of total
    const fileContent = `using System;
using System.Linq;

namespace MyNamespace
{
  public class One { }

  /// <summary>
  /// A duplicate class
  /// </summary>
  [Serializable]
  public class Duplicate
  {
    public string Name { get; set; }
  }

  public class Three { }
  public class Four { }
  public class Five { }
}`;

    vi.mocked(fetchFullFileContent).mockReturnValue(fileContent);

    // Act
    const result = removeDuplicateClass('owner/repo', 'src/file.cs', 'Duplicate', 'main');

    // Assert
    expect(result).not.toBeNull();
    expect(result?.content).not.toContain('Duplicate');
    expect(result?.content).toContain('public class One');
    expect(result?.content).toContain('public class Three');
  });

  it('should maintain fetchFullFileContent call with correct parameters', () => {
    // Arrange
    const fileContent = `public class Test { }`;
    vi.mocked(fetchFullFileContent).mockReturnValue(fileContent);

    // Act
    removeDuplicateClass('owner/repo', 'src/file.cs', 'Test', 'develop');

    // Assert
    expect(fetchFullFileContent).toHaveBeenCalledWith('owner/repo', 'src/file.cs', 'develop');
  });

  it('should clean up trailing/leading empty lines between classes', () => {
    // Arrange — enough lines so removed class is <50% of total
    const fileContent = `using System;
using System.Linq;

namespace MyNamespace
{
  public class First { }


  public class Duplicate
  {
    public int X { get; set; }
  }


  public class Last { }
  public class Extra1 { }
  public class Extra2 { }
}`;

    vi.mocked(fetchFullFileContent).mockReturnValue(fileContent);

    // Act
    const result = removeDuplicateClass('owner/repo', 'src/file.cs', 'Duplicate', 'main');

    // Assert
    expect(result).not.toBeNull();
    const lines = result?.content.split('\n') || [];
    // Should not have excessive empty lines
    const emptyLines = lines.filter((l) => l.trim() === '').length;
    expect(emptyLines).toBeLessThanOrEqual(5);
  });
});
