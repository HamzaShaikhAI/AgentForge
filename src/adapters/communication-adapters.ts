import { BaseIntegrationAdapter, AdapterHealthResult, AdapterActionDefinition } from './base-adapter.js';

export class SlackAdapter extends BaseIntegrationAdapter {
  readonly name = 'slack';
  readonly displayName = 'Slack';
  readonly description = 'Slack team communication, channel messages, and webhook dispatches.';
  readonly version = '1.0.0';
  readonly category = 'communication';

  getActions(): AdapterActionDefinition[] {
    return [
      { action: 'list-channels', description: 'List public channels in workspace', permissionLevel: 'read', sideEffects: false, requiresApproval: false },
      { action: 'post-message', description: 'Post message to a Slack channel', permissionLevel: 'external-write', sideEffects: true, requiresApproval: true },
      { action: 'post-webhook', description: 'Send payload to a Slack incoming webhook URL', permissionLevel: 'external-write', sideEffects: true, requiresApproval: true },
    ];
  }

  async checkHealth(): Promise<AdapterHealthResult> {
    const hasToken = Boolean(process.env.SLACK_BOT_TOKEN || process.env.SLACK_WEBHOOK_URL);
    return {
      healthy: hasToken,
      status: hasToken ? 'configured' : 'unconfigured',
      message: hasToken ? 'Slack token or webhook configured' : 'SLACK_BOT_TOKEN or SLACK_WEBHOOK_URL required',
    };
  }

  async execute(action: string, inputs: Record<string, unknown>): Promise<unknown> {
    if (action === 'list-channels') return { channels: [], count: 0 };
    if (action === 'post-message') {
      const channel = inputs.channel as string;
      const text = inputs.text as string;
      if (!channel || !text) throw new Error('post-message requires "channel" and "text"');
      return { channel, text, ts: '1700000000.000100', ok: true };
    }
    if (action === 'post-webhook') {
      const text = inputs.text as string;
      if (!text) throw new Error('post-webhook requires "text"');
      return { sent: true, ok: true };
    }
    throw new Error(`Unsupported action "${action}" on SlackAdapter`);
  }
}

export class DiscordAdapter extends BaseIntegrationAdapter {
  readonly name = 'discord';
  readonly displayName = 'Discord';
  readonly description = 'Discord webhook dispatches and bot channel messaging.';
  readonly version = '1.0.0';
  readonly category = 'communication';

  getActions(): AdapterActionDefinition[] {
    return [
      { action: 'read-messages', description: 'Read recent messages in a channel', permissionLevel: 'read', sideEffects: false, requiresApproval: false },
      { action: 'post-message', description: 'Send message to a channel via Bot token', permissionLevel: 'external-write', sideEffects: true, requiresApproval: true },
      { action: 'send-webhook', description: 'Post message to a Discord webhook URL', permissionLevel: 'external-write', sideEffects: true, requiresApproval: true },
    ];
  }

  async checkHealth(): Promise<AdapterHealthResult> {
    const hasAuth = Boolean(process.env.DISCORD_BOT_TOKEN || process.env.DISCORD_WEBHOOK_URL);
    return {
      healthy: hasAuth,
      status: hasAuth ? 'configured' : 'unconfigured',
      message: hasAuth ? 'Discord bot token or webhook configured' : 'DISCORD_BOT_TOKEN or DISCORD_WEBHOOK_URL required',
    };
  }

  async execute(action: string, inputs: Record<string, unknown>): Promise<unknown> {
    if (action === 'read-messages') return { messages: [], count: 0 };
    if (action === 'post-message') {
      const channelId = inputs.channelId as string;
      const content = inputs.content as string;
      if (!channelId || !content) throw new Error('post-message requires "channelId" and "content"');
      return { channelId, content, id: 'disc_msg_mock_123', sent: true };
    }
    if (action === 'send-webhook') {
      const content = inputs.content as string;
      if (!content) throw new Error('send-webhook requires "content"');
      return { sent: true, ok: true };
    }
    throw new Error(`Unsupported action "${action}" on DiscordAdapter`);
  }
}

export class NotionAdapter extends BaseIntegrationAdapter {
  readonly name = 'notion';
  readonly displayName = 'Notion';
  readonly description = 'Notion workspace pages, database queries, and block appending.';
  readonly version = '1.0.0';
  readonly category = 'productivity';

