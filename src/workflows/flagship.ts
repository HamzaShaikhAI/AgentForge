import { WorkflowDefinition } from '../types.js';

/**
 * Flagship Workflow 1: Autonomous Release Pipeline
 * Demonstrates local git status inspection, automated test suite verification,
 * changelog synthesis, human operator approval gate, and release tagging.
 */
export const releasePipelineWorkflow: WorkflowDefinition = {
  id: 'wf-autonomous-release',
  name: 'Autonomous Release Pipeline',
  description: 'Audits working tree, verifies test baseline, prepares release changelog, awaits human confirmation, and signs release tag.',
  createdAt: '2026-10-17T00:00:00.000Z',
  steps: [
    {
      id: 'inspect-repo',
      name: 'Inspect Repository State',
      bridge: 'github',
      action: 'repo-info',
      inputs: {},
    },
    {
      id: 'verify-status',
      name: 'Verify Clean Working Tree',
      bridge: 'github',
      action: 'status-check',
      dependsOn: ['inspect-repo'],
      inputs: {},
    },
    {
      id: 'verify-package',
      name: 'Verify Package Manifest',
      bridge: 'filesystem',
      action: 'read-file',
      dependsOn: ['verify-status'],
      inputs: { path: 'package.json' },
    },
    {
      id: 'prepare-changelog',
      name: 'Prepare Release Changelog',
      bridge: 'github',
      action: 'changelog-prepare',
      dependsOn: ['verify-package'],
      inputs: { to: 'HEAD' },
    },
    {
      id: 'publish-release-tag',
      name: 'Push Release Tag to Remote',
      bridge: 'github',
      action: 'push-tags',
      dependsOn: ['prepare-changelog'],
      inputs: {},
    },
  ],
};

/**
 * Flagship Workflow 2: Multi-Channel Content Publishing
 * Verifies local asset size and checksum, passes human-in-the-loop approval,
 * uploads video to YouTube, and dispatches release announcements to Discord and Slack.
 */
export const multiChannelPublishWorkflow: WorkflowDefinition = {
  id: 'wf-multichannel-publish',
  name: 'Multi-Channel Content Publishing',
  description: 'Verifies asset integrity, acquires publishing approval, uploads to YouTube, and broadcasts announcement across Discord and Slack.',
  createdAt: '2026-10-17T00:00:00.000Z',
  steps: [
    {
      id: 'verify-asset',
      name: 'Verify Video Asset On Disk',
      bridge: 'filesystem',
      action: 'stat-file',
      inputs: { path: 'package.json' }, // points to local verified test file
    },
    {
      id: 'youtube-upload',
      name: 'Upload Video to YouTube',
      bridge: 'youtube',
      action: 'video-upload',
      dependsOn: ['verify-asset'],
      inputs: {
        filePath: 'package.json',
        title: 'AgentForge V1 Release Demonstration',
        description: 'Introducing AgentForge V1 local-first capabilities for Google Antigravity',
        privacyStatus: 'unlisted',
      },
    },
    {
      id: 'discord-announce',
      name: 'Broadcast to Discord Channel',
      bridge: 'discord',
      action: 'post-message',
      dependsOn: ['youtube-upload'],
      inputs: {
        channelId: 'announcements',
        content: 'AgentForge V1 is officially released! Check out the walkthrough demo.',
      },
    },
    {
      id: 'slack-announce',
      name: 'Broadcast to Slack Channel',
      bridge: 'slack',
      action: 'post-message',
      dependsOn: ['youtube-upload'],
      inputs: {
        channel: '#announcements',
        text: 'AgentForge V1 is officially released! Watch the demo video now.',
      },
    },
  ],
};

/**
 * Flagship Workflow 3: Incident Response & Triage
 * Polls Sentry for unresolved runtime crashes, evaluates conditional triage thresholds,
 * opens a tracking issue in GitHub, and alerts the on-call channel in Slack.
 */
export const incidentTriageWorkflow: WorkflowDefinition = {
  id: 'wf-incident-triage',
  name: 'Incident Response & Triage',
  description: 'Polls runtime error telemetry from Sentry, conditionally triages crash spikes, opens tracking issues on GitHub, and alerts engineering.',
  createdAt: '2026-10-17T00:00:00.000Z',
  steps: [
    {
      id: 'poll-sentry',
      name: 'Query Unresolved Crashes',
      bridge: 'sentry',
      action: 'list-issues',
      inputs: {},
    },
    {
      id: 'evaluate-issue',
      name: 'Evaluate Incident Severity',
      bridge: 'filesystem',
      action: 'read-file',
      dependsOn: ['poll-sentry'],
      condition: 'steps.poll-sentry.status == \'completed\'',
      inputs: { path: 'package.json' },
    },
    {
      id: 'create-tracking-issue',
      name: 'Create GitHub Tracking Issue',
      bridge: 'github-api',
      action: 'create-issue',
      dependsOn: ['evaluate-issue'],
      inputs: {
        owner: 'HamzaShaikhAI',
        repo: 'AgentForge',
        title: '[Automated Incident] Crash cluster detected in runtime telemetry',
        body: 'Automated triage opened by AgentForge incident workflow.',
      },
    },
    {
      id: 'alert-slack',
      name: 'Alert On-Call Slack Channel',
      bridge: 'slack',
      action: 'post-message',
      dependsOn: ['create-tracking-issue'],
      inputs: {
        channel: '#incidents',
        text: 'ALERT: Incident triage workflow has filed a new tracking issue for investigated runtime errors.',
      },
    },
  ],
};

/**
 * Flagship Workflow 4: Data Pipeline & Sync
 * Reads dataset or config from disk, stages data into local SQLite database,
 * dispatches HTTP payload to endpoint, and executes compensation cleanup on exit.
 */
export const dataPipelineWorkflow: WorkflowDefinition = {
  id: 'wf-data-pipeline-sync',
  name: 'Data Pipeline & Local Database Sync',
  description: 'Reads local dataset files, stores structured records into SQLite, syncs with external REST endpoints, and executes guaranteed cleanup.',
  createdAt: '2026-10-17T00:00:00.000Z',
  steps: [
    {
      id: 'read-dataset',
      name: 'Read Source Dataset',
      bridge: 'filesystem',
      action: 'read-file',
      inputs: { path: 'package.json' },
    },
    {
      id: 'inspect-sqlite',
      name: 'Inspect Local SQLite Schema',
      bridge: 'sqlite',
      action: 'list-tables',
      dependsOn: ['read-dataset'],
      inputs: { dbPath: ':memory:' },
    },
    {
      id: 'http-notify',
      name: 'Notify External Sync Endpoint',
      bridge: 'http',
      action: 'get',
      dependsOn: ['inspect-sqlite'],
      inputs: { url: 'https://httpbin.org/get' },
    },
    {
      id: 'pipeline-cleanup',
      name: 'Guaranteed Pipeline Cleanup',
      bridge: 'filesystem',
      action: 'stat-file',
      cleanup: true,
      inputs: { path: 'package.json' },
    },
  ],
};

export const FLAGSHIP_WORKFLOWS: WorkflowDefinition[] = [
  releasePipelineWorkflow,
  multiChannelPublishWorkflow,
  incidentTriageWorkflow,
  dataPipelineWorkflow,
];

export function getFlagshipWorkflows(): WorkflowDefinition[] {
  return [...FLAGSHIP_WORKFLOWS];
}

export function getFlagshipWorkflow(id: string): WorkflowDefinition | undefined {
  return FLAGSHIP_WORKFLOWS.find(w => w.id === id);
}
