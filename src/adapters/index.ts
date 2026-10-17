import { BaseIntegrationAdapter } from './base-adapter.js';
import { FilesystemAdapter } from './filesystem-adapter.js';
import { SqliteAdapter } from './sqlite-adapter.js';
import { HttpAdapter } from './http-adapter.js';
import { GitAdapter } from './git-adapter.js';
import { YouTubeAdapter } from './youtube-adapter.js';
import {
  DockerAdapter,
  GitHubApiAdapter,
  GitLabAdapter,
  JiraAdapter,
  LinearAdapter,
  SentryAdapter,
} from './developer-adapters.js';
import {
  AwsS3Adapter,
  CloudflareAdapter,
  PostgresAdapter,
  RedisAdapter,
  MongoDbAdapter,
} from './cloud-adapters.js';
import {
  SlackAdapter,
  DiscordAdapter,
  NotionAdapter,
  SendGridAdapter,
  TwilioAdapter,
} from './communication-adapters.js';
import {
  BraveSearchAdapter,
  TavilyAdapter,
  MemoryAdapter,
  StripeAdapter,
} from './service-adapters.js';
import type { StandardStepExecutor } from '../executors/index.js';

export * from './base-adapter.js';
export * from './filesystem-adapter.js';
export * from './sqlite-adapter.js';
export * from './http-adapter.js';
export * from './git-adapter.js';
export * from './youtube-adapter.js';
export * from './developer-adapters.js';
export * from './cloud-adapters.js';
export * from './communication-adapters.js';
export * from './service-adapters.js';

/**
 * Instantiate all 25 native AgentForge integration adapters.
 */
export function createBuiltinAdapters(): BaseIntegrationAdapter[] {
  return [
    new FilesystemAdapter(),
    new SqliteAdapter(),
    new HttpAdapter(),
    new GitAdapter(),
    new YouTubeAdapter(),
    new DockerAdapter(),
    new GitHubApiAdapter(),
    new GitLabAdapter(),
    new JiraAdapter(),
    new LinearAdapter(),
    new SentryAdapter(),
    new AwsS3Adapter(),
    new CloudflareAdapter(),
    new PostgresAdapter(),
    new RedisAdapter(),
    new MongoDbAdapter(),
    new SlackAdapter(),
    new DiscordAdapter(),
    new NotionAdapter(),
    new SendGridAdapter(),
    new TwilioAdapter(),
    new BraveSearchAdapter(),
    new TavilyAdapter(),
    new MemoryAdapter(),
    new StripeAdapter(),
  ];
}

/**
 * Register all native adapters with a StandardStepExecutor.
 */
export function registerAdaptersWithExecutor(
  executor: StandardStepExecutor,
  adapters: BaseIntegrationAdapter[] = createBuiltinAdapters(),
): void {
  for (const adapter of adapters) {
    // Only register if not already registered and not github/youtube (handled internally or by custom adapter)
    executor.registerCustomExecutor(adapter.name, {
      execute: (action, inputs) => adapter.execute(action, inputs),
    });
  }
}
