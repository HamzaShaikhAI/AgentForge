import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  BookOpen,
  Search,
  CheckCircle,
  Copy,
  ExternalLink,
  Zap,
  Sparkles,
  ArrowRight,
  Key,
  Shield,
  Server,
  Globe,
  Video,
  Music,
  Share2,
  Terminal,
  Database,
  Layers,
  Check,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface TutorialStep {
  title: string;
  description: string;
  actionText?: string;
  actionUrl?: string;
  codeSnippet?: string;
}

interface Tutorial {
  id: string;
  title: string;
  serviceName: string;
  category: 'media' | 'social' | 'cloud' | 'dev' | 'db' | 'project';
  difficulty: 'Super Easy (1 Min)' | 'Easy (2 Mins)' | 'Zero Config';
  difficultyColor: string;
  description: string;
  iconBg: string;
  iconColor: string;
  icon: string;
  prerequisites: string[];
  steps: TutorialStep[];
  testCommand: string;
  configPath?: string;
}

const CATEGORIES = [
  { id: 'all', label: 'All Guides' },
  { id: 'media', label: '🎨 Media & AI' },
  { id: 'social', label: '📱 Social & Video' },
  { id: 'cloud', label: '☁️ Cloud & Domains' },
  { id: 'dev', label: '🛠️ Developer Tools' },
  { id: 'db', label: '🗄️ Databases & Auth' },
  { id: 'project', label: '📋 Project & Office' },
];

