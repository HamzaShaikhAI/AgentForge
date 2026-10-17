#!/usr/bin/env node
/**
 * AgentForge CLI
 * Unified command-line interface for AgentForge operations and authentication.
 */

import {
  GoogleOAuthService,
  DEFAULT_MINIMAL_SCOPES,
  YOUTUBE_READONLY_SCOPE,
  YOUTUBE_UPLOAD_SCOPE,
  validateGoogleClientId,
} from '../auth/google-oauth.js';
import { maskEmail } from '../auth/redact.js';
import { getAgentForgeDataDir } from '../auth/credential-store.js';

export async function runCli(args: string[] = process.argv.slice(2)): Promise<number> {
  const [subcommand, ...rest] = args;

  if (!subcommand || subcommand === '--help' || subcommand === '-h' || subcommand === 'help') {
    printGeneralHelp();
    return 0;
  }

  if (subcommand === 'auth') {
    return handleAuthCommand(rest);
  }

  console.error(`Unknown command: "${subcommand}". Run "agentforge --help" for available commands.`);
  return 1;
}

async function handleAuthCommand(args: string[]): Promise<number> {
  const [action, target, ...extra] = args;
  const oauthService = new GoogleOAuthService();

  if (!action || action === 'help' || action === '--help') {
    printAuthHelp();
    return 0;
  }

  if (action === 'status') {
    const status = await oauthService.getStatus();
    const hasYouTube = status.grantedScopes.includes(YOUTUBE_READONLY_SCOPE);
    const hasYouTubeUpload = status.grantedScopes.includes(YOUTUBE_UPLOAD_SCOPE);
    console.log('\n======================================================');
    console.log('         AgentForge Authentication Status             ');
    console.log('======================================================\n');
    console.log(`  Provider:           Google OAuth 2.0`);
    console.log(`  Onboarding State:   ${status.onboardingState.toUpperCase()}`);
    if (status.actionRequiredReason) {
      console.log(`  Action Required:    ${status.actionRequiredReason}`);
    }
    console.log(`  Auth Mode:          ${status.authMode.toUpperCase()}`);
    console.log(`  Client Configured:  ${status.clientConfigured ? 'YES (' + status.configSource + ')' : 'NO'}`);
    console.log(`  Client Validation:  ${status.clientValidation.toUpperCase()}${status.clientValidationError ? ' (' + status.clientValidationError + ')' : ''}`);
    console.log(`  Client Verified:    ${status.clientVerified ? 'YES (tokens acquired from Google)' : 'NO (not yet verified with Google)'}`);
    console.log(`  Connection Status:  ${status.status.toUpperCase()}`);
    console.log(`  Connected Account:  ${status.connectedAccount ? status.connectedAccount : '(none)'}`);
    console.log(`  Storage Backend:    ${status.storageBackend}`);
    console.log(`  YouTube Read-Only:  ${hasYouTube ? 'AUTHORIZED' : 'NOT AUTHORIZED (run "agentforge auth youtube")'}`);
    console.log(`  YouTube Upload:     ${hasYouTubeUpload ? 'AUTHORIZED' : 'NOT AUTHORIZED (run "agentforge auth youtube --upload")'}`);
    console.log(`  Granted Scopes:     ${status.grantedScopes.length > 0 ? status.grantedScopes.join(', ') : '(none)'}`);
    console.log(`\n  Note: ${status.note}\n`);

    if (status.clientValidation === 'placeholder') {
      console.log('------------------------------------------------------');
      console.log('⚠️  WARNING: PLACEHOLDER CLIENT ID DETECTED');
      console.log(`   ${status.clientValidationError}`);
      console.log('\n   To resolve:');
      console.log('     1. Open Google Cloud Console: https://console.cloud.google.com/apis/credentials');
      console.log('     2. Create an OAuth 2.0 Client ID with Application Type: "Desktop app"');
      console.log('     3. Configure AgentForge:');
      console.log('        agentforge auth configure --client-id "<PROJECT_NUM>-<HASH>.apps.googleusercontent.com"');
      console.log('     4. Or clear this placeholder by running:');
      console.log('        agentforge auth configure --reset');
      console.log('------------------------------------------------------\n');
    } else if (status.clientValidation === 'malformed') {
      console.log('------------------------------------------------------');
      console.log('⚠️  WARNING: MALFORMED CLIENT ID FORMAT');
      console.log(`   ${status.clientValidationError}`);
      console.log('\n   Ensure you created a "Desktop app" client in Google Cloud Console.');
      console.log('   Run: agentforge auth configure --client-id "<PROJECT_NUM>-<HASH>.apps.googleusercontent.com"');
      console.log('------------------------------------------------------\n');
    }

    if (status.publisherRequirement?.needed) {
      console.log('------------------------------------------------------');
      console.log('  Publisher Setup Requirements (Zero-Config Distribution):');
      for (const step of status.publisherRequirement.steps) {
        console.log(`    • ${step}`);
      }
      console.log('------------------------------------------------------\n');
    }
    return 0;
  }

  if (action === 'configure') {
    const allArgs = [target, ...extra].filter(Boolean);

    // Support --reset / -r to clear local developer configuration
    if (allArgs.includes('--reset') || allArgs.includes('-r')) {
      const removed = await oauthService.deleteDeveloperConfig();
      if (removed) {
        console.log('\n✅ Local developer OAuth client configuration file removed.');
      } else {
        console.log('\nℹ No developer configuration file was found to remove.');
      }
      console.log('   Run "agentforge auth configure --client-id <ID>" to configure new credentials.\n');
      return 0;
    }

    // Parse flags: --client-id <id> [--client-secret <secret>]
    let clientId = '';
    let clientSecret = '';
    for (let i = 0; i < allArgs.length; i++) {
      const a = allArgs[i];
      if (a === '--client-id' || a === '-c') {
        clientId = allArgs[++i] || '';
      } else if (a === '--client-secret' || a === '-s') {
        clientSecret = allArgs[++i] || '';
      }
    }

    if (!clientId) {
      console.error('\n❌ Missing required argument: --client-id <id>\n');
      console.log('Usage:');
      console.log('  agentforge auth configure --client-id "<PROJECT_NUM>-<HASH>.apps.googleusercontent.com" [--client-secret "<SECRET>"]');
      console.log('  agentforge auth configure --reset\n');
      return 1;
    }

    const validation = validateGoogleClientId(clientId);
    if (!validation.valid) {
      console.error(`\n❌ Invalid Client ID: ${validation.reason}\n`);
      console.log('A Google Cloud "Desktop app" OAuth Client ID is required.');
      console.log('Format: <project-number>-<hash>.apps.googleusercontent.com');
      console.log('Example: 123456789012-abcdef123456.apps.googleusercontent.com\n');
      return 1;
    }

    try {
      const savedPath = await oauthService.saveDeveloperConfig(clientId, clientSecret);
      console.log('\n✅ Developer OAuth client credentials saved successfully!');
      console.log(`   Config file: ${savedPath}`);
      console.log('   You can now connect to Google by running: agentforge auth google\n');
      return 0;
    } catch (err) {
      console.error(`\n❌ Failed to save configuration: ${(err as Error).message}\n`);
      return 1;
    }
  }

  if (action === 'reset') {
    const deletedConfig = await oauthService.deleteDeveloperConfig();
    const result = await oauthService.logout();
    console.log('\n======================================================');
    console.log('         AgentForge Auth Reset Completed              ');
    console.log('======================================================\n');
    if (deletedConfig) {
      console.log('  ✓ Developer OAuth configuration file removed.');
    } else {
      console.log('  • No developer configuration file was present.');
    }
    if (result.deletedLocal) {
      console.log('  ✓ Stored OAuth tokens and session credentials removed.');
    } else {
      console.log('  • No stored credentials were found to remove.');
    }
    console.log('\nAgentForge authentication state has been reset.\n');
    return 0;
  }

  if (action === 'google') {
    const status = await oauthService.getStatus();

    if (status.status === 'connected') {
      console.log(`\nℹ Already connected to Google account: ${status.connectedAccount}`);
      console.log('Re-authenticating will replace stored tokens with new credentials.\n');
    }

    if (status.onboardingState === 'Not configured') {
      console.log('\n❌ Google OAuth client credentials not found.\n');
      console.log('Zero-configuration Google login is pending official publisher client registration.');
      console.log('\nTo set up Developer Mode with your own Google Cloud credentials:');
      console.log('  1. Use the configure command:');
      console.log('     agentforge auth configure --client-id "<PROJECT_NUM>-<HASH>.apps.googleusercontent.com"');
      console.log('\n  2. Or set environment variables:');
      console.log('     $env:GOOGLE_CLIENT_ID = "<PROJECT_NUM>-<HASH>.apps.googleusercontent.com"');
      console.log('     $env:GOOGLE_CLIENT_SECRET = "<YOUR_CLIENT_SECRET>"');
      console.log('\n  3. Or save your downloaded Google Cloud client secret JSON to:');
      console.log(`     ${getAgentForgeDataDir()}\\google-client.json`);
      console.log('\nRun "agentforge auth help" for the complete setup guide.\n');
      return 1;
    }

    if (status.onboardingState === 'Action required' && (status.clientValidation === 'placeholder' || status.clientValidation === 'malformed')) {
      console.error(`\n❌ Cannot start Google authentication:`);
      console.error(`   ${status.clientValidationError || status.actionRequiredReason}\n`);
      console.log('To resolve this:');
      console.log('  1. Open Google Cloud Console: https://console.cloud.google.com/apis/credentials');
      console.log('  2. Create an OAuth 2.0 Client ID with Application Type: "Desktop app"');
      console.log('  3. Configure AgentForge:');
      console.log('     agentforge auth configure --client-id "<PROJECT_NUM>-<HASH>.apps.googleusercontent.com"');
      console.log('  4. Or run "agentforge auth reset" to clear the stale configuration.\n');
      return 1;
    }

    const config = await oauthService.getClientConfig();
    if (!config) {
      console.error('\n❌ Could not resolve OAuth client configuration.\n');
      return 1;
    }

    const validation = validateGoogleClientId(config.clientId);
    if (!validation.valid) {
      console.error(`\n❌ Invalid OAuth Client Configuration:`);
      console.error(`   ${validation.reason}\n`);
      return 1;
    }

    if (status.authMode === 'zero-config') {
      console.log('\n🔐 Starting Zero-Configuration Google Login...');
      console.log('Connecting via AgentForge Desktop application client...');
    } else {
      console.log('\n🔐 Starting Google OAuth Authentication (Developer Mode)...');
      console.log(`Using OAuth client from: ${config.source}`);
    }
    console.log('Opening authorization page in your default browser...\n');

    try {
      const creds = await oauthService.authenticateInteractive({
        onPromptUrl: url => {
          console.log('If browser did not open automatically, visit this URL:\n');
          console.log(`  ${url}\n`);
          console.log('Waiting for approval in browser (press Ctrl+C to cancel)...\n');
        },
      });

      console.log('✅ Google Authentication Successful!');
      console.log(`   Connected Account: ${creds.userEmail ? maskEmail(creds.userEmail) : 'Google User'}`);
      console.log(`   Security:          Tokens encrypted and stored via OS-protected storage`);
      console.log(`   Granted Scopes:    ${creds.scopes?.join(', ') || 'none'}`);
      console.log('\nAgentForge integrations can now reuse this connection.\n');
      return 0;
    } catch (err: unknown) {
      console.error(`\n❌ Authentication failed: ${(err as Error).message}\n`);
      return 1;
    }
  }

  if (action === 'youtube') {
    const status = await oauthService.getStatus();

    if (status.onboardingState === 'Not configured') {
      console.log('\n❌ Google OAuth client credentials not found.\n');
      console.log('Zero-configuration Google login is pending official publisher client registration.');
      console.log('To set up Developer Mode with your own Google Cloud credentials:');
      console.log('  agentforge auth configure --client-id "<PROJECT_NUM>-<HASH>.apps.googleusercontent.com"\n');
      return 1;
    }

    if (status.onboardingState === 'Action required' && (status.clientValidation === 'placeholder' || status.clientValidation === 'malformed')) {
      console.error(`\n❌ Cannot start YouTube authorization:`);
      console.error(`   ${status.clientValidationError || status.actionRequiredReason}\n`);
      console.log('To resolve this:');
      console.log('  1. Open Google Cloud Console: https://console.cloud.google.com/apis/credentials');
      console.log('  2. Create an OAuth 2.0 Client ID with Application Type: "Desktop app"');
      console.log('  3. Configure AgentForge:');
      console.log('     agentforge auth configure --client-id "<PROJECT_NUM>-<HASH>.apps.googleusercontent.com"');
      console.log('  4. Or run "agentforge auth reset" to clear the stale configuration.\n');
      return 1;
    }

    const config = await oauthService.getClientConfig();
    if (!config) {
      console.error('\n❌ Could not resolve OAuth client configuration.\n');
      return 1;
    }

    const validation = validateGoogleClientId(config.clientId);
    if (!validation.valid) {
      console.error(`\n❌ Invalid OAuth Client Configuration:`);
      console.error(`   ${validation.reason}\n`);
      return 1;
    }

    const isUploadRequested = [target, ...extra].some(arg => arg === '--upload' || arg === '-u' || arg === '--publish');

    if (isUploadRequested) {
      const hasUploadScope = status.grantedScopes.includes(YOUTUBE_UPLOAD_SCOPE);
      if (status.status === 'connected' && hasUploadScope) {
        console.log(`\n✓ YouTube video upload is already authorized for account: ${status.connectedAccount}`);
        console.log(`  Granted Scope: ${YOUTUBE_UPLOAD_SCOPE}\n`);
        return 0;
      }

      console.log('\n======================================================');
      console.log('       AgentForge YouTube Publishing Authorization     ');
      console.log('======================================================\n');
      console.log('AgentForge requires YouTube video upload permission:');
      console.log(`  • Scope:   ${YOUTUBE_UPLOAD_SCOPE}`);
      console.log(`  • Purpose: Upload video files to your YouTube channel with explicit approval`);
      console.log(`  • Access:  Incremental authorization via Google OAuth 2.0`);
      console.log(`  • Policy:  Every upload requires explicit operator consent before publishing\n`);
      console.log('ℹ Note: YouTube upload is a sensitive Google scope.');
      console.log('  If Google displays "Google hasn\'t verified this app" during development:');
      console.log('  Click "Advanced" > "Go to AgentForge (unsafe)" to continue.\n');

      console.log('Opening authorization page in your default browser...\n');

      try {
        const creds = await oauthService.authenticateInteractive({
          scopes: [...DEFAULT_MINIMAL_SCOPES, YOUTUBE_READONLY_SCOPE, YOUTUBE_UPLOAD_SCOPE],
          onPromptUrl: url => {
            console.log('If browser did not open automatically, visit this URL:\n');
            console.log(`  ${url}\n`);
            console.log('Waiting for approval in browser (press Ctrl+C to cancel)...\n');
          },
        });

        console.log('✅ YouTube Upload Authorization Successful!');
        console.log(`   Connected Account: ${creds.userEmail ? maskEmail(creds.userEmail) : 'Google User'}`);
        console.log(`   Granted Scopes:    ${creds.scopes?.join(', ') || 'none'}\n`);
        return 0;
      } catch (err: unknown) {
        console.error(`\n❌ Authorization failed: ${(err as Error).message}\n`);
        return 1;
      }
    }

    const hasScope = status.grantedScopes.includes(YOUTUBE_READONLY_SCOPE);
    if (status.status === 'connected' && hasScope) {
      console.log(`\n✓ YouTube read-only is already authorized for account: ${status.connectedAccount}`);
      console.log(`  Granted Scope: ${YOUTUBE_READONLY_SCOPE}\n`);
      return 0;
    }

    console.log('\n======================================================');
    console.log('       AgentForge YouTube Authorization Setup         ');
    console.log('======================================================\n');
    console.log('AgentForge requires read-only permission to inspect your YouTube channel and videos:');
    console.log(`    Scope:   ${YOUTUBE_READONLY_SCOPE}`);
    console.log(`    Purpose: Read channel metadata and video uploads (no modify, upload, or delete permissions)`);
    console.log(`    Access:  Incremental authorization via Google OAuth 2.0\n`);

    console.log('Opening authorization page in your default browser...\n');

    try {
      const creds = await oauthService.authenticateInteractive({
        scopes: [...DEFAULT_MINIMAL_SCOPES, YOUTUBE_READONLY_SCOPE],
        onPromptUrl: url => {
          console.log('If browser did not open automatically, visit this URL:\n');
          console.log(`  ${url}\n`);
          console.log('Waiting for approval in browser (press Ctrl+C to cancel)...\n');
        },
      });

      console.log('✅ YouTube Authorization Successful!');
      console.log(`   Connected Account: ${creds.userEmail ? maskEmail(creds.userEmail) : 'Google User'}`);
      console.log(`   Granted Scopes:    ${creds.scopes?.join(', ') || 'none'}\n`);
      return 0;
    } catch (err: unknown) {
      console.error(`\n❌ Authorization failed: ${(err as Error).message}\n`);
      return 1;
    }
  }

  if (action === 'logout') {
    if (target !== 'google' && target !== 'youtube') {
      console.error(`Specify provider to logout (e.g. "agentforge auth logout google")`);
      return 1;
    }

    console.log('\nLogging out and removing stored credentials...');
    const result = await oauthService.logout();
    if (result.revokedRemote) {
      console.log('✓ Remote Google token revocation successful.');
    } else {
      console.log('ℹ Remote revocation skipped or failed (offline / already expired).');
    }

    if (result.deletedLocal) {
      console.log('✓ Local credentials removed from secure storage.');
    } else {
      console.log('ℹ No local credentials were found to remove.');
    }

    console.log('\nAccount disconnected successfully.\n');
    return 0;
  }

  console.error(`Unknown auth action: "${action}". Run "agentforge auth help" for usage.`);
  return 1;
}

