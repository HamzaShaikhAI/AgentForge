import { resolve, join } from 'node:path';
import { BridgeRegistry } from './bridge-registry.js';
import { PermissionManager } from './permissions.js';
import { WorkflowEngine, StepExecutor } from './workflow-engine.js';
import { WorkflowDefinition, WorkflowStep } from './types.js';

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

  // 2. Inspect GitHub Bridge Definition
  const githubBridge = registry.get('github');
  if (githubBridge) {
    console.log('\n2. Inspecting GitHub Bridge Manifest:');
    console.log(`   Display Name: ${githubBridge.manifest.displayName}`);
    console.log(`   Capabilities: ${githubBridge.manifest.capabilities.length} available actions`);
    console.log('   Integration Requirements:');
    for (const req of githubBridge.manifest.integrations) {
      console.log(`     - ${req.name}: ${req.required ? '[REQUIRED]' : '[OPTIONAL]'} (Check: ${req.check.value})`);
    }
  }

  // 3. Setup Workflow Engine and Permissions
  console.log('\n3. Preparing Sample Multi-Step Workflow...');
  const permissions = new PermissionManager();

  // Mock executor simulating safe local execution
  const executor: StepExecutor = {
    async execute(step: WorkflowStep, inputs: Record<string, unknown>) {
      if (step.action === 'echo') {
        return { echoed: inputs.message, timestamp: new Date().toISOString() };
      }
      if (step.action === 'publish-example') {
        return { publishedTo: inputs.target, success: true, timestamp: new Date().toISOString() };
      }
      throw new Error(`Unhandled action: ${step.action}`);
    },
  };

  const engine = new WorkflowEngine(registry, permissions, executor);

  const sampleWorkflow: WorkflowDefinition = {
    id: 'demo-workflow',
    name: 'Safe Demo Execution Workflow',
    description: 'Demonstrates multi-step dependencies and permission gating',
    steps: [
      {
        id: 'step-1-read',
        name: 'Echo Test Input',
        bridge: 'example-echo',
        action: 'echo',
        inputs: { message: 'AgentForge core harness initialized successfully.' },
      },
      {
        id: 'step-2-publish',
        name: 'Simulated Publish Action',
        bridge: 'example-echo',
        action: 'publish-example',
        inputs: { target: 'staging-registry' },
        dependsOn: ['step-1-read'],
      },
    ],
    createdAt: new Date().toISOString(),
  };

  // 4. Run Workflow (Demonstrate Approval Interception)
  console.log('\n4. Executing Workflow without prior approval (Safety Gate Demonstration):');
  let run = engine.createRun(sampleWorkflow);
  run = await engine.executeRun(sampleWorkflow, run);

  console.log('   Resulting Status:', run.status);
  console.log('   Execution Summary:');
  console.log(engine.summarizeRun(run).split('\n').map(l => '     ' + l).join('\n'));

  // 5. Grant Explicit Approval and Resume
  console.log('\n5. Simulating Explicit User Approval for Step 2 (publish-example)...');
  permissions.recordApproval(
    'example-echo',
    'publish-example',
    'publish',
    'User (Confirmed via Antigravity)',
    'User authorized simulated staging release'
  );

  console.log('   Re-executing workflow with granted approval:');
  run = await engine.executeRun(sampleWorkflow, run);
  console.log('   Resulting Status:', run.status);
  console.log('   Execution Summary:');
  console.log(engine.summarizeRun(run).split('\n').map(l => '     ' + l).join('\n'));

  console.log('\n====================================================');
  console.log('   AgentForge Demonstration Complete (Truthful Output) ');
  console.log('====================================================');
}

main().catch(err => {
  console.error('Fatal execution error:', err);
  process.exit(1);
});
