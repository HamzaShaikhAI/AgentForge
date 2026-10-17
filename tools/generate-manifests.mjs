import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const BRIDGES_DIR = join(ROOT, 'bridges');

const MANIFESTS = [
  {
    schema: '1.0',
    name: 'filesystem',
    displayName: 'Local Filesystem',
    description: 'Secure, local-first file and directory operations with path containment.',
    version: '1.0.0',
    category: 'productivity',
    capabilities: [
      { action: 'read-file', description: 'Read full content of a file from disk', permissionLevel: 'read', sideEffects: false },
      { action: 'write-file', description: 'Write or overwrite content to a file', permissionLevel: 'local-write', sideEffects: true },
      { action: 'list-dir', description: 'List files and directories in path', permissionLevel: 'read', sideEffects: false },
      { action: 'stat-file', description: 'Inspect size and modification timestamps', permissionLevel: 'read', sideEffects: false },
      { action: 'delete-file', description: 'Delete file from disk', permissionLevel: 'destructive', sideEffects: true }
    ],
    integrations: [],
    auth: [],
    permissions: [
      { actions: 'read-file|list-dir|stat-file', level: 'read', requiresApproval: false },
      { actions: 'write-file', level: 'local-write', requiresApproval: false },
      { actions: 'delete-file', level: 'destructive', requiresApproval: true, approvalReason: 'Permanently deletes file from filesystem' }
    ]
  },
  {
    schema: '1.0',
    name: 'sqlite',
    displayName: 'SQLite Database',
    description: 'Local SQLite database query execution and table inspection.',
    version: '1.0.0',
    category: 'development',
    capabilities: [
      { action: 'read-query', description: 'Execute read-only SQL query', permissionLevel: 'read', sideEffects: false },
      { action: 'write-query', description: 'Execute INSERT, UPDATE, or DELETE SQL statement', permissionLevel: 'local-write', sideEffects: true },
      { action: 'list-tables', description: 'List user tables in database', permissionLevel: 'read', sideEffects: false },
      { action: 'schema-inspect', description: 'Inspect table columns and constraints', permissionLevel: 'read', sideEffects: false }
    ],
    integrations: [],
    auth: [],
    permissions: [
      { actions: 'read-query|list-tables|schema-inspect', level: 'read', requiresApproval: false },
      { actions: 'write-query', level: 'local-write', requiresApproval: false }
    ]
  },
  {
    schema: '1.0',
    name: 'http',
    displayName: 'HTTP & REST Client',
    category: 'development',
    description: 'Outbound HTTP client with SSRF loopback protections.',
    version: '1.0.0',
    category: 'development',
    capabilities: [
      { action: 'get', description: 'HTTP GET request', permissionLevel: 'read', sideEffects: false },
      { action: 'post', description: 'HTTP POST request', permissionLevel: 'external-write', sideEffects: true },
      { action: 'put', description: 'HTTP PUT request', permissionLevel: 'external-write', sideEffects: true },
      { action: 'delete', description: 'HTTP DELETE request', permissionLevel: 'destructive', sideEffects: true }
    ],
    integrations: [],
    auth: [],
    permissions: [
      { actions: 'get', level: 'read', requiresApproval: false },
      { actions: 'post|put', level: 'external-write', requiresApproval: true, approvalReason: 'Dispatches outbound HTTP payload to remote endpoint' },
      { actions: 'delete', level: 'destructive', requiresApproval: true, approvalReason: 'Sends HTTP DELETE request to remote resource' }
    ]
  },
  {
    schema: '1.0',
    name: 'docker',
    displayName: 'Docker Engine',
    description: 'Manage and inspect local Docker containers and logs.',
    version: '1.0.0',
    category: 'development',
    capabilities: [
      { action: 'list-containers', description: 'List running and stopped containers', permissionLevel: 'read', sideEffects: false },
      { action: 'container-logs', description: 'Retrieve container stdout/stderr logs', permissionLevel: 'read', sideEffects: false },
      { action: 'restart-container', description: 'Restart a container by ID', permissionLevel: 'destructive', sideEffects: true }
    ],
    integrations: [],
    auth: [],
    permissions: [
      { actions: 'list-containers|container-logs', level: 'read', requiresApproval: false },
      { actions: 'restart-container', level: 'destructive', requiresApproval: true, approvalReason: 'Restarts container process' }
    ]
  },
  {
    schema: '1.0',
    name: 'github-api',
    displayName: 'GitHub REST API',
    description: 'GitHub issues, pull requests, and repository releases.',
    version: '1.0.0',
    category: 'source-control',
    capabilities: [
      { action: 'get-issue', description: 'Get details of an issue by repository and number', permissionLevel: 'read', sideEffects: false },
      { action: 'create-issue', description: 'Open a new issue in repository', permissionLevel: 'external-write', sideEffects: true },
      { action: 'list-pull-requests', description: 'List open pull requests in repository', permissionLevel: 'read', sideEffects: false },
      { action: 'create-pull-request', description: 'Open a new pull request', permissionLevel: 'publish', sideEffects: true }
    ],
    integrations: [],
    auth: [],
    permissions: [
      { actions: 'get-issue|list-pull-requests', level: 'read', requiresApproval: false },
      { actions: 'create-issue', level: 'external-write', requiresApproval: true, approvalReason: 'Creates public issue on GitHub' },
      { actions: 'create-pull-request', level: 'publish', requiresApproval: true, approvalReason: 'Opens pull request on GitHub repository' }
    ]
  },
  {
    schema: '1.0',
    name: 'gitlab',
    displayName: 'GitLab API',
    description: 'GitLab project inspection and merge requests.',
    version: '1.0.0',
    category: 'source-control',
    capabilities: [
      { action: 'get-project', description: 'Get project metadata', permissionLevel: 'read', sideEffects: false },
      { action: 'list-merge-requests', description: 'List merge requests', permissionLevel: 'read', sideEffects: false },
      { action: 'create-merge-request', description: 'Create a new merge request', permissionLevel: 'publish', sideEffects: true }
    ],
    integrations: [],
    auth: [],
    permissions: [
      { actions: 'get-project|list-merge-requests', level: 'read', requiresApproval: false },
      { actions: 'create-merge-request', level: 'publish', requiresApproval: true, approvalReason: 'Creates merge request on GitLab' }
    ]
  },
  {
    schema: '1.0',
    name: 'jira',
    displayName: 'Atlassian Jira',
    description: 'Agile issue queries and workflow transitions.',
    version: '1.0.0',
    category: 'productivity',
    capabilities: [
      { action: 'search-issues', description: 'Search issues using JQL query', permissionLevel: 'read', sideEffects: false },
      { action: 'get-issue', description: 'Inspect issue details by key', permissionLevel: 'read', sideEffects: false },
      { action: 'transition-issue', description: 'Transition issue status', permissionLevel: 'external-write', sideEffects: true }
    ],
    integrations: [],
    auth: [],
    permissions: [
      { actions: 'search-issues|get-issue', level: 'read', requiresApproval: false },
      { actions: 'transition-issue', level: 'external-write', requiresApproval: true, approvalReason: 'Modifies Jira issue status in team project' }
    ]
  },
  {
    schema: '1.0',
    name: 'linear',
    displayName: 'Linear',
    description: 'Linear issue tracking and project management.',
    version: '1.0.0',
    category: 'productivity',
    capabilities: [
      { action: 'search-issues', description: 'Search Linear issues', permissionLevel: 'read', sideEffects: false },
      { action: 'create-issue', description: 'Create an engineering issue', permissionLevel: 'external-write', sideEffects: true }
    ],
    integrations: [],
    auth: [],
    permissions: [
      { actions: 'search-issues', level: 'read', requiresApproval: false },
      { actions: 'create-issue', level: 'external-write', requiresApproval: true, approvalReason: 'Creates engineering issue in Linear' }
    ]
  },
  {
    schema: '1.0',
    name: 'sentry',
    displayName: 'Sentry Error Reporting',
    description: 'Runtime crash reports, stack traces, and issue analytics.',
    version: '1.0.0',
    category: 'development',
    capabilities: [
      { action: 'list-issues', description: 'List unresolved crashes', permissionLevel: 'read', sideEffects: false },
      { action: 'get-issue-details', description: 'Inspect crash details and stack trace', permissionLevel: 'read', sideEffects: false }
    ],
    integrations: [],
    auth: [],
    permissions: [
      { actions: 'list-issues|get-issue-details', level: 'read', requiresApproval: false }
    ]
  },
  {
    schema: '1.0',
    name: 'aws-s3',
    displayName: 'AWS S3 Storage',
    description: 'Amazon S3 bucket and object storage management.',
    version: '1.0.0',
    category: 'cloud-services',
    capabilities: [
      { action: 'list-buckets', description: 'List S3 buckets', permissionLevel: 'read', sideEffects: false },
      { action: 'list-objects', description: 'List object keys in bucket', permissionLevel: 'read', sideEffects: false },
      { action: 'get-object-meta', description: 'Retrieve object metadata', permissionLevel: 'read', sideEffects: false }
    ],
    integrations: [],
    auth: [],
    permissions: [
      { actions: 'list-buckets|list-objects|get-object-meta', level: 'read', requiresApproval: false }
    ]
  },
  {
    schema: '1.0',
    name: 'cloudflare',
    displayName: 'Cloudflare',
    description: 'Cloudflare DNS zones and Workers inspection.',
    version: '1.0.0',
    category: 'cloud-services',
    capabilities: [
      { action: 'list-zones', description: 'List domain zones', permissionLevel: 'read', sideEffects: false },
      { action: 'get-dns-records', description: 'List DNS records for zone', permissionLevel: 'read', sideEffects: false },
      { action: 'list-workers', description: 'List deployed Cloudflare Workers', permissionLevel: 'read', sideEffects: false }
    ],
    integrations: [],
    auth: [],
    permissions: [
      { actions: 'list-zones|get-dns-records|list-workers', level: 'read', requiresApproval: false }
    ]
  },
  {
    schema: '1.0',
    name: 'postgres',
    displayName: 'PostgreSQL',
    description: 'PostgreSQL database query execution and table inspection.',
    version: '1.0.0',
    category: 'cloud-services',
    capabilities: [
      { action: 'execute-query', description: 'Run SQL query on database', permissionLevel: 'read', sideEffects: false },
      { action: 'list-tables', description: 'List tables in current schema', permissionLevel: 'read', sideEffects: false }
    ],
    integrations: [],
    auth: [],
    permissions: [
      { actions: 'execute-query|list-tables', level: 'read', requiresApproval: false }
    ]
  },
  {
    schema: '1.0',
    name: 'redis',
    displayName: 'Redis Cache',
    description: 'Redis in-memory key-value cache client.',
    version: '1.0.0',
    category: 'cloud-services',
    capabilities: [
      { action: 'get-key', description: 'Read value of key', permissionLevel: 'read', sideEffects: false },
      { action: 'set-key', description: 'Set key with value', permissionLevel: 'local-write', sideEffects: true },
      { action: 'delete-key', description: 'Delete key from Redis', permissionLevel: 'destructive', sideEffects: true }
    ],
    integrations: [],
    auth: [],
    permissions: [
      { actions: 'get-key', level: 'read', requiresApproval: false },
      { actions: 'set-key', level: 'local-write', requiresApproval: false },
      { actions: 'delete-key', level: 'destructive', requiresApproval: true, approvalReason: 'Deletes key from Redis datastore' }
    ]
  },
  {
    schema: '1.0',
    name: 'mongodb',
    displayName: 'MongoDB',
    category: 'cloud-services',
    description: 'Document database queries and insertions.',
    version: '1.0.0',
    capabilities: [
      { action: 'find-documents', description: 'Query documents in collection', permissionLevel: 'read', sideEffects: false },
      { action: 'count-documents', description: 'Count documents matching filter', permissionLevel: 'read', sideEffects: false },
      { action: 'insert-document', description: 'Insert document into collection', permissionLevel: 'local-write', sideEffects: true }
    ],
    integrations: [],
    auth: [],
    permissions: [
      { actions: 'find-documents|count-documents', level: 'read', requiresApproval: false },
      { actions: 'insert-document', level: 'local-write', requiresApproval: false }
    ]
  },
  {
    schema: '1.0',
    name: 'slack',
    displayName: 'Slack',
    category: 'communication',
    description: 'Slack channel communication and webhook dispatches.',
    version: '1.0.0',
    capabilities: [
      { action: 'list-channels', description: 'List public channels in workspace', permissionLevel: 'read', sideEffects: false },
      { action: 'post-message', description: 'Send message to a channel', permissionLevel: 'external-write', sideEffects: true },
      { action: 'post-webhook', description: 'Post payload to Slack webhook', permissionLevel: 'external-write', sideEffects: true }
    ],
    integrations: [],
    auth: [],
    permissions: [
      { actions: 'list-channels', level: 'read', requiresApproval: false },
      { actions: 'post-message|post-webhook', level: 'external-write', requiresApproval: true, approvalReason: 'Broadcasts message to Slack channel' }
    ]
  },
  {
    schema: '1.0',
    name: 'discord',
    displayName: 'Discord',
    category: 'communication',
    description: 'Discord channel messaging and webhook notifications.',
    version: '1.0.0',
    capabilities: [
      { action: 'read-messages', description: 'Read messages in channel', permissionLevel: 'read', sideEffects: false },
      { action: 'post-message', description: 'Send message to channel via bot', permissionLevel: 'external-write', sideEffects: true },
      { action: 'send-webhook', description: 'Post payload to webhook', permissionLevel: 'external-write', sideEffects: true }
    ],
    integrations: [],
    auth: [],
    permissions: [
      { actions: 'read-messages', level: 'read', requiresApproval: false },
      { actions: 'post-message|send-webhook', level: 'external-write', requiresApproval: true, approvalReason: 'Broadcasts message to Discord channel' }
    ]
  },
  {
    schema: '1.0',
    name: 'notion',
    displayName: 'Notion',
    category: 'productivity',
    description: 'Notion workspace pages and database queries.',
    version: '1.0.0',
    capabilities: [
      { action: 'query-database', description: 'Query records in database', permissionLevel: 'read', sideEffects: false },
      { action: 'get-page', description: 'Retrieve properties and metadata of a page', permissionLevel: 'read', sideEffects: false },
      { action: 'create-page', description: 'Create a new Notion page', permissionLevel: 'external-write', sideEffects: true }
    ],
    integrations: [],
    auth: [],
    permissions: [
      { actions: 'query-database|get-page', level: 'read', requiresApproval: false },
      { actions: 'create-page', level: 'external-write', requiresApproval: true, approvalReason: 'Creates page in Notion workspace' }
    ]
  },
  {
    schema: '1.0',
    name: 'sendgrid',
    displayName: 'SendGrid Email',
    category: 'communication',
    description: 'Send transactional emails and inspect delivery analytics.',
    version: '1.0.0',
    capabilities: [
      { action: 'send-email', description: 'Send transactional email to recipient', permissionLevel: 'external-write', sideEffects: true },
      { action: 'get-stats', description: 'Inspect delivery and bounce metrics', permissionLevel: 'read', sideEffects: false }
    ],
    integrations: [],
    auth: [],
    permissions: [
      { actions: 'get-stats', level: 'read', requiresApproval: false },
      { actions: 'send-email', level: 'external-write', requiresApproval: true, approvalReason: 'Dispatches real email to recipient' }
    ]
  },
  {
    schema: '1.0',
    name: 'twilio',
    displayName: 'Twilio SMS',
    category: 'communication',
    description: 'Send SMS messages and check delivery status.',
    version: '1.0.0',
    capabilities: [
      { action: 'send-sms', description: 'Send SMS to phone number', permissionLevel: 'external-write', sideEffects: true },
      { action: 'get-message-status', description: 'Inspect SMS delivery receipt', permissionLevel: 'read', sideEffects: false }
    ],
    integrations: [],
    auth: [],
    permissions: [
      { actions: 'get-message-status', level: 'read', requiresApproval: false },
      { actions: 'send-sms', level: 'external-write', requiresApproval: true, approvalReason: 'Sends real SMS message via carrier network' }
    ]
  },
  {
    schema: '1.0',
    name: 'brave-search',
    displayName: 'Brave Search',
    category: 'productivity',
    description: 'Privacy-preserving web search and local business queries.',
    version: '1.0.0',
    capabilities: [
      { action: 'web-search', description: 'Search web indexed pages', permissionLevel: 'read', sideEffects: false },
      { action: 'local-search', description: 'Search local businesses and locations', permissionLevel: 'read', sideEffects: false }
    ],
    integrations: [],
    auth: [],
    permissions: [
      { actions: 'web-search|local-search', level: 'read', requiresApproval: false }
    ]
  },
  {
    schema: '1.0',
    name: 'tavily',
    displayName: 'Tavily Research',
    category: 'productivity',
    description: 'AI-optimized factual research search with citations.',
    version: '1.0.0',
    capabilities: [
      { action: 'search', description: 'Execute factual research query returning summaries and sources', permissionLevel: 'read', sideEffects: false },
      { action: 'extract', description: 'Extract clean markdown content from specific web URLs', permissionLevel: 'read', sideEffects: false }
    ],
    integrations: [],
    auth: [],
    permissions: [
      { actions: 'search|extract', level: 'read', requiresApproval: false }
    ]
  },
  {
    schema: '1.0',
    name: 'memory',
    displayName: 'Knowledge Graph Memory',
    category: 'productivity',
    description: 'Local graph memory store for persistent entities, attributes, and relationships.',
    version: '1.0.0',
    capabilities: [
      { action: 'add-entity', description: 'Create or update an entity in knowledge graph', permissionLevel: 'local-write', sideEffects: true },
      { action: 'query-graph', description: 'Retrieve all knowledge graph entities and relations', permissionLevel: 'read', sideEffects: false },
      { action: 'search-nodes', description: 'Search graph entities matching query', permissionLevel: 'read', sideEffects: false }
    ],
    integrations: [],
    auth: [],
    permissions: [
      { actions: 'query-graph|search-nodes', level: 'read', requiresApproval: false },
      { actions: 'add-entity', level: 'local-write', requiresApproval: false }
    ]
  },
  {
    schema: '1.0',
    name: 'stripe',
    displayName: 'Stripe Payments',
    category: 'cloud-services',
    description: 'Stripe billing, customer query, and invoice management.',
    version: '1.0.0',
    capabilities: [
      { action: 'get-customer', description: 'Retrieve customer account details by ID', permissionLevel: 'read', sideEffects: false },
      { action: 'list-invoices', description: 'List recent customer invoices and statuses', permissionLevel: 'read', sideEffects: false },
      { action: 'get-balance', description: 'Inspect available account balance and currency', permissionLevel: 'read', sideEffects: false }
    ],
    integrations: [],
    auth: [],
    permissions: [
      { actions: 'get-customer|list-invoices|get-balance', level: 'read', requiresApproval: false }
    ]
  }
];

let createdCount = 0;
for (const manifest of MANIFESTS) {
  const dir = join(BRIDGES_DIR, manifest.name);
  mkdirSync(dir, { recursive: true });
  const manifestPath = join(dir, 'bridge.json');
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
  createdCount++;
}

console.log(`Successfully generated ${createdCount} native bridge manifests in ${BRIDGES_DIR}`);
