import { BaseIntegrationAdapter } from './base-adapter.js';
import { FilesystemAdapter } from './filesystem-adapter.js';
import { SqliteAdapter } from './sqlite-adapter.js';
import { HttpAdapter } from './http-adapter.js';
import { GitAdapter } from './git-adapter.js';
import { YouTubeAdapter } from './youtube-adapter.js';
import { LinkedInAdapter } from './linkedin.js';
import { XAdapter } from './x.js';
import { NorthwestAdapter } from './northwest.js';
import { WordPressAdapter } from './wordpress.js';
import { HostingerAdapter } from './hostinger.js';
import { GoogleFlowAdapter } from './google-flow.js';
import { HiggsfieldAdapter } from './higgsfield.js';
import { PlaywrightAdapter } from './playwright.js';
import { Context7Adapter } from './context7.js';
import { SupabaseAdapter } from './supabase.js';
import { ExaAdapter } from './exa.js';
import { RedditAdapter } from './reddit.js';
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
export * from './linkedin.js';
export * from './x.js';
export * from './northwest.js';
export * from './wordpress.js';
export * from './cloudflare.js';
export * from './hostinger.js';
export * from './google-flow.js';
export * from './higgsfield.js';
export * from './playwright.js';
export * from './context7.js';
export * from './supabase.js';
export * from './exa.js';
export * from './reddit.js';
export * from './developer-adapters.js';
export * from './cloud-adapters.js';
export * from './communication-adapters.js';
export * from './service-adapters.js';

/**
 * Instantiate all native AgentForge integration adapters.
 */
export function createBuiltinAdapters(): BaseIntegrationAdapter[] {
  return [
    new FilesystemAdapter(),
    new SqliteAdapter(),
    new HttpAdapter(),
    new GitAdapter(),
    new YouTubeAdapter(),
    new LinkedInAdapter(),
    new XAdapter(),
    new NorthwestAdapter(),
    new WordPressAdapter(),
    new DockerAdapter(),
    new GitHubApiAdapter(),
    new GitLabAdapter(),
    new JiraAdapter(),
    new LinearAdapter(),
    new SentryAdapter(),
    new AwsS3Adapter(),
    new CloudflareAdapter(),
    new HostingerAdapter(),
    new GoogleFlowAdapter(),
    new HiggsfieldAdapter(),
    new PlaywrightAdapter(),
    new Context7Adapter(),
    new SupabaseAdapter(),
    new ExaAdapter(),
    new RedditAdapter(),
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