const TUTORIALS: Tutorial[] = [
  {
    id: 'google-flow',
    title: 'Google Flow Media Studio & Music',
    serviceName: 'Google Flow (Gemini Omni 1.2 Flash, Veo 2.0 & Music)',
    category: 'media',
    difficulty: 'Super Easy (1 Min)',
    difficultyColor: 'text-success-500 bg-success-500/10 border-success-500/30',
    description: 'Generate real AI videos, cinematic Veo clips, and multi-track songs on Google Cloud GPUs with zero paid API keys!',
    iconBg: 'bg-gradient-to-br from-indigo-500/20 to-purple-500/20',
    iconColor: 'text-purple-400',
    icon: '🎬',
    prerequisites: ['Google account signed into flow.google.com in Chrome'],
    steps: [
      {
        title: 'Step 1: Open Google Flow in Chrome',
        description: 'Open flow.google.com in your regular Chrome browser where you are signed in.',
        actionText: 'Open Google Flow',
        actionUrl: 'https://flow.google.com',
      },
      {
        title: 'Step 2: Open Chrome DevTools Network Tab',
        description: 'Press F12 on your keyboard (or Right-Click → Inspect), then click the "Network" tab at the top.',
      },
      {
        title: 'Step 3: Copy as cURL (cmd)',
        description: 'Right-click on any request (e.g. "batchexecute"), hover over Copy, and click "Copy as cURL (cmd)" (or "Copy request headers").',
      },
      {
        title: 'Step 4: Connect in AgentForge',
        description: 'Open the AgentForge Catalog, click Configure on Google Flow, paste into the box, and click "Connect Live Bridge".',
      },
    ],
    testCommand: 'npm run flow:video "Cinematic glowing AI laboratory in 4k"',
    configPath: '/catalog',
  },
  {
    id: 'youtube',
    title: 'Google OAuth & YouTube Studio',
    serviceName: 'YouTube API & Google Account',
    category: 'social',
    difficulty: 'Super Easy (1 Min)',
    difficultyColor: 'text-success-500 bg-success-500/10 border-success-500/30',
    description: 'Connect your Google account with 1-click loopback OAuth to inspect YouTube channels and publish videos.',
    iconBg: 'bg-red-500/10',
    iconColor: 'text-red-500',
    icon: '▶️',
    prerequisites: ['Any Google account'],
    steps: [
      {
        title: 'Step 1: Click "Sign in with Google"',
        description: 'In AgentForge Connected Accounts or the Catalog Configure modal, click the "Sign in with Google" button.',
      },
      {
        title: 'Step 2: Approve in your browser',
        description: 'A browser tab will open. Select your Google account and click Continue to authorize read/upload access.',
      },
      {
        title: 'Step 3: Tokens are encrypted automatically',
        description: 'AgentForge captures the token via localhost loopback and saves it encrypted into your Windows DPAPI vault.',
      },
    ],
    testCommand: 'node dist/cli/index.js auth status',
    configPath: '/integrations/auth',
  },
  {
    id: 'linkedin',
    title: 'LinkedIn Professional Publisher',
    serviceName: 'LinkedIn REST API',
    category: 'social',
    difficulty: 'Easy (2 Mins)',
    difficultyColor: 'text-brand-500 bg-brand-500/10 border-brand-500/30',
    description: 'Publish autonomous professional posts, technical carousels, and articles to your LinkedIn feed.',
    iconBg: 'bg-blue-600/10',
    iconColor: 'text-blue-500',
    icon: '💼',
    prerequisites: ['LinkedIn Account', 'Free LinkedIn Developer App'],
    steps: [
      {
        title: 'Step 1: Open LinkedIn Developer Portal',
        description: 'Go to developer.linkedin.com, click "My Apps", and click "Create App". Fill in your app name and page.',
        actionText: 'LinkedIn Developers',
        actionUrl: 'https://developer.linkedin.com',
      },
      {
        title: 'Step 2: Copy Client ID & Secret',
        description: 'Under the "Auth" tab in your LinkedIn app, copy your Client ID and Client Secret.',
      },
      {
        title: 'Step 3: Set Redirect URL',
        description: 'Add this redirect URL under Authorized redirect URLs: http://localhost:9470/api/auth/linkedin/callback',
        codeSnippet: 'http://localhost:9470/api/auth/linkedin/callback',
      },
      {
        title: 'Step 4: Save & Connect in AgentForge',
        description: 'Paste your Client ID and Secret in AgentForge Connected Accounts and click "Connect LinkedIn".',
      },
    ],
    testCommand: 'node dist/cli/index.js auth status',
    configPath: '/integrations/auth',
  },
  {
    id: 'x-twitter',
    title: 'X (Twitter) Social Dispatcher',
    serviceName: 'X / Twitter API v2',
    category: 'social',
    difficulty: 'Easy (2 Mins)',
    difficultyColor: 'text-brand-500 bg-brand-500/10 border-brand-500/30',
    description: 'Post autonomous tweets, threads, and polls with full approval gates and safety controls.',
    iconBg: 'bg-zinc-500/10',
    iconColor: 'text-zinc-400',
    icon: '🐦',
    prerequisites: ['X / Twitter Developer Account'],
    steps: [
      {
        title: 'Step 1: Open X Developer Portal',
        description: 'Go to developer.x.com/portal and create a new Project / App.',
        actionText: 'X Developer Portal',
        actionUrl: 'https://developer.x.com/portal',
      },
      {
        title: 'Step 2: Copy API Key & Secret',
        description: 'Under Keys and Tokens, generate your Consumer API Key and API Secret Key.',
      },
      {
        title: 'Step 3: Paste into AgentForge',
        description: 'Enter your API Keys into the X bridge configuration modal or set environment variable X_API_KEY.',
      },
    ],
    testCommand: 'node dist/cli/index.js auth status',
    configPath: '/catalog',
  },
  {
    id: 'cloudflare',
    title: 'Cloudflare Edge DNS & Workers',
    serviceName: 'Cloudflare REST API',
    category: 'cloud',
    difficulty: 'Super Easy (1 Min)',
    difficultyColor: 'text-success-500 bg-success-500/10 border-success-500/30',
    description: 'Manage DNS records (A, CNAME, TXT), SSL certificates, and edge serverless workers.',
    iconBg: 'bg-orange-500/10',
    iconColor: 'text-orange-500',
    icon: '⚡',
    prerequisites: ['Cloudflare account'],
    steps: [
      {
        title: 'Step 1: Open Cloudflare API Tokens',
        description: 'Log into Cloudflare, go to My Profile → API Tokens, and click "Create Token".',
        actionText: 'Cloudflare Tokens',
        actionUrl: 'https://dash.cloudflare.com/profile/api-tokens',
      },
      {
        title: 'Step 2: Select "Edit zone DNS"',
        description: 'Click "Use template" next to "Edit zone DNS" and select your target domain zone.',
      },
      {
        title: 'Step 3: Copy token & paste in AgentForge',
        description: 'Copy your generated token, paste it into Cloudflare Configure in AgentForge, and click Save.',
      },
    ],
    testCommand: 'node -e "fetch(\'http://localhost:9470/api/bridges\').then(r=>r.json()).then(console.log)"',
    configPath: '/catalog',
  },
  {
    id: 'hostinger',
    title: 'Hostinger Cloud Hosting',
    serviceName: 'Hostinger API',
    category: 'cloud',
    difficulty: 'Super Easy (1 Min)',
    difficultyColor: 'text-success-500 bg-success-500/10 border-success-500/30',
    description: 'Automate website deployment, web hosting management, and DNS records on Hostinger.',
    iconBg: 'bg-purple-600/10',
    iconColor: 'text-purple-500',
    icon: '🌐',
    prerequisites: ['Hostinger account with active hosting plan'],
    steps: [
      {
        title: 'Step 1: Open Hostinger hPanel',
        description: 'Log into your Hostinger control panel (hPanel) and navigate to Account Settings.',
        actionText: 'Hostinger hPanel',
        actionUrl: 'https://hpanel.hostinger.com',
      },
      {
        title: 'Step 2: Generate API Token',
        description: 'Under Access Management or API Tokens, create a token with DNS and Hosting permissions.',
      },
      {
        title: 'Step 3: Paste in AgentForge Configure',
        description: 'Paste your token into the Hostinger Configure modal in AgentForge and click Save.',
      },
    ],
    testCommand: 'node -e "console.log(\'Hostinger Bridge Ready\')"',
    configPath: '/catalog',
  },
  {
    id: 'northwest',
    title: 'Northwest Domain Registrar & DNS',
    serviceName: 'Northwest Registered Agent API',
    category: 'cloud',
    difficulty: 'Super Easy (1 Min)',
    difficultyColor: 'text-success-500 bg-success-500/10 border-success-500/30',
    description: 'Inspect domain registration, manage nameservers, and verify SSL records for hamzashaikhai.com and other domains.',
    iconBg: 'bg-emerald-600/10',
    iconColor: 'text-emerald-500',
    icon: '🌲',
    prerequisites: ['Northwest account'],
    steps: [
      {
        title: 'Step 1: Open Northwest Client Portal',
        description: 'Log into your Northwest Registered Agent portal and go to Domain Management.',
      },
      {
        title: 'Step 2: Copy API Token',
        description: 'Generate your API token under Developer Settings.',
      },
      {
        title: 'Step 3: Save in AgentForge',
        description: 'Paste into Northwest Configure in the AgentForge Catalog.',
      },
    ],
    testCommand: 'node -e "console.log(\'Northwest Registrar Bridge Ready\')"',
    configPath: '/catalog',
  },
  {
    id: 'higgsfield',
    title: 'Higgsfield AI Video Studio',
    serviceName: 'Higgsfield Video API',
    category: 'media',
    difficulty: 'Super Easy (1 Min)',
    difficultyColor: 'text-success-500 bg-success-500/10 border-success-500/30',
    description: 'Generate high-fidelity AI video animations and cinematic character videos.',
    iconBg: 'bg-brand-500/10',
    iconColor: 'text-brand-500',
    icon: '🎥',
    prerequisites: ['Higgsfield account'],
    steps: [
      {
        title: 'Step 1: Open Higgsfield Portal',
        description: 'Log into higgsfield.ai and go to the Developer / API section.',
        actionText: 'Higgsfield Portal',
        actionUrl: 'https://higgsfield.ai',
      },
      {
        title: 'Step 2: Copy API Key',
        description: 'Generate and copy your HIGGSFIELD_API_KEY.',
      },
      {
        title: 'Step 3: Paste in AgentForge',
        description: 'Open Catalog → Higgsfield → Configure → Paste Key and click Save.',
      },
    ],
    testCommand: 'node -e "console.log(\'Higgsfield Video Studio Ready\')"',
    configPath: '/catalog',
  },
  {
    id: 'reddit',
    title: 'Reddit Community Dispatcher',
    serviceName: 'Reddit OAuth2 Script API',
    category: 'social',
    difficulty: 'Easy (2 Mins)',
    difficultyColor: 'text-brand-500 bg-brand-500/10 border-brand-500/30',
    description: 'Publish autonomous discussions, announcements, and comments across targeted subreddits.',
    iconBg: 'bg-orange-600/10',
    iconColor: 'text-orange-500',
    icon: '🤖',
    prerequisites: ['Reddit Account'],
    steps: [
      {
        title: 'Step 1: Open Reddit App Preferences',
        description: 'Go to reddit.com/prefs/apps and click "are you a developer? create an app...".',
        actionText: 'Reddit App Settings',
        actionUrl: 'https://www.reddit.com/prefs/apps',
      },
      {
        title: 'Step 2: Create a "script" app',
        description: 'Enter a name, select "script", and set redirect URI to http://localhost:9470.',
        codeSnippet: 'http://localhost:9470',
      },
      {
        title: 'Step 3: Copy Client ID & Secret',
        description: 'Copy the Client ID (shown right under the app name) and the Secret key into AgentForge.',
      },
    ],
    testCommand: 'node -e "console.log(\'Reddit Dispatcher Active\')"',
    configPath: '/catalog',
  },
  {
    id: 'exa',
    title: 'Exa Neural Web Search',
    serviceName: 'Exa AI Search API',
    category: 'dev',
    difficulty: 'Super Easy (1 Min)',
    difficultyColor: 'text-success-500 bg-success-500/10 border-success-500/30',
    description: 'Neural web search engine designed specifically for AI agents, research, and company intelligence.',
    iconBg: 'bg-cyan-500/10',
    iconColor: 'text-cyan-400',
    icon: '🔍',
    prerequisites: ['Exa account (free tier available)'],
    steps: [
      {
        title: 'Step 1: Sign up at Exa.ai',
        description: 'Go to exa.ai and open the API dashboard.',
        actionText: 'Exa Dashboard',
        actionUrl: 'https://exa.ai',
      },
      {
        title: 'Step 2: Copy API Key',
        description: 'Copy your API key from the dashboard.',
      },
      {
        title: 'Step 3: Save in AgentForge',
        description: 'Paste into Exa Configure modal in AgentForge.',
      },
    ],
    testCommand: 'node -e "console.log(\'Exa Search Bridge Active\')"',
    configPath: '/catalog',
  },
  {
    id: 'context7',
    title: 'Context7 Code Intelligence',
    serviceName: 'Native AST & Semantic Indexer',
    category: 'dev',
    difficulty: 'Zero Config',
    difficultyColor: 'text-success-500 bg-success-500/10 border-success-500/30',
    description: 'Ultra-fast AST syntax tree parsing, symbol cross-references, and semantic code search for agents.',
    iconBg: 'bg-emerald-500/10',
    iconColor: 'text-emerald-400',
    icon: '🧠',
    prerequisites: ['Included natively in AgentForge'],
    steps: [
      {
        title: 'Step 1: Pre-installed & Ready',
        description: 'Context7 is built directly into AgentForge. It requires zero API keys or external accounts.',
      },
      {
        title: 'Step 2: Automatically indexes your code',
        description: 'Whenever you run agents or workflows, Context7 maps your TypeScript/JavaScript codebase automatically.',
      },
    ],
    testCommand: 'node -e "console.log(\'Context7 Indexer Active\')"',
    configPath: '/catalog',
  },
  {
    id: 'playwright',
    title: 'Playwright Browser Automation',
    serviceName: 'Headless Chromium Engine',
    category: 'dev',
    difficulty: 'Zero Config',
    difficultyColor: 'text-success-500 bg-success-500/10 border-success-500/30',
    description: 'Autonomous headless browser navigation, form submission, and web scraping with anti-bot bypass.',
    iconBg: 'bg-green-600/10',
    iconColor: 'text-green-500',
    icon: '🎭',
    prerequisites: ['Pre-installed Chromium'],
    steps: [
      {
        title: 'Step 1: Pre-configured in AgentForge',
        description: 'Playwright is bundled and configured with local Chrome binaries out of the box.',
      },
      {
        title: 'Step 2: Ready for automated workflows',
        description: 'Use Playwright actions directly in your workflows with zero setup required.',
      },
    ],
    testCommand: 'node -e "console.log(\'Playwright Automation Engine Active\')"',
    configPath: '/catalog',
  },
  {
    id: 'supabase',
    title: 'Supabase Database & Auth',
    serviceName: 'Supabase PostgreSQL & Vector API',
    category: 'db',
    difficulty: 'Super Easy (1 Min)',
    difficultyColor: 'text-success-500 bg-success-500/10 border-success-500/30',
    description: 'Postgres database queries, vector memory embeddings, user authentication, and real-time tables.',
    iconBg: 'bg-emerald-500/10',
    iconColor: 'text-emerald-500',
    icon: '⚡',
    prerequisites: ['Supabase account and project'],
    steps: [
      {
        title: 'Step 1: Open Supabase Dashboard',
        description: 'Go to your project in supabase.com/dashboard and click Project Settings → API.',
        actionText: 'Supabase Dashboard',
        actionUrl: 'https://supabase.com/dashboard',
      },
      {
        title: 'Step 2: Copy URL & Service Role Key',
        description: 'Copy your Project URL and the service_role secret key (or anon public key).',
      },
      {
        title: 'Step 3: Save in AgentForge',
        description: 'Paste your URL and key into Supabase Configure in AgentForge.',
      },
    ],
    testCommand: 'node -e "console.log(\'Supabase Bridge Active\')"',
    configPath: '/catalog',
  },
  {
    id: 'github',
    title: 'GitHub & Git Version Control',
    serviceName: 'GitHub REST API & Git CLI',
    category: 'dev',
    difficulty: 'Super Easy (1 Min)',
    difficultyColor: 'text-success-500 bg-success-500/10 border-success-500/30',
    description: 'Autonomous Git branches, commits, pull requests, release tagging, and issue management.',
    iconBg: 'bg-zinc-700/10',
    iconColor: 'text-zinc-300',
    icon: '🐙',
    prerequisites: ['GitHub account'],
    steps: [
      {
        title: 'Step 1: Create a Personal Access Token',
        description: 'In GitHub, go to Settings → Developer Settings → Personal Access Tokens → Tokens (classic).',
        actionText: 'GitHub Tokens',
        actionUrl: 'https://github.com/settings/tokens',
      },
      {
        title: 'Step 2: Select "repo" and "workflow" scopes',
        description: 'Check the "repo" scope checkbox so AgentForge can create branches and commits.',
      },
      {
        title: 'Step 3: Save in AgentForge',
        description: 'Paste your token into GitHub Configure or set environment variable GITHUB_TOKEN.',
      },
    ],
    testCommand: 'git status',
    configPath: '/catalog',
  },
  {
    id: 'wordpress',
    title: 'WordPress CMS & Blogging',
    serviceName: 'WordPress REST API',
    category: 'project',
    difficulty: 'Super Easy (1 Min)',
    difficultyColor: 'text-success-500 bg-success-500/10 border-success-500/30',
    description: 'Publish articles, create pages, upload media attachments, and manage post categories.',
    iconBg: 'bg-sky-600/10',
    iconColor: 'text-sky-500',
    icon: '📝',
    prerequisites: ['WordPress site with admin access'],
    steps: [
      {
        title: 'Step 1: Open WordPress Profile',
        description: 'Log into your WordPress admin dashboard, click Users → Profile, and scroll to "Application Passwords".',
      },
      {
        title: 'Step 2: Add Application Password',
        description: 'Enter "AgentForge" as the password name and click "Add New Application Password".',
      },
      {
        title: 'Step 3: Copy & Save',
        description: 'Copy the generated 24-character password and enter your site URL and username in AgentForge.',
      },
    ],
    testCommand: 'node -e "console.log(\'WordPress Bridge Active\')"',
    configPath: '/catalog',
  },
  {
    id: 'jira',
    title: 'Jira / Atlassian Project Management',
    serviceName: 'Atlassian Jira Cloud REST API',
    category: 'project',
    difficulty: 'Super Easy (1 Min)',
    difficultyColor: 'text-success-500 bg-success-500/10 border-success-500/30',
    description: 'Create and track software tickets, update sprint boards, and assign bug fixes autonomously.',
    iconBg: 'bg-blue-600/10',
    iconColor: 'text-blue-500',
    icon: '📊',
    prerequisites: ['Atlassian Jira account'],
    steps: [
      {
        title: 'Step 1: Open Atlassian API Tokens',
        description: 'Go to id.atlassian.com/manage-profile/security/api-tokens and click "Create API token".',
        actionText: 'Atlassian API Tokens',
        actionUrl: 'https://id.atlassian.com/manage-profile/security/api-tokens',
      },
      {
        title: 'Step 2: Copy Token',
        description: 'Label your token "AgentForge" and copy the token string.',
      },
      {
        title: 'Step 3: Save in AgentForge',
        description: 'Enter your Atlassian email and Jira domain (e.g. yourcompany.atlassian.net) in AgentForge.',
      },
    ],
    testCommand: 'node -e "console.log(\'Jira Bridge Active\')"',
    configPath: '/catalog',
  },
  {
    id: 'slack',
    title: 'Slack Bot & Team Notifications',
    serviceName: 'Slack Web API',
    category: 'project',
    difficulty: 'Super Easy (1 Min)',
    difficultyColor: 'text-success-500 bg-success-500/10 border-success-500/30',
    description: 'Send automated channel messages, build notifications, approval requests, and thread replies.',
    iconBg: 'bg-emerald-600/10',
    iconColor: 'text-emerald-500',
    icon: '💬',
    prerequisites: ['Slack Workspace with permission to install apps'],
    steps: [
      {
        title: 'Step 1: Open Slack Apps',
        description: 'Go to api.slack.com/apps and click "Create New App" → "From scratch".',
        actionText: 'Slack Apps Portal',
        actionUrl: 'https://api.slack.com/apps',
      },
      {
        title: 'Step 2: Add Bot Scopes',
        description: 'Under OAuth & Permissions, add chat:write and channels:read scopes.',
      },
      {
        title: 'Step 3: Copy Bot Token',
        description: 'Install app to your workspace and copy the Bot User OAuth Token (starts with xoxb-).',
      },
    ],
    testCommand: 'node -e "console.log(\'Slack Bridge Active\')"',
    configPath: '/catalog',
  },
  {
    id: 'discord',
    title: 'Discord Bot & Webhooks',
    serviceName: 'Discord Webhook API',
    category: 'project',
    difficulty: 'Super Easy (1 Min)',
    difficultyColor: 'text-success-500 bg-success-500/10 border-success-500/30',
    description: 'Send rich embed notifications, workflow status updates, and alerts to any Discord channel.',
    iconBg: 'bg-indigo-600/10',
    iconColor: 'text-indigo-400',
    icon: '🎮',
    prerequisites: ['Discord server with webhook permissions'],
    steps: [
      {
        title: 'Step 1: Open Server Settings',
        description: 'In your Discord server, right-click your channel → Edit Channel → Integrations → Webhooks.',
      },
      {
        title: 'Step 2: Create Webhook',
        description: 'Click "New Webhook", name it "AgentForge", and click "Copy Webhook URL".',
      },
      {
        title: 'Step 3: Paste in AgentForge',
        description: 'Paste the Webhook URL into the Discord Configure modal in AgentForge.',
      },
    ],
    testCommand: 'node -e "console.log(\'Discord Webhook Bridge Active\')"',
    configPath: '/catalog',
  },
  {
    id: 'stripe',
    title: 'Stripe Billing & Payments',
    serviceName: 'Stripe REST API',
    category: 'project',
    difficulty: 'Super Easy (1 Min)',
    difficultyColor: 'text-success-500 bg-success-500/10 border-success-500/30',
    description: 'Inspect invoices, generate payment checkout links, and view customer subscription statuses.',
    iconBg: 'bg-indigo-500/10',
    iconColor: 'text-indigo-500',
    icon: '💳',
    prerequisites: ['Stripe Account'],
    steps: [
      {
        title: 'Step 1: Open Stripe Dashboard',
        description: 'Go to dashboard.stripe.com, switch to Test Mode (or Live Mode), and click Developers → API Keys.',
        actionText: 'Stripe API Keys',
        actionUrl: 'https://dashboard.stripe.com/test/apikeys',
      },
      {
        title: 'Step 2: Copy Secret Key',
        description: 'Click to reveal and copy your Secret Key (starts with sk_test_ or sk_live_).',
      },
      {
        title: 'Step 3: Save in AgentForge',
        description: 'Paste into Stripe Configure in AgentForge.',
      },
    ],
    testCommand: 'node -e "console.log(\'Stripe Bridge Active\')"',
    configPath: '/catalog',
  },
  {
    id: 'notion',
    title: 'Notion Workspace & Docs',
    serviceName: 'Notion API',
    category: 'project',
    difficulty: 'Super Easy (1 Min)',
    difficultyColor: 'text-success-500 bg-success-500/10 border-success-500/30',
    description: 'Create pages, update project task databases, and read workspace documentation.',
    iconBg: 'bg-zinc-600/10',
    iconColor: 'text-zinc-400',
    icon: '📓',
    prerequisites: ['Notion Account'],
    steps: [
      {
        title: 'Step 1: Open Notion Integrations',
        description: 'Go to notion.so/my-integrations and click "New integration".',
        actionText: 'Notion Integrations',
        actionUrl: 'https://www.notion.so/my-integrations',
      },
      {
        title: 'Step 2: Copy Internal Secret',
        description: 'Copy the Internal Integration Secret token (starts with secret_).',
      },
      {
        title: 'Step 3: Connect to your page & save',
        description: 'In Notion, open your database or page, click "..." → Connections → Add your integration. Paste token in AgentForge.',
      },
    ],
    testCommand: 'node -e "console.log(\'Notion Bridge Active\')"',
    configPath: '/catalog',
  },
];

