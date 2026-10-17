/**
 * AgentForge Authentication Types
 * Shared interfaces for OAuth credentials, storage, and connection state.
 */

export type GoogleAuthSource = 'builtin' | 'env' | 'config-file' | 'none';

export interface GoogleClientConfig {
  clientId: string;
  clientSecret?: string;
  source: 'builtin' | 'env' | 'config-file';
  configPath?: string;
  isRegisteredPublisherClient?: boolean;
}

export interface PublisherRequirement {
  needed: boolean;
  status: 'pending-registration' | 'configured';
  description: string;
  steps: string[];
}

export interface StoredCredentials {
  provider: string;
  refreshToken?: string;
  accessToken?: string;
  expiresAt?: number; // epoch ms
  scopes?: string[];
  userEmail?: string;
  userId?: string;
  updatedAt: string;
  extraData?: Record<string, unknown>;
}

export interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  expiresAt?: number;
  scopes: string[];
  idToken?: string;
  tokenType: string;
}

export type GoogleConnectionState =
  | 'unconfigured'
  | 'configured'
  | 'connected'
  | 'expired'
  | 'revoked';

export type ClientIdValidationResult =
  | 'valid'
  | 'placeholder'
  | 'malformed'
  | 'missing';

export interface ClientIdValidation {
  valid: boolean;
  status: ClientIdValidationResult;
  reason?: string;
  isPlaceholder?: boolean;
}

export type GoogleOnboardingState =
  | 'Not configured'
  | 'Ready to connect'
  | 'Connected'
  | 'Action required';

export interface GoogleConnectionStatus {
  clientConfigured: boolean;
  clientValidation: ClientIdValidationResult;
  clientValidationError?: string;
  clientVerified: boolean;
  accountConnected: boolean;
  connectedAccount: string | null;
  status: GoogleConnectionState;
  onboardingState: GoogleOnboardingState;
  actionRequiredReason?: string;
  authMode: 'zero-config' | 'developer-config' | 'unconfigured';
  grantedScopes: string[];
  available: boolean;
  note: string;
  configSource: GoogleAuthSource;
  storageBackend: 'windows-dpapi' | 'encrypted-file' | 'memory' | 'unavailable';
  publisherRequirement?: PublisherRequirement;
}

export interface CredentialStore {
  save(provider: string, creds: StoredCredentials): Promise<void>;
  load(provider: string): Promise<StoredCredentials | null>;
  delete(provider: string): Promise<boolean>;
  getBackendName(): 'windows-dpapi' | 'encrypted-file' | 'memory' | 'unavailable';
  isAvailable(): boolean;
}