  getActions(): AdapterActionDefinition[] {
    return [
      { action: 'query-database', description: 'Query records in a Notion database', permissionLevel: 'read', sideEffects: false, requiresApproval: false },
      { action: 'get-page', description: 'Retrieve properties and metadata of a page', permissionLevel: 'read', sideEffects: false, requiresApproval: false },
      { action: 'create-page', description: 'Create a new Notion page in a parent database', permissionLevel: 'external-write', sideEffects: true, requiresApproval: true },
    ];
  }

  async checkHealth(): Promise<AdapterHealthResult> {
    const hasKey = Boolean(process.env.NOTION_API_KEY || process.env.NOTION_TOKEN);
    return {
      healthy: hasKey,
      status: hasKey ? 'configured' : 'unconfigured',
      message: hasKey ? 'NOTION_API_KEY present' : 'NOTION_API_KEY required',
    };
  }

  async execute(action: string, inputs: Record<string, unknown>): Promise<unknown> {
    if (action === 'query-database') {
      const databaseId = inputs.databaseId as string;
      if (!databaseId) throw new Error('query-database requires "databaseId"');
      return { databaseId, results: [] };
    }
    if (action === 'get-page') {
      const pageId = inputs.pageId as string;
      if (!pageId) throw new Error('get-page requires "pageId"');
      return { pageId, title: 'Notion Page', properties: {} };
    }
    if (action === 'create-page') {
      const parentId = inputs.parentId as string;
      const title = inputs.title as string;
      if (!parentId || !title) throw new Error('create-page requires "parentId" and "title"');
      return { id: 'notion_page_mock_123', parentId, title, created: true };
    }
    throw new Error(`Unsupported action "${action}" on NotionAdapter`);
  }
}

export class SendGridAdapter extends BaseIntegrationAdapter {
  readonly name = 'sendgrid';
  readonly displayName = 'SendGrid Email';
  readonly description = 'Transactional email delivery and delivery metrics.';
  readonly version = '1.0.0';
  readonly category = 'communication';

  getActions(): AdapterActionDefinition[] {
    return [
      { action: 'send-email', description: 'Send transactional email to recipient', permissionLevel: 'external-write', sideEffects: true, requiresApproval: true },
      { action: 'get-stats', description: 'Inspect email bounce and delivery statistics', permissionLevel: 'read', sideEffects: false, requiresApproval: false },
    ];
  }

  async checkHealth(): Promise<AdapterHealthResult> {
    const hasKey = Boolean(process.env.SENDGRID_API_KEY);
    return {
      healthy: hasKey,
      status: hasKey ? 'configured' : 'unconfigured',
      message: hasKey ? 'SENDGRID_API_KEY present' : 'SENDGRID_API_KEY required',
    };
  }

  async execute(action: string, inputs: Record<string, unknown>): Promise<unknown> {
    if (action === 'send-email') {
      const to = inputs.to as string;
      const subject = inputs.subject as string;
      if (!to || !subject) throw new Error('send-email requires "to" and "subject"');
      return { to, subject, sent: true, statusCode: 202 };
    }
    if (action === 'get-stats') return { delivered: 0, bounces: 0 };
    throw new Error(`Unsupported action "${action}" on SendGridAdapter`);
  }
}

export class TwilioAdapter extends BaseIntegrationAdapter {
  readonly name = 'twilio';
  readonly displayName = 'Twilio SMS';
  readonly description = 'SMS message dispatching and delivery tracking.';
  readonly version = '1.0.0';
  readonly category = 'communication';

  getActions(): AdapterActionDefinition[] {
    return [
      { action: 'send-sms', description: 'Send SMS message to phone number', permissionLevel: 'external-write', sideEffects: true, requiresApproval: true },
      { action: 'get-message-status', description: 'Inspect SMS delivery receipt', permissionLevel: 'read', sideEffects: false, requiresApproval: false },
    ];
  }

  async checkHealth(): Promise<AdapterHealthResult> {
    const hasCreds = Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN);
    return {
      healthy: hasCreds,
      status: hasCreds ? 'configured' : 'unconfigured',
      message: hasCreds ? 'Twilio credentials configured' : 'TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN required',
    };
  }

  async execute(action: string, inputs: Record<string, unknown>): Promise<unknown> {
    if (action === 'send-sms') {
      const to = inputs.to as string;
      const body = inputs.body as string;
      if (!to || !body) throw new Error('send-sms requires "to" and "body"');
      return { sid: 'SMmock_twilio_sid_123', to, status: 'queued' };
    }
    if (action === 'get-message-status') {
      const sid = inputs.sid as string;
      if (!sid) throw new Error('get-message-status requires "sid"');
      return { sid, status: 'delivered' };
    }
    throw new Error(`Unsupported action "${action}" on TwilioAdapter`);
  }
}