export function Tutorials() {
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>('google-flow');
  const [copiedSnippet, setCopiedSnippet] = useState<string | null>(null);

  const filteredTutorials = TUTORIALS.filter((t) => {
    const matchesCategory = activeCategory === 'all' || t.category === activeCategory;
    const matchesQuery =
      !searchQuery.trim() ||
      t.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.serviceName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.description.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCategory && matchesQuery;
  });

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedSnippet(id);
    toast.success('Copied to clipboard!');
    setTimeout(() => setCopiedSnippet(null), 2000);
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto pb-12 animate-fade-in">
      {/* Header Banner */}
      <div className="p-6 sm:p-8 rounded-2xl bg-gradient-brand text-white shadow-lg relative overflow-hidden">
        <div className="relative z-10 max-w-2xl">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/20 backdrop-blur-sm text-tiny font-bold uppercase tracking-wider mb-3">
            <Sparkles className="w-3.5 h-3.5" /> Kid-Friendly Step-by-Step Guides
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
            How to Connect Every MCP & Bridge in 60 Seconds
          </h1>
          <p className="text-sm text-white/85 mt-2 leading-relaxed">
            Simple, crystal-clear instructions for every integration in AgentForge. Follow the numbered steps below to link your accounts, obtain free API tokens, and start running autonomous workflows right away!
          </p>
        </div>
        <div className="absolute right-4 bottom-2 text-7xl opacity-20 pointer-events-none select-none hidden sm:block">
          📚
        </div>
      </div>

      {/* Search & Category Filter */}
      <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
        {/* Categories */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 scrollbar-none">
          {CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setActiveCategory(cat.id)}
              className={cn(
                'px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all',
                activeCategory === cat.id
                  ? 'bg-gradient-brand text-white shadow-sm ring-1 ring-brand-500/50'
                  : 'bg-card text-muted hover:text-primary hover:bg-hover border border-subtle'
              )}
            >
              {cat.label}
            </button>
          ))}
        </div>

        {/* Search Input */}
        <div className="relative w-full sm:w-64">
          <Search className="w-4 h-4 text-muted absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            className="input pl-9 h-9 text-xs w-full"
            placeholder="Search guides..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* Guides List */}
      <div className="space-y-4">
        {filteredTutorials.map((tutorial) => {
          const isExpanded = expandedId === tutorial.id;

          return (
            <div
              key={tutorial.id}
              className={cn(
                'card rounded-2xl border transition-all overflow-hidden bg-card',
                isExpanded ? 'border-brand/40 shadow-md ring-1 ring-brand/20' : 'border-subtle hover:border-default hover:shadow-sm'
              )}
            >
              {/* Card Header */}
              <div
                className="p-5 flex items-center justify-between cursor-pointer select-none"
                onClick={() => setExpandedId(isExpanded ? null : tutorial.id)}
              >
                <div className="flex items-center gap-3.5 min-w-0">
                  <div className={cn('w-12 h-12 rounded-xl flex items-center justify-center text-2xl flex-shrink-0 shadow-sm border border-hairline', tutorial.iconBg)}>
                    {tutorial.icon}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h2 className="text-base font-bold text-primary truncate">{tutorial.title}</h2>
                      <span className={cn('badge text-[10px] font-semibold border', tutorial.difficultyColor)}>
                        {tutorial.difficulty}
                      </span>
                    </div>
                    <p className="text-xs text-muted mt-0.5 line-clamp-1">{tutorial.description}</p>
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-shrink-0 ml-3">
                  <Link
                    to={tutorial.configPath || '/catalog'}
                    onClick={(e) => e.stopPropagation()}
                    className="btn btn-secondary btn-xs text-tiny gap-1 hidden sm:flex"
                  >
                    Configure
                    <ArrowRight className="w-3 h-3" />
                  </Link>
                  <button
                    type="button"
                    className="btn btn-ghost btn-xs p-1.5 text-muted hover:text-primary rounded-lg"
                    aria-label={isExpanded ? 'Collapse' : 'Expand'}
                  >
                    {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Expanded Tutorial Details */}
              {isExpanded && (
                <div className="border-t border-subtle bg-base/50 p-5 sm:p-6 space-y-5 animate-fade-in">
                  {/* Prerequisites */}
                  <div className="p-3 rounded-xl bg-hover border border-hairline text-xs space-y-1.5">
                    <div className="font-bold text-secondary uppercase tracking-wider text-[10px] flex items-center gap-1.5">
                      <Key className="w-3 h-3 text-brand-500" /> What you need before starting:
                    </div>
                    <ul className="list-disc list-inside space-y-0.5 text-muted text-[11px]">
                      {tutorial.prerequisites.map((p, idx) => (
                        <li key={idx}>{p}</li>
                      ))}
                    </ul>
                  </div>

                  {/* Step-by-Step Instructions */}
                  <div className="space-y-3">
                    <div className="text-xs font-bold text-primary uppercase tracking-wider">
                      Follow these simple steps:
                    </div>
                    <div className="grid grid-cols-1 gap-2.5">
                      {tutorial.steps.map((step, sIdx) => (
                        <div
                          key={sIdx}
                          className="p-3.5 rounded-xl bg-card border border-subtle flex items-start gap-3 relative"
                        >
                          <div className="w-6 h-6 rounded-full bg-brand-500/15 text-brand-500 font-extrabold text-xs flex items-center justify-center flex-shrink-0 mt-0.5">
                            {sIdx + 1}
                          </div>
                          <div className="flex-1 min-w-0 space-y-1">
                            <div className="text-xs font-bold text-primary flex items-center justify-between flex-wrap gap-2">
                              <span>{step.title}</span>
                              {step.actionUrl && (
                                <a
                                  href={step.actionUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-[11px] text-brand-500 hover:underline inline-flex items-center gap-1 font-semibold"
                                >
                                  {step.actionText || 'Open Website'}
                                  <ExternalLink className="w-3 h-3" />
                                </a>
                              )}
                            </div>
                            <p className="text-[11px] text-muted leading-relaxed">{step.description}</p>
                            {step.codeSnippet && (
                              <div className="pt-1">
                                <div className="flex items-center justify-between p-2 rounded-lg bg-base border border-hairline font-mono text-tiny text-secondary">
                                  <span className="truncate select-all">{step.codeSnippet}</span>
                                  <button
                                    type="button"
                                    onClick={() => handleCopy(step.codeSnippet!, `${tutorial.id}-step-${sIdx}`)}
                                    className="btn btn-ghost btn-xs p-1 text-muted hover:text-primary ml-2 flex-shrink-0"
                                  >
                                    {copiedSnippet === `${tutorial.id}-step-${sIdx}` ? <Check className="w-3 h-3 text-success-500" /> : <Copy className="w-3 h-3" />}
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Verification / Test command */}
                  <div className="p-3.5 rounded-xl bg-hover border border-subtle space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-secondary flex items-center gap-1.5">
                        <Terminal className="w-3.5 h-3.5 text-tech-500" /> How to Test & Verify in Terminal:
                      </span>
                      <button
                        type="button"
                        onClick={() => handleCopy(tutorial.testCommand, `${tutorial.id}-cmd`)}
                        className="btn btn-secondary btn-xs text-tiny gap-1"
                      >
                        {copiedSnippet === `${tutorial.id}-cmd` ? <Check className="w-3 h-3 text-success-500" /> : <Copy className="w-3 h-3" />}
                        {copiedSnippet === `${tutorial.id}-cmd` ? 'Copied!' : 'Copy Command'}
                      </button>
                    </div>
                    <div className="p-2 rounded-lg bg-base border border-hairline font-mono text-tiny text-primary select-all overflow-x-auto">
                      {tutorial.testCommand}
                    </div>
                  </div>

                  {/* Bottom Action */}
                  <div className="flex items-center justify-between pt-1">
                    <span className="text-tiny text-muted">
                      Need help? Click Configure to connect or check diagnostics.
                    </span>
                    <Link
                      to={tutorial.configPath || '/catalog'}
                      className="btn btn-primary btn-sm gap-1.5"
                    >
                      Configure {tutorial.title}
                      <ArrowRight className="w-3.5 h-3.5" />
                    </Link>
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {filteredTutorials.length === 0 && (
          <div className="card p-12 text-center text-muted border border-subtle rounded-2xl">
            <BookOpen className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <h3 className="text-base font-bold text-primary">No guides found</h3>
            <p className="text-xs mt-1">Try searching with a different keyword or category.</p>
          </div>
        )}
      </div>
    </div>
  );
}
export default Tutorials;
