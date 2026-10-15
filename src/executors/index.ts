import { StepExecutor } from '../workflow-engine.js';
import { WorkflowStep } from '../types.js';
import { GitExecutor } from './git-executor.js';

export * from './git-executor.js';

/**
 * Standard router for executing workflow steps across available bridges.
 */
export class StandardStepExecutor implements StepExecutor {
  constructor(private gitExecutor: GitExecutor = new GitExecutor()) {}

  async execute(step: WorkflowStep, inputs: Record<string, unknown>): Promise<unknown> {
    if (step.bridge === 'github') {
      return this.gitExecutor.execute(step.action, inputs);
    }

    if (step.bridge === 'example-echo') {
      if (step.action === 'echo') {
        return {
          echoed: inputs.message,
          timestamp: new Date().toISOString(),
        };
      }
      if (step.action === 'write-file') {
        return {
          path: inputs.path,
          bytesWritten: typeof inputs.content === 'string' ? inputs.content.length : 0,
          timestamp: new Date().toISOString(),
        };
      }
      if (step.action === 'publish-example') {
        return {
          target: inputs.target,
          published: true,
          timestamp: new Date().toISOString(),
        };
      }
    }

    throw new Error(`No executor implemented for bridge "${step.bridge}"`);
  }
}
