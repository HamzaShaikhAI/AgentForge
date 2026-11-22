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
  YOUTUBE_MANAGE_SCOPE,
  YOUTUBE_PUBLISH_SCOPES,
  validateGoogleClientId,
} from '../auth/google-oauth.js';
import { LinkedInOAuthService } from '../auth/linkedin-oauth.js';
import { XOAuthService } from '../auth/x-oauth.js';
import { maskEmail } from '../auth/redact.js';
import { getAgentForgeDataDir } from '../auth/credential-store.js';
import { GoogleFlowAdapter } from '../adapters/google-flow.js';

export async function runCli(args: string[] = process.argv.slice(2)): Promise<number> {
  const [subcommand, ...rest] = args;

  if (!subcommand || subcommand === '--help' || subcommand === '-h' || subcommand === 'help') {
    printGeneralHelp();
    return 0;
  }

  if (subcommand === 'auth') {
    return handleAuthCommand(rest);
  }

  if (subcommand === 'flow') {
    return handleFlowCommand(rest);
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

    const linkedInService = new LinkedInOAuthService();
    const liStatus = await linkedInService.getStatus();

    console.log('\n======================================================');
    console.log('         AgentForge Authentication Status             ');
    console.log('======================================================\n');
    console.log(`Provider:           Google OAuth 2.0`);
    console.log(`[ Google OAuth 2.0 ]`);
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
    console.log(`  Note:               ${status.note}\n`);

    console.log(`[ LinkedIn OAuth 2.0 ]`);
    console.log(`  Client Configured:  ${liStatus.clientConfigured ? 'YES (' + liStatus.configSource + ')' : 'NO'}`);
    console.log(`  Connection Status:  ${liStatus.status.toUpperCase()}`);
    console.log(`  Connected Account:  ${liStatus.connectedAccount || '(none)'}`);
    console.log(`  Person URN:         ${liStatus.personUrn || '(none)'}`);
    console.log(`  Storage Backend:    ${liStatus.storageBackend}`);
    console.log(`  Granted Scopes:     ${liStatus.grantedScopes.length > 0 ? liStatus.grantedScopes.join(', ') : '(none)'}`);
    console.log(`  Note:               ${liStatus.note}\n`);

    const xService = new XOAuthService();
    const xStatus = await xService.getStatus();

    console.log(`[ X (Twitter) OAuth 2.0 ]`);
    console.log(`  Client Configured:  ${xStatus.clientConfigured ? 'YES (' + xStatus.configSource + ')' : 'NO'}`);
    console.log(`  Connection Status:  ${xStatus.status.toUpperCase()}`);
    console.log(`  Connected Account:  ${xStatus.connectedAccount || '(none)'}`);
    console.log(`  User ID:            ${xStatus.userId || '(none)'}`);
    console.log(`  Storage Backend:    ${xStatus.storageBackend}`);
    console.log(`  Granted Scopes:     ${xStatus.grantedScopes.length > 0 ? xStatus.grantedScopes.join(', ') : '(none)'}`);
    console.log(`  Note:               ${xStatus.note}\n`);

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
      const hasManageScope = status.grantedScopes.includes(YOUTUBE_MANAGE_SCOPE);
      const isForce = [target, ...extra].some(arg => arg === '--force' || arg === '-f' || arg === '--reauth');
      if (status.status === 'connected' && hasUploadScope && hasManageScope && !isForce) {
        console.log(`\n✓ YouTube video upload & management is already authorized for account: ${status.connectedAccount}`);
        console.log(`  Granted Scopes: ${YOUTUBE_UPLOAD_SCOPE}, ${YOUTUBE_MANAGE_SCOPE}\n`);
        return 0;
      }

      console.log('\n======================================================');
      console.log('       AgentForge YouTube Publishing Authorization     ');
      console.log('======================================================\n');
      console.log('AgentForge requires YouTube video upload & management permissions:');
      console.log(`  • Scope:   ${YOUTUBE_UPLOAD_SCOPE}`);
      console.log(`  • Scope:   ${YOUTUBE_MANAGE_SCOPE}`);
      console.log(`  • Purpose: Upload video files and update video status/metadata on your YouTube channel`);
      console.log(`  • Access:  Incremental authorization via Google OAuth 2.0`);
      console.log(`  • Policy:  Every upload/update requires explicit operator consent before publishing\n`);
      console.log('ℹ Note: YouTube upload and management are sensitive Google scopes.');
      console.log('  If Google displays "Google hasn\'t verified this app" during development:');
      console.log('  Click "Advanced" > "Go to AgentForge (unsafe)" to continue.\n');

      console.log('Opening authorization page in your default browser...\n');

      try {
        const creds = await oauthService.authenticateInteractive({
          scopes: YOUTUBE_PUBLISH_SCOPES,
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

  if (action === 'configure-linkedin') {
    const allArgs = [target, ...extra].filter(Boolean);
    const linkedInService = new LinkedInOAuthService();

    if (allArgs.includes('--reset') || allArgs.includes('-r')) {
      const removed = await linkedInService.deleteDeveloperConfig();
      if (removed) {
        console.log('\n✅ Local LinkedIn developer OAuth client configuration removed.');
      } else {
        console.log('\nℹ No LinkedIn developer configuration file was found to remove.');
      }
      return 0;
    }

    let clientId = '';
    let clientSecret = '';
    let redirectUri = '';
    for (let i = 0; i < allArgs.length; i++) {
      const a = allArgs[i];
      if (a === '--client-id' || a === '-c') {
        clientId = allArgs[++i] || '';
      } else if (a === '--client-secret' || a === '-s') {
        clientSecret = allArgs[++i] || '';
      } else if (a === '--redirect-uri') {
        redirectUri = allArgs[++i] || '';
      }
    }

    if (!clientId) {
      console.error('\n❌ Missing required argument: --client-id <id>');
      console.log('Usage:');
      console.log('  agentforge auth configure-linkedin --client-id <ID> --client-secret <SECRET> [--redirect-uri <URI>]\n');
      return 1;
    }

    try {
      const savedPath = await linkedInService.saveDeveloperConfig(clientId, clientSecret, redirectUri);
      console.log('\n✅ LinkedIn OAuth client credentials saved successfully!');
      console.log(`   Config file: ${savedPath}`);
      console.log('   You can now connect to LinkedIn by running: agentforge auth linkedin\n');
      return 0;
    } catch (err) {
      console.error(`\n❌ Failed to save LinkedIn configuration: ${(err as Error).message}\n`);
      return 1;
    }
  }

  if (action === 'linkedin') {
    const allArgs = [target, ...extra].filter(Boolean);
    const linkedInService = new LinkedInOAuthService();

    // Check for inline --client-id and --client-secret flags
    let inlineId = '';
    let inlineSecret = '';
    let customPort = 43110;
    let customRedirect = '';

    for (let i = 0; i < allArgs.length; i++) {
      const a = allArgs[i];
      if (a === '--client-id' || a === '-c') {
        inlineId = allArgs[++i] || '';
      } else if (a === '--client-secret' || a === '-s') {
        inlineSecret = allArgs[++i] || '';
      } else if (a === '--port' || a === '-p') {
        customPort = parseInt(allArgs[++i] || '43110', 10);
      } else if (a === '--redirect-uri') {
        customRedirect = allArgs[++i] || '';
      }
    }

    if (inlineId && inlineSecret) {
      await linkedInService.saveDeveloperConfig(inlineId, inlineSecret, customRedirect);
    }

    const config = await linkedInService.getClientConfig();
    if (!config || !config.clientId) {
      console.log('\n❌ LinkedIn OAuth App credentials not found.\n');
      console.log('To set up 1-click LinkedIn Chrome popup login:');
      console.log('  1. Open LinkedIn Developer Portal: https://www.linkedin.com/developers');
      console.log('  2. In your app, request products: "Share on LinkedIn" and "Sign In with LinkedIn using OpenID Connect"');
      console.log('  3. In your app\'s "Auth" tab, add Authorized Redirect URL:');
      console.log(`     http://localhost:43110/callback`);
      console.log('  4. Configure AgentForge with your Client ID and Client Secret:');
      console.log('     agentforge auth configure-linkedin --client-id <ID> --client-secret <SECRET>');
      console.log('     (or pass flags directly: agentforge auth linkedin --client-id <ID> --client-secret <SECRET>)\n');
      return 1;
    }

    console.log('\n======================================================');
    console.log('       AgentForge LinkedIn OAuth Authorization        ');
    console.log('======================================================\n');
    console.log(`  • Client ID:  ${config.clientId}`);
    console.log(`  • Port:       ${customPort}`);
    console.log(`  • Redirect:   ${customRedirect || config.redirectUri || `http://localhost:${customPort}/callback`}`);
    console.log('\n🚀 Opening authorization popup in your default browser (Google Chrome)...\n');

    try {
      const creds = await linkedInService.authenticateInteractive({
        port: customPort,
        redirectUri: customRedirect || config.redirectUri,
        onPromptUrl: url => {
          console.log('If your browser did not open automatically, visit this URL:\n');
          console.log(`  ${url}\n`);
          console.log('Waiting for approval in browser (press Ctrl+C to cancel)...\n');
        },
      });

      console.log('======================================================');
      console.log('✅ LinkedIn Authentication Successful!');
      console.log('======================================================');
      console.log(`  Connected Member:  ${creds.extraData?.name || 'LinkedIn Member'}`);
      console.log(`  Person URN:        ${creds.extraData?.personUrn || `urn:li:person:${creds.userId}`}`);
      if (creds.userEmail) {
        console.log(`  Member Email:      ${creds.userEmail}`);
      }
      console.log(`  Security:          Encrypted via OS-protected storage`);
      console.log(`  Granted Scopes:    ${creds.scopes?.join(', ') || 'openid, profile, w_member_social'}\n`);
      console.log('AgentForge LinkedIn bridge is now ready to use without manual token entry!\n');
      return 0;
    } catch (err: unknown) {
      console.error(`\n❌ LinkedIn authorization failed: ${(err as Error).message}\n`);
      return 1;
    }
  }

  if (action === 'configure-x' || action === 'configure-twitter') {
    const allArgs = [target, ...extra].filter(Boolean);
    const xService = new XOAuthService();

    if (allArgs.includes('--reset') || allArgs.includes('-r')) {
      const removed = await xService.deleteDeveloperConfig();
      if (removed) {
        console.log('\n✅ Local X developer OAuth client configuration removed.');
      } else {
        console.log('\nℹ No X developer configuration file was found to remove.');
      }
      return 0;
    }

    let clientId = '';
    let clientSecret = '';
    let redirectUri = '';

    for (let i = 0; i < allArgs.length; i++) {
      if (allArgs[i] === '--client-id' && allArgs[i + 1]) {
        clientId = allArgs[i + 1];
        i++;
      } else if (allArgs[i] === '--client-secret' && allArgs[i + 1]) {
        clientSecret = allArgs[i + 1];
        i++;
      } else if (allArgs[i] === '--redirect-uri' && allArgs[i + 1]) {
        redirectUri = allArgs[i + 1];
        i++;
      }
    }

    if (!clientId) {
      console.error('\n❌ Missing required argument: --client-id <id>');
      console.log('Usage:');
      console.log('  agentforge auth configure-x --client-id <ID> [--client-secret <SECRET>] [--redirect-uri <URI>]\n');
      return 1;
    }

    try {
      const savedPath = await xService.saveDeveloperConfig(clientId, clientSecret, redirectUri);
      console.log('\n✅ X OAuth client credentials saved successfully!');
      console.log(`   Config file: ${savedPath}`);
      console.log('   You can now connect to X by running: agentforge auth x\n');
      return 0;
    } catch (err) {
      console.error(`\n❌ Failed to save X configuration: ${(err as Error).message}\n`);
      return 1;
    }
  }

  if (action === 'x' || action === 'twitter') {
    const allArgs = [target, ...extra].filter(Boolean);
    const xService = new XOAuthService();

    let customPort = 43111;
    let customRedirect = '';

    for (let i = 0; i < allArgs.length; i++) {
      if (allArgs[i] === '--port' && allArgs[i + 1]) {
        customPort = parseInt(allArgs[i + 1], 10) || 43111;
        i++;
      } else if (allArgs[i] === '--redirect-uri' && allArgs[i + 1]) {
        customRedirect = allArgs[i + 1];
        i++;
      }
    }

    const config = await xService.getClientConfig();
    if (!config?.clientId) {
      console.error('\n❌ X Client ID is required before starting authentication.');
      console.log('Run the configuration command first:');
      console.log('  agentforge auth configure-x --client-id <YOUR_CLIENT_ID> [--client-secret <SECRET>]\n');
      return 1;
    }

    console.log('\n======================================================');
    console.log('       AgentForge 1-Click Browser Login for X         ');
    console.log('======================================================\n');
    console.log(`  • Client ID:  ${config.clientId.slice(0, 6)}... (from ${config.source})`);
    console.log(`  • Redirect:   ${customRedirect || config.redirectUri || `http://localhost:${customPort}/callback`}`);
    console.log('\n🚀 Opening authorization popup in your default browser (Google Chrome)...\n');

    try {
      const creds = await xService.authenticateInteractive({
        port: customPort,
        redirectUri: customRedirect || config.redirectUri,
        onPromptUrl: url => {
          console.log('If your browser did not open automatically, visit this URL:\n');
          console.log(`  ${url}\n`);
          console.log('Waiting for approval in browser (press Ctrl+C to cancel)...\n');
        },
      });

      console.log('======================================================');
      console.log('✅ X (Twitter) Authentication Successful!');
      console.log('======================================================');
      console.log(`  Connected User:    @${creds.extraData?.username || 'x_user'} (${creds.extraData?.name || 'X User'})`);
      console.log(`  User ID:           ${creds.userId}`);
      console.log(`  Security:          Encrypted via OS-protected storage`);
      console.log(`  Granted Scopes:    ${creds.scopes?.join(', ') || 'default'}\n`);
      console.log('AgentForge X bridge is now ready to use without manual token entry!\n');
      return 0;
    } catch (err: unknown) {
      console.error(`\n❌ X authorization failed: ${(err as Error).message}\n`);
      return 1;
    }
  }

  if (action === 'logout') {
    if (target !== 'google' && target !== 'youtube' && target !== 'linkedin' && target !== 'x' && target !== 'twitter') {
      console.error(`Specify provider to logout (e.g. "agentforge auth logout google", "agentforge auth logout linkedin", or "agentforge auth logout x")`);
      return 1;
    }

    if (target === 'x' || target === 'twitter') {
      const xService = new XOAuthService();
      const deleted = await xService.logout();
      if (deleted) {
        console.log('\n✓ X credentials removed from secure storage.');
      } else {
        console.log('\nℹ No stored X credentials found to remove.');
      }
      console.log('X account disconnected successfully.\n');
      return 0;
    }

    if (target === 'linkedin') {
      const linkedInService = new LinkedInOAuthService();
      const deleted = await linkedInService.logout();
      if (deleted) {
        console.log('\n✓ LinkedIn credentials removed from secure storage.');
      } else {
        console.log('\nℹ No stored LinkedIn credentials found to remove.');
      }
      console.log('LinkedIn account disconnected successfully.\n');
      return 0;
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

async function handleFlowCommand(args: string[]): Promise<number> {
  const [action, ...rest] = args;
  const adapter = new GoogleFlowAdapter();

  if (!action || action === 'help' || action === '--help') {
    printFlowHelp();
    return 0;
  }

  if (action === 'video' || action === 'generate') {
    const prompt = rest.join(' ') || 'Cinematic aerial drone shot of futuristic glowing AI laboratory in 4k';
    console.log(`\n🎬 [Google Flow] Generating video in project "antigravity gen auto"...`);
    console.log(`Prompt: "${prompt}"`);

    const result = (await adapter.execute('generate-video', {
      prompt,
      projectName: 'antigravity gen auto',
    })) as any;

    if (result.success) {
      console.log(`\n✨ Video Generated Successfully!`);
      console.log(`Video ID:           ${result.videoId}`);
      console.log(`Model:              ${result.model}`);
      console.log(`Project:            ${result.projectName}`);
      console.log(`Credits Deducted:   ${result.creditsDeducted}`);
      console.log(`Credits Remaining:  ${result.creditsRemaining}`);

      // Auto-download real MP4 file
      const filename = `antigravity-gen-${Date.now()}.mp4`;
      const dlResult = (await adapter.execute('download-media', {
        url: result.videoUrl,
        filename,
      })) as any;

      if (dlResult.success) {
        console.log(`\n📥 Local Video File: ${dlResult.localPath}`);
        console.log(`Size:                ${(dlResult.fileSizeBytes / 1024).toFixed(1)} KB`);
        console.log(`SHA-256:             ${dlResult.sha256}`);
      }
      return 0;
    } else {
      console.error(`Generation failed: ${result.error || 'Unknown error'}`);
      return 1;
    }
  }

  if (action === 'music' || action === 'song') {
    const prompt = rest.join(' ') || 'Upbeat cyberpunk synthwave with driving bass and energetic drums 128 bpm';
    console.log(`\n🎵 [Google Flow Music] Synthesizing track with Google Flow Music Studio...`);
    console.log(`Prompt: "${prompt}"`);

    const result = (await adapter.execute('generate-music', {
      prompt,
      genre: 'synthwave',
      bpm: 128,
      vocalist: 'cyber-vocoder',
      includeStems: true,
      aiProducerChat: 'Make the bass punchy with analog 808s and stereo synth arpeggios',
    })) as any;

    if (result.success) {
      console.log(`\n✨ Song Synthesized Successfully!`);
      console.log(`Music ID:           ${result.musicId}`);
      console.log(`Platform:           ${result.platform}`);
      console.log(`Genre:              ${result.genre.toUpperCase()} • ${result.bpm} BPM • ${result.keySignature}`);
      console.log(`Instruments:        ${result.instruments.join(', ')}`);
      console.log(`Vocal Style:        ${result.vocalist}`);
      console.log(`Duration:           ${result.durationSeconds}s`);
      console.log(`Bitrate:            ${result.bitrate} • 48kHz Stereo`);
      console.log(`Credits Deducted:   ${result.creditsDeducted}`);
      console.log(`Credits Remaining:  ${result.creditsRemaining}`);

      // Auto-download real MP3 file
      const filename = `antigravity-music-${Date.now()}.mp3`;
      const dlResult = (await adapter.execute('download-media', {
        url: result.audioUrl,
        filename,
      })) as any;

      if (dlResult.success) {
        console.log(`\n📥 Local Audio File: ${dlResult.localPath}`);
        console.log(`Size:                ${(dlResult.fileSizeBytes / 1024).toFixed(1)} KB`);
        console.log(`SHA-256:             ${dlResult.sha256}`);
      }
      return 0;
    } else {
      console.error(`Music synthesis failed: ${result.error || 'Unknown error'}`);
      return 1;
    }
  }

  if (action === 'credits' || action === 'balance') {
    const balance = (await adapter.execute('get-credit-balance', {})) as any;
    console.log('\n======================================================');
    console.log('            Google Flow Credits Wallet                ');
    console.log('======================================================\n');
    console.log(`Account Tier:        ${balance.wallet.tier.toUpperCase()}`);
    console.log(`Daily Free Credits:  ${balance.wallet.dailyRemaining} / ${balance.wallet.dailyAllowance}`);
    console.log(`Monthly Pro Pool:    ${balance.wallet.subscriptionCredits}`);
    console.log(`Total Available:     ${balance.wallet.totalAvailable} credits`);
    console.log(`Dedicated Project:   ${balance.project.name}`);
    if (balance.creditsEnded) {
      console.log(`\n${balance.alert}`);
    } else {
      console.log(`\nStatus: Ready for video and image synthesis!`);
    }
    return 0;
  }

  console.error(`Unknown flow action: "${action}". Run "agentforge flow help" for usage.`);
  return 1;
}

function printFlowHelp() {
  console.log(`
AgentForge Google Flow CLI

USAGE:
  agentforge flow video [prompt]   Generate video in project "antigravity gen auto" and download MP4
  agentforge flow music [prompt]   Synthesize track with Google Flow Music Studio & stems
  agentforge flow credits          Check real-time credit balance and daily allowance
  agentforge flow help             Display this help message
`);
}

function printGeneralHelp() {
  console.log(`
AgentForge — Extensible Capability Harness for Antigravity

USAGE:
  agentforge <command> [options]

COMMANDS:
  auth <action>   Manage authentication and OAuth connections
  flow <action>   Google Flow video generation & credit wallet
  help            Show this help text

RUN:
  agentforge flow video "..."  to generate a video immediately
  agentforge flow credits      to view available credits
  agentforge auth --help       for authentication commands
`);
}

function printAuthHelp() {
  console.log(`
AgentForge Authentication CLI

USAGE:
  agentforge auth google           Start guided Google OAuth login (minimal scopes)
  agentforge auth youtube          Authorize YouTube Data API read-only scope
  agentforge auth youtube --upload Authorize YouTube video upload & publishing scope
  agentforge auth linkedin         Start 1-click Chrome popup login for LinkedIn
  agentforge auth configure-linkedin Save LinkedIn OAuth App Client ID & Secret
  agentforge auth x                Start 1-click Chrome popup login for X (Twitter)
  agentforge auth configure-x      Save X Developer OAuth 2.0 Client ID & Secret
  agentforge auth status           Display current Google, YouTube, LinkedIn, and X state
  agentforge auth configure        Save local developer OAuth client credentials
  agentforge auth configure --reset Remove saved developer OAuth client credentials
  agentforge auth reset            Reset all OAuth config and stored credentials
  agentforge auth logout <provider> Revoke and delete stored credentials (google, linkedin, x)
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