function printGeneralHelp() {
  console.log(`
AgentForge — Extensible Capability Harness for Antigravity

USAGE:
  agentforge <command> [options]

COMMANDS:
  auth <action>   Manage authentication and OAuth connections
  help            Show this help text

RUN:
  agentforge auth --help     for authentication commands
`);
}

function printAuthHelp() {
  console.log(`
AgentForge Authentication CLI

USAGE:
  agentforge auth google           Start guided Google OAuth login (minimal scopes)
  agentforge auth youtube          Authorize YouTube Data API read-only scope
  agentforge auth youtube --upload Authorize YouTube video upload & publishing scope
  agentforge auth status           Display current Google and YouTube connection state
  agentforge auth configure        Save local developer OAuth client credentials
  agentforge auth configure --reset Remove saved developer OAuth client credentials
  agentforge auth reset            Reset all OAuth config and stored credentials
  agentforge auth logout google    Revoke and delete stored Google credentials
  agentforge auth help             Display this setup guide

ZERO-CONFIG VS DEVELOPER MODE:
  • Zero-Configuration: Distributed with pre-registered AgentForge Desktop Client.
    Click "Connect Google" or run "agentforge auth google" directly.
  • Developer Mode: Use your own Google Cloud Desktop OAuth Client ID.
    Run "agentforge auth configure --client-id <CLIENT_ID>" or set $env:GOOGLE_CLIENT_ID.

ONE-TIME GOOGLE CLOUD SETUP GUIDE:
  (Required for Developer Mode or custom self-hosting)
  1. Open Google Cloud Console: https://console.cloud.google.com
  2. Create a project or select an existing one (e.g., "AgentForge")
  3. Configure OAuth Consent Screen (APIs & Services > OAuth consent screen):
     - User Type: "External"
     - App name: "AgentForge"
     - User support email: your email
     - Developer contact info: your email
     - While in "Testing" publishing status, add your Google email under "Test users"
  4. Enable required APIs (APIs & Services > Enabled APIs & services > + ENABLE APIS AND SERVICES):
     - Enable "YouTube Data API v3" (if using YouTube bridges)
  5. Create OAuth Client ID (APIs & Services > Credentials):
     - Click "+ CREATE CREDENTIALS" > "OAuth client ID"
     - Application type: "Desktop app" (IMPORTANT: do NOT select "Web application")
     - Name: "AgentForge Desktop"
     - Click "Create"
  6. Configure AgentForge with your real credentials:
     OPTION A (CLI Configure Command):
       agentforge auth configure --client-id "<PROJECT_NUM>-<HASH>.apps.googleusercontent.com"

     OPTION B (Environment Variables):
       $env:GOOGLE_CLIENT_ID = "<PROJECT_NUM>-<HASH>.apps.googleusercontent.com"
       $env:GOOGLE_CLIENT_SECRET = "<YOUR_CLIENT_SECRET>"

     OPTION C (Config File):
       Download client_secret_*.json from Google Cloud Console and save as:
       ${getAgentForgeDataDir()}\\google-client.json

  7. Authorize:
     Run "agentforge auth google" (or "agentforge auth youtube --upload") to authenticate.
`);
}

import { fileURLToPath } from 'node:url';
import { resolve as pathResolve } from 'node:path';

// Direct invocation check
const isDirectRun = Boolean(
  process.argv[1] &&
    (pathResolve(process.argv[1]) === fileURLToPath(import.meta.url) ||
      process.argv[1].endsWith('index.js') ||
      process.argv[1].endsWith('index.ts')),
);

if (isDirectRun) {
  runCli().then(code => {
    if (code !== 0) process.exit(code);
  });
}
