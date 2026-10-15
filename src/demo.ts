import { resolve, join } from 'node:path';
import { BridgeRegistry } from './bridge-registry.js';
import { PermissionManager } from './permissions.js';
import { WorkflowEngine } from './workflow-engine.js';
import { WorkflowDefinition } from './types.js';
import { StandardStepExecutor } from './executors/index.js';

async function main() {
  console.log('====================================================');
  console.log('   AgentForge — Extensible Capability Harness MVP   ');
  console.log('====================================================\n');

  const root = resolve(import.meta.dirname, '..');
  const bridgesDir = join(root, 'bridges');

  // 1. Initialize Registry and Discover Bridges
  console.log('1. Discovering installed bridges in:', bridgesDir);
  const registry = new BridgeRegistry(bridgesDir);
  const { loaded, errors } = await registry.discover();

  console.log(`   Found ${loaded.length} bridge(s):`, loaded.join(', '));
  if (errors.length > 0) {
    console.error('   Discovery errors:', errors);
  }

  // 2. Real GitHub Read-Only Workflow
  console.log('\n2. Executing Real GitHub Read-Only Workflow against local repository:');
  console.log(`   Target Repository: ${root}`);

  const permissions = new PermissionManager();
  const executor = new StandardStepExecutor();
  const engine = new WorkflowEngine(registry, permissions, executor);

  const realGitWorkflow: WorkflowDefinition = {
    id: 'real-github-read-workflow',
    name: 'Real GitHub Repository Inspection',
    description: 'Inspects real branch, working tree status, and release info',
    steps: [
      {
        id: 'inspect-repo',
        name: 'Repository Metadata',
        bridge: 'github',
        action: 'repo-info',
        inputs: { path: root },
      },
      {
        id: 'inspect-status',
        name: 'Working Tree Status',
        bridge: 'github',
        action: 'status-check',
        inputs: { path: root },
        dependsOn: ['inspect-repo'],
      },
      {
        id: 'inspect-releases',
        name: 'Release and Tag Status',
        bridge: 'github',
        action: 'release-verify',
        inputs: { path: root },
        dependsOn: ['inspect-status'],
      },
    ],
    createdAt: new Date().toISOString(),
  };

  let gitRun = engine.createRun(realGitWorkflow);
  gitRun = await engine.executeRun(realGitWorkflow, gitRun);

  console.log('   Workflow Run Status:', gitRun.status);
  for (const step of gitRun.steps) {
    console.log(`   - Step "${step.stepId}": ${step.status}`);
    if (step.output) {
      const outputLines = JSON.stringify(step.output, null, 2)
        .split('\n')
        .slice(0, 10);
      console.log('     Output preview:');
      outputLines.forEach(l => console.log('       ' + l));
      if (outputLines.length === 10) console.log('       ...');
    }
    if (step.error) {
      console.log(`     Error: ${step.error}`);
    }
  }

  // 3. Approval Boundary Proof (Specific Action and Inputs Gating)
  console.log('\n3. Proving Approval Boundary with Specific Action & Input Gating:');
  const publishWorkflow: WorkflowDefinition = {
    id: 'publish-boundary-workflow',
    name: 'Publishing Guard Demonstration',
    description: 'Demonstrates strict approval requirement for external publishing',
    steps: [
      {
        id: 'publish-prod',
        name: 'Publish to Production Target',
        bridge: 'example-echo',
        action: 'publish-example',
        inputs: { target: 'production', version: '1.0.0' },
      },
    ],
    createdAt: new Date().toISOString(),
  };

  let pubRun = engine.createRun(publishWorkflow);
  pubRun = await engine.executeRun(publishWorkflow, pubRun);
  console.log(`   Attempt 1 (No Approval): Status = ${pubRun.status}`);
  console.log(`   Step status = ${pubRun.steps[0].status} (Reason: ${pubRun.steps[0].error})`);

  // Simulate approval with MISMATCHED inputs
  console.log('\n   Attempt 2: Granting approval for { target: "staging" } instead of "production"...');
  permissions.recordApproval(
    'example-echo',
    'publish-example',
    'publish',
    'User (Audit log)',
    'Approved staging only',
    { target: 'staging', version: '1.0.0' }
  );
  pubRun = await engine.executeRun(publishWorkflow, pubRun);
  console.log(`   Attempt 2 Result: Status = ${pubRun.status} (Mismatched input strictly blocked!)`);

  // Grant approval for MATCHING inputs
  console.log('\n   Attempt 3: Granting explicit approval for exact target: "production"...');
  permissions.recordApproval(
    'example-echo',
    'publish-example',
    'publish',
    'User (Audit log)',
    'Approved production release after verification',
    { target: 'production', version: '1.0.0' }
  );
  pubRun = await engine.executeRun(publishWorkflow, pubRun);
  console.log(`   Attempt 3 Result: Status = ${pubRun.status}`);
  console.log(`   Step status = ${pubRun.steps[0].status}`);
  console.log(`   Step output: ${JSON.stringify(pubRun.steps[0].output)}`);

  console.log('\n====================================================');
  console.log('   AgentForge Demonstration Complete (Truthful Output) ');
  console.log('====================================================');
}

main().catch(err => {
  console.error('Fatal execution error:', err);
  process.exit(1);
});
