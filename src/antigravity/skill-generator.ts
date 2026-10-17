import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { BridgeManifest, WorkflowDefinition } from '../types.js';

export interface SkillMetadata {
  name: string;
  description: string;
  content: string;
}

/**
 * Antigravity Skill Generator for AgentForge.
 * Translates AgentForge bridge manifests and multi-step workflows
 * into fully compliant Antigravity SKILL.md documents with frontmatter,
 * schema documentation, and approval guardrails.
 */
export class AntigravitySkillGenerator {
  /**
   * Generate a compliant SKILL.md from an AgentForge BridgeManifest.
   */
  generateSkillFromBridge(manifest: BridgeManifest): SkillMetadata {
    const skillName = `af-${manifest.name.toLowerCase().replace(/[^a-z0-9_-]/g, '-')}`;
    const description = manifest.description || `AgentForge integration bridge for ${manifest.name}`;

    const capsTable = manifest.capabilities.map(c => {
      const inputs = c.inputs?.map(i => `\`${i.name}\` (${i.type}${i.required ? ', required' : ''})`).join(', ') || 'none';
      return `| \`${c.action}\` | \`${c.permissionLevel}\` | ${c.description} | ${inputs} |`;
    }).join('\n');

    const authSection = manifest.auth && manifest.auth.length > 0
      ? manifest.auth.map(a => `- **${a.name}** (\`${a.type}\`): ${a.description}${a.envVar ? ` (env: \`${a.envVar}\`)` : ''}`).join('\n')
      : 'No external authentication credentials required for local operations.';

    const permissionsSection = manifest.permissions && manifest.permissions.length > 0
      ? manifest.permissions.map(p => `- Actions matching \`${p.actions}\`: **${p.level}** (Requires Approval: ${p.requiresApproval ? 'YES - ' + (p.approvalReason || 'Human confirmation required') : 'NO'})`).join('\n')
      : '- Read & local-write operations proceed automatically; external-write, publish, and destructive actions require explicit approval.';

    const content = `---
name: ${skillName}
description: ${description.replace(/"/g, '\\"')}
---

# ${manifest.displayName || manifest.name} Integration for Antigravity

This skill equips Antigravity with local, deterministic capabilities provided by the AgentForge **${manifest.name}** bridge (version ${manifest.version}).

## Capabilities

| Action | Level | Description | Inputs |
| :--- | :--- | :--- | :--- |
${capsTable}

## Authentication & Credentials

${authSection}

> [!NOTE]
> All credentials and access tokens are managed locally by AgentForge. Antigravity never handles raw credentials or secrets directly.

## Security & Human-in-the-Loop Guardrails

${permissionsSection}

> [!IMPORTANT]
> In accordance with AgentForge security invariants, publishing, external writes, and destructive actions require explicit operator confirmation before execution.

## Usage in Antigravity

Antigravity can invoke this capability via the AgentForge tool integration:

\`\`\`typescript
// Example: Invoking ${manifest.name} action
const result = await agentforge.executeBridgeAction('${manifest.name}', '${manifest.capabilities[0]?.action || 'action'}', {
  // Action inputs here
});
\`\`\`
`;

    return {
      name: skillName,
      description,
      content,
    };
  }

  /**
   * Generate a compliant SKILL.md from an AgentForge WorkflowDefinition.
   */
  generateSkillFromWorkflow(workflow: WorkflowDefinition): SkillMetadata {
    const skillName = `workflow-${workflow.id.toLowerCase().replace(/[^a-z0-9_-]/g, '-')}`;
    const description = workflow.description || `AgentForge automated workflow: ${workflow.name}`;

    const stepsList = workflow.steps.map((s, idx) => {
      const deps = s.dependsOn && s.dependsOn.length > 0 ? ` (depends on: ${s.dependsOn.join(', ')})` : '';
      return `${idx + 1}. **${s.name || s.id}** [\`${s.bridge} -> ${s.action}\`]${deps}`;
    }).join('\n');

    const content = `---
name: ${skillName}
description: ${description.replace(/"/g, '\\"')}
---

# Workflow: ${workflow.name}

Automated multi-step workflow orchestrated by AgentForge for Antigravity.

## Workflow Structure

${stepsList}

## Execution Policy

- **Total Steps:** ${workflow.steps.length}
- **Approval Checkpoints:** Step actions classified as \`external-write\`, \`publish\`, or \`destructive\` will automatically pause for operator confirmation.
- **Compensation & Recovery:** Ambiguous network errors or unexpected disconnections transition into non-idempotent reconciliation state to prevent duplicate remote side effects.

## Usage in Antigravity

\`\`\`typescript
const run = await agentforge.startWorkflow('${workflow.id}', {
  // Initial parameters
});
\`\`\`
`;

    return {
      name: skillName,
      description,
      content,
    };
  }

  /**
   * Save generated SKILL.md to a target directory.
   */
  async saveSkillToDisk(targetDirectory: string, skill: SkillMetadata): Promise<string> {
    await mkdir(targetDirectory, { recursive: true });
    const targetFile = join(targetDirectory, 'SKILL.md');
    await writeFile(targetFile, skill.content, 'utf-8');
    return targetFile;
  }
}
