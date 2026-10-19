import { expect, it, vi } from 'vitest';
import { getReferenceWorkflowRun } from '../workflow-monitoring.js';
import { getLatestWorkflowRun } from './data-fetchers.js';

vi.mock('../workflow-monitoring.js', () => ({ getReferenceWorkflowRun: vi.fn(() => null) }));

it('looks up the discovered workflow for repositories without an explicit CI override', () => {
  getLatestWorkflowRun('owner/custom-build-project', 'main', 'compile-and-test.yml');
  expect(getReferenceWorkflowRun).toHaveBeenCalledWith('owner/custom-build-project', 'compile-and-test.yml', 'main');
});
