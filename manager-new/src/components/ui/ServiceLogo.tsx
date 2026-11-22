import React from 'react';

export interface ServiceBrand {
  name: string;
  displayName: string;
  accentColor: string;
  borderHover: string;
  badgeBg: string;
  glowGradient: string;
  logo: React.ReactNode;
}

export const SERVICE_BRANDS: Record<string, ServiceBrand> = {
  northwest: {
    name: 'northwest',
    displayName: 'Northwest Registered Agent',
    accentColor: '#003366',
    borderHover: 'hover:border-[#0055a5]/60 hover:shadow-[0_0_20px_-3px_rgba(0,85,165,0.25)]',
    badgeBg: 'bg-[#002244]',
    glowGradient: 'radial-gradient(ellipse 80% 50% at 50% -20%, rgba(0, 85, 165, 0.18) 0%, transparent 70%)',
    logo: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 2L3 7V12C3 17.5 6.8 21.7 12 23C17.2 21.7 21 17.5 21 12V7L12 2Z" fill="#0055A5" fillOpacity="0.2" stroke="#38BDF8" strokeWidth="1.8" strokeLinejoin="round"/>
        <path d="M12 6L14.5 11L20 12L15.5 15.5L17 21L12 18L7 21L8.5 15.5L4 12L9.5 11L12 6Z" fill="#38BDF8" fillOpacity="0.3" stroke="#38BDF8" strokeWidth="1.2"/>
        <circle cx="12" cy="13" r="2.5" fill="#38BDF8"/>
      </svg>
    ),
  },
  wordpress: {
    name: 'wordpress',
    displayName: 'WordPress',
    accentColor: '#21759B',
    borderHover: 'hover:border-[#21759B]/60 hover:shadow-[0_0_20px_-3px_rgba(33,117,155,0.25)]',
    badgeBg: 'bg-[#133d52]',
    glowGradient: 'radial-gradient(ellipse 80% 50% at 50% -20%, rgba(33, 117, 155, 0.2) 0%, transparent 70%)',
    logo: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="12" cy="12" r="10" stroke="#00AADC" strokeWidth="1.8" fill="#0073AA" fillOpacity="0.15"/>
        <path d="M3.2 12C3.2 16.2 6.1 19.7 10 20.6L5.9 8.6C4.2 9.6 3.2 11.2 3.2 12ZM16.8 11.7C16.8 10.3 16.3 9.3 15.7 8.3C14.9 7 14.1 6 12.8 6C12.5 6 12.1 6.1 11.8 6.2L16.2 18.8C18.9 17.4 20.8 14.6 20.8 12C20.8 10.8 20.5 9.7 20 8.7L16.8 11.7ZM12 4.2C9.4 4.2 7.1 5.3 5.6 7.1L9.6 18.2L12.5 9.8L10.7 9.8L10.7 9.2L14.7 9.2L14.7 9.8L13.3 9.8L15.3 15.3L17.2 9.8L16.3 9.8L16.3 9.2L19.3 9.2L19.3 9.8L18 9.8L14.6 18.9C13.8 19.5 12.9 19.8 12 19.8C11.6 19.8 11.2 19.7 10.8 19.6L12 16.1L12 4.2Z" fill="#38BDF8"/>
      </svg>
    ),
  },
  cloudflare: {
    name: 'cloudflare',
    displayName: 'Cloudflare',
    accentColor: '#F38020',
    borderHover: 'hover:border-[#F38020]/60 hover:shadow-[0_0_20px_-3px_rgba(243,128,32,0.25)]',
    badgeBg: 'bg-[#402008]',
    glowGradient: 'radial-gradient(ellipse 80% 50% at 50% -20%, rgba(243, 128, 32, 0.22) 0%, transparent 70%)',
    logo: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M19.4 13.2C19.2 10.4 16.9 8.2 14.1 8.2C13.6 8.2 13 8.3 12.5 8.6C11.7 6.8 9.9 5.5 7.8 5.5C5.1 5.5 2.9 7.4 2.5 10C1 10.4 0 11.8 0 13.4C0 15.4 1.6 17 3.6 17H19.2C20.8 17 22 15.8 22 14.2C22 13.7 21.8 13.3 21.6 12.9" fill="#FAAD3F" fillOpacity="0.2"/>
        <path d="M18.8 11.8C18.6 9.6 16.8 8 14.6 8C14.1 8 13.6 8.1 13.2 8.3C12.4 6.7 10.7 5.7 8.8 5.7C6.3 5.7 4.2 7.5 3.8 10C2.5 10.4 1.5 11.6 1.5 13C1.5 14.7 2.8 16 4.5 16H18.8C20 16 21 15 21 13.8C21 12.8 20.1 11.9 18.8 11.8Z" stroke="#F38020" strokeWidth="1.8" strokeLinejoin="round"/>
        <path d="M15.5 16H18.8C19.7 16 20.5 15.3 20.5 14.3C20.5 13.5 19.9 12.8 19 12.6L18.4 12.5L18.4 11.9C18.4 10.2 17 8.8 15.3 8.8C14.9 8.8 14.5 8.9 14.2 9.1" stroke="#FAAD3F" strokeWidth="1.4"/>
      </svg>
    ),
  },
  hostinger: {
    name: 'hostinger',
    displayName: 'Hostinger',
    accentColor: '#673DE6',
    borderHover: 'hover:border-[#673DE6]/60 hover:shadow-[0_0_20px_-3px_rgba(103,61,230,0.25)]',
    badgeBg: 'bg-[#221052]',
    glowGradient: 'radial-gradient(ellipse 80% 50% at 50% -20%, rgba(103, 61, 230, 0.22) 0%, transparent 70%)',
    logo: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="24" height="24" rx="6" fill="#673DE6" fillOpacity="0.2" stroke="#673DE6" strokeWidth="1.5"/>
        <path d="M7 6V18M17 6V18M7 12H17" stroke="#A78BFA" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
        <circle cx="12" cy="7" r="1.5" fill="#C4B5FD"/>
      </svg>
    ),
  },
  'google-flow': {
    name: 'google-flow',
    displayName: 'Google Flow Media Studio',
    accentColor: '#4285F4',
    borderHover: 'hover:border-[#4285F4]/60 hover:shadow-[0_0_20px_-3px_rgba(66,133,244,0.3)]',
    badgeBg: 'bg-[#0d1f3d]',
    glowGradient: 'radial-gradient(ellipse 80% 50% at 50% -20%, rgba(66, 133, 244, 0.25) 0%, transparent 70%)',
    logo: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 2C12 7.5 7.5 12 2 12C7.5 12 12 16.5 12 22C12 16.5 16.5 12 22 12C16.5 12 12 7.5 12 2Z" fill="#4285F4" fillOpacity="0.3" stroke="#60A5FA" strokeWidth="1.4"/>
        <circle cx="18" cy="6" r="2.2" fill="#34A853"/>
        <circle cx="6" cy="18" r="1.8" fill="#EA4335"/>
        <circle cx="18" cy="18" r="1.8" fill="#FBBC05"/>
      </svg>
    ),
  },
  youtube: {
    name: 'youtube',
    displayName: 'YouTube',
    accentColor: '#FF0000',
    borderHover: 'hover:border-[#FF0000]/60 hover:shadow-[0_0_20px_-3px_rgba(255,0,0,0.25)]',
    badgeBg: 'bg-[#3b0808]',
    glowGradient: 'radial-gradient(ellipse 80% 50% at 50% -20%, rgba(255, 0, 0, 0.22) 0%, transparent 70%)',
    logo: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="2" y="5" width="20" height="14" rx="4" fill="#FF0000" fillOpacity="0.2" stroke="#FF0000" strokeWidth="1.8"/>
        <path d="M10 9L15 12L10 15V9Z" fill="#FF4444" stroke="#FF0000" strokeWidth="1"/>
      </svg>
    ),
  },
  github: {
    name: 'github',
    displayName: 'GitHub',
    accentColor: '#6e5494',
    borderHover: 'hover:border-[#9370DB]/60 hover:shadow-[0_0_20px_-3px_rgba(147,112,219,0.25)]',
    badgeBg: 'bg-[#1b1928]',
    glowGradient: 'radial-gradient(ellipse 80% 50% at 50% -20%, rgba(147, 112, 219, 0.2) 0%, transparent 70%)',
    logo: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017C2 16.446 4.87 20.198 8.84 21.52C9.34 21.61 9.52 21.3 9.52 21.03C9.52 20.79 9.51 20.16 9.51 19.32C6.73 19.92 6.14 17.98 6.14 17.98C5.68 16.83 5.03 16.52 5.03 16.52C4.12 15.9 5.1 15.91 5.1 15.91C6.1 15.98 6.63 16.94 6.63 16.94C7.52 18.47 8.97 18.03 9.54 17.77C9.63 17.12 9.89 16.68 10.17 16.43C7.95 16.18 5.62 15.32 5.62 11.5C5.62 10.41 6.01 9.52 6.65 8.82C6.55 8.57 6.21 7.55 6.75 6.19C6.75 6.19 7.59 5.92 9.5 7.21C10.3 6.99 11.15 6.88 12 6.88C12.85 6.88 13.7 6.99 14.5 7.21C16.41 5.92 17.25 6.19 17.25 6.19C17.79 7.55 17.45 8.57 17.35 8.82C17.99 9.52 18.38 10.41 18.38 11.5C18.38 15.33 16.04 16.17 13.81 16.42C14.17 16.73 14.49 17.34 14.49 18.28C14.49 19.63 14.48 20.71 14.48 21.04C14.48 21.31 14.66 21.63 15.17 21.53C19.14 20.2 22.01 16.45 22.01 12.02C22.01 6.484 17.524 2 12 2Z" fill="#E2E8F0"/>
      </svg>
    ),
  },
  'github-api': {
    name: 'github-api',
    displayName: 'GitHub REST API',
    accentColor: '#6e5494',
    borderHover: 'hover:border-[#9370DB]/60 hover:shadow-[0_0_20px_-3px_rgba(147,112,219,0.25)]',
    badgeBg: 'bg-[#1b1928]',
    glowGradient: 'radial-gradient(ellipse 80% 50% at 50% -20%, rgba(147, 112, 219, 0.2) 0%, transparent 70%)',
    logo: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 2L2 7V17L12 22L22 17V7L12 2Z" stroke="#C084FC" strokeWidth="1.8" strokeLinejoin="round"/>
        <path d="M12 22V12M12 12L2 7M12 12L22 7" stroke="#A855F7" strokeWidth="1.5"/>
      </svg>
    ),
  },
  linkedin: {
    name: 'linkedin',
    displayName: 'LinkedIn',
    accentColor: '#0A66C2',
    borderHover: 'hover:border-[#0A66C2]/60 hover:shadow-[0_0_20px_-3px_rgba(10,102,194,0.25)]',
    badgeBg: 'bg-[#05264a]',
    glowGradient: 'radial-gradient(ellipse 80% 50% at 50% -20%, rgba(10, 102, 194, 0.22) 0%, transparent 70%)',
    logo: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="2" y="2" width="20" height="20" rx="4" fill="#0A66C2" fillOpacity="0.2" stroke="#0A66C2" strokeWidth="1.8"/>
        <circle cx="7" cy="8" r="1.5" fill="#38BDF8"/>
        <path d="M5.5 11H8.5V18H5.5V11Z" fill="#38BDF8"/>
        <path d="M11 11H13.8V12.2C14.3 11.4 15.3 10.8 16.7 10.8C19.5 10.8 20 12.6 20 15V18H17V15.4C17 14.2 16.6 13.4 15.5 13.4C14.4 13.4 13.8 14.2 13.8 15.4V18H11V11Z" fill="#38BDF8"/>
      </svg>
    ),
  },
  x: {
    name: 'x',
    displayName: 'X (Twitter)',
    accentColor: '#F8FAFC',
    borderHover: 'hover:border-white/60 hover:shadow-[0_0_20px_-3px_rgba(255,255,255,0.2)]',
    badgeBg: 'bg-[#18181b]',
    glowGradient: 'radial-gradient(ellipse 80% 50% at 50% -20%, rgba(255, 255, 255, 0.12) 0%, transparent 70%)',
    logo: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M18.244 2.25H21.552L14.325 10.51L22.825 21.75H16.17L10.957 14.933L4.99 21.75H1.68L9.41 12.915L1.254 2.25H8.08L12.793 8.481L18.244 2.25ZM17.083 19.77H18.916L7.084 4.126H5.117L17.083 19.77Z" fill="#F8FAFC"/>
      </svg>
    ),
  },
  docker: {
    name: 'docker',
    displayName: 'Docker Engine',
    accentColor: '#2496ED',
    borderHover: 'hover:border-[#2496ED]/60 hover:shadow-[0_0_20px_-3px_rgba(36,150,237,0.25)]',
    badgeBg: 'bg-[#0a2e4c]',
    glowGradient: 'radial-gradient(ellipse 80% 50% at 50% -20%, rgba(36, 150, 237, 0.22) 0%, transparent 70%)',
    logo: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="5" y="8" width="2.5" height="2" rx="0.5" fill="#38BDF8"/>
        <rect x="8.5" y="8" width="2.5" height="2" rx="0.5" fill="#38BDF8"/>
        <rect x="12" y="8" width="2.5" height="2" rx="0.5" fill="#38BDF8"/>
        <rect x="8.5" y="5.5" width="2.5" height="2" rx="0.5" fill="#38BDF8"/>
        <rect x="12" y="5.5" width="2.5" height="2" rx="0.5" fill="#38BDF8"/>
        <path d="M22 13C21.8 12.8 20.5 11.5 18 11.5C17.5 11.5 17 11.6 16.5 11.8V11H2V14C2 17.5 5 20.5 9 20.5C14.5 20.5 19.5 17 21 13.5C21.5 13.5 22 13.2 22 13Z" fill="#2496ED" fillOpacity="0.2" stroke="#2496ED" strokeWidth="1.8"/>
      </svg>
    ),
  },
  discord: {
    name: 'discord',
    displayName: 'Discord',
    accentColor: '#5865F2',
    borderHover: 'hover:border-[#5865F2]/60 hover:shadow-[0_0_20px_-3px_rgba(88,101,242,0.25)]',
    badgeBg: 'bg-[#181b40]',
    glowGradient: 'radial-gradient(ellipse 80% 50% at 50% -20%, rgba(88, 101, 242, 0.22) 0%, transparent 70%)',
    logo: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M19.3 4.5C17.9 3.8 16.4 3.4 14.8 3.2C14.6 3.6 14.4 4.1 14.2 4.5C12.5 4.3 10.8 4.3 9.1 4.5C8.9 4.1 8.7 3.6 8.5 3.2C6.9 3.4 5.4 3.8 4 4.5C1.2 8.6 0.4 12.6 0.8 16.6C2.7 18 4.5 18.9 6.2 19.4C6.7 18.8 7.1 18.1 7.4 17.4C6.8 17.1 6.2 16.8 5.6 16.4C5.7 16.3 5.9 16.2 6 16.1C9.6 17.7 13.5 17.7 17.1 16.1C17.2 16.2 17.4 16.3 17.5 16.4C17 16.8 16.4 17.1 15.8 17.4C16.2 18.1 16.6 18.8 17 19.4C18.8 18.9 20.6 18 22.4 16.6C22.9 11.9 21.6 7.9 19.3 4.5ZM8.5 14C7.4 14 6.5 13 6.5 11.8C6.5 10.6 7.4 9.6 8.5 9.6C9.6 9.6 10.5 10.6 10.5 11.8C10.5 13 9.6 14 8.5 14ZM14.7 14C13.6 14 12.7 13 12.7 11.8C12.7 10.6 13.6 9.6 14.7 9.6C15.8 9.6 16.7 10.6 16.7 11.8C16.7 13 15.8 14 14.7 14Z" fill="#818CF8"/>
      </svg>
    ),
  },
  stripe: {
    name: 'stripe',
    displayName: 'Stripe',
    accentColor: '#635BFF',
    borderHover: 'hover:border-[#635BFF]/60 hover:shadow-[0_0_20px_-3px_rgba(99,91,255,0.25)]',
    badgeBg: 'bg-[#1e1b4b]',
    glowGradient: 'radial-gradient(ellipse 80% 50% at 50% -20%, rgba(99, 91, 255, 0.22) 0%, transparent 70%)',
    logo: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="2" y="2" width="20" height="20" rx="5" fill="#635BFF" fillOpacity="0.2" stroke="#635BFF" strokeWidth="1.8"/>
        <path d="M14.5 10.5C14.5 9.4 13.6 8.8 12.2 8.8C10.7 8.8 9.5 9.4 9 9.9L8.3 8.3C9.1 7.6 10.6 7 12.4 7C15.2 7 16.9 8.4 16.9 10.6C16.9 14.1 12.1 13.6 12.1 15.2C12.1 15.9 12.8 16.4 13.8 16.4C15.1 16.4 16.2 15.8 16.8 15.3L17.5 16.9C16.7 17.7 15.2 18.3 13.5 18.3C10.7 18.3 9.6 16.8 9.6 15C9.6 11.5 14.5 12.1 14.5 10.5Z" fill="#A5B4FC"/>
      </svg>
    ),
  },
  slack: {
    name: 'slack',
    displayName: 'Slack',
    accentColor: '#4A154B',
    borderHover: 'hover:border-[#E01E5A]/60 hover:shadow-[0_0_20px_-3px_rgba(224,30,90,0.25)]',
    badgeBg: 'bg-[#2a0e2b]',
    glowGradient: 'radial-gradient(ellipse 80% 50% at 50% -20%, rgba(224, 30, 90, 0.2) 0%, transparent 70%)',
    logo: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M6 14.5C4.6 14.5 3.5 13.4 3.5 12C3.5 10.6 4.6 9.5 6 9.5H8.5V14.5H6Z" fill="#E01E5A"/>
        <path d="M9.5 6C9.5 4.6 10.6 3.5 12 3.5C13.4 3.5 14.5 4.6 14.5 6V8.5H9.5V6Z" fill="#36C5F0"/>
        <path d="M18 9.5C19.4 9.5 20.5 10.6 20.5 12C20.5 13.4 19.4 14.5 18 14.5H15.5V9.5H18Z" fill="#2EB67D"/>
        <path d="M14.5 18C14.5 19.4 13.4 20.5 12 20.5C10.6 20.5 9.5 19.4 9.5 18V15.5H14.5V18Z" fill="#ECB22E"/>
      </svg>
    ),
  },
  'aws-s3': {
    name: 'aws-s3',
    displayName: 'AWS S3 Storage',
    accentColor: '#FF9900',
    borderHover: 'hover:border-[#FF9900]/60 hover:shadow-[0_0_20px_-3px_rgba(255,153,0,0.25)]',
    badgeBg: 'bg-[#3b2304]',
    glowGradient: 'radial-gradient(ellipse 80% 50% at 50% -20%, rgba(255, 153, 0, 0.2) 0%, transparent 70%)',
    logo: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 2L3 6V18L12 22L21 18V6L12 2Z" fill="#FF9900" fillOpacity="0.15" stroke="#FF9900" strokeWidth="1.8" strokeLinejoin="round"/>
        <path d="M3 6L12 10L21 6M12 10V22" stroke="#FDBA74" strokeWidth="1.5"/>
        <circle cx="12" cy="10" r="2" fill="#FF9900"/>
      </svg>
    ),
  },
  mongodb: {
    name: 'mongodb',
    displayName: 'MongoDB',
    accentColor: '#00ED64',
    borderHover: 'hover:border-[#00ED64]/60 hover:shadow-[0_0_20px_-3px_rgba(0,237,100,0.25)]',
    badgeBg: 'bg-[#032e14]',
    glowGradient: 'radial-gradient(ellipse 80% 50% at 50% -20%, rgba(0, 237, 100, 0.18) 0%, transparent 70%)',
    logo: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 2C11.5 2 11 3 10.5 4.5C8.5 10.5 6 13 6 16C6 19.3 8.7 22 12 22C15.3 22 18 19.3 18 16C18 13 15.5 10.5 13.5 4.5C13 3 12.5 2 12 2Z" fill="#00ED64" fillOpacity="0.2" stroke="#00ED64" strokeWidth="1.8"/>
        <path d="M12 3V21" stroke="#86EFAC" strokeWidth="1.2"/>
      </svg>
    ),
  },
  postgres: {
    name: 'postgres',
    displayName: 'PostgreSQL',
    accentColor: '#336791',
    borderHover: 'hover:border-[#38BDF8]/60 hover:shadow-[0_0_20px_-3px_rgba(56,189,248,0.25)]',
    badgeBg: 'bg-[#0f283d]',
    glowGradient: 'radial-gradient(ellipse 80% 50% at 50% -20%, rgba(51, 103, 145, 0.22) 0%, transparent 70%)',
    logo: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 3C7 3 3 7 3 12C3 17 7 21 12 21C14.5 21 16.8 20 18.5 18.3L15.5 15.3C14.5 16.3 13.3 17 12 17C9.2 17 7 14.8 7 12C7 9.2 9.2 7 12 7C14.8 7 17 9.2 17 12V13H19V12C19 7 15 3 12 3Z" fill="#38BDF8" fillOpacity="0.2"/>
        <circle cx="12" cy="12" r="8" stroke="#38BDF8" strokeWidth="1.8"/>
        <circle cx="10" cy="10" r="1.5" fill="#38BDF8"/>
      </svg>
    ),
  },
  redis: {
    name: 'redis',
    displayName: 'Redis',
    accentColor: '#DC382D',
    borderHover: 'hover:border-[#DC382D]/60 hover:shadow-[0_0_20px_-3px_rgba(220,56,45,0.25)]',
    badgeBg: 'bg-[#3b0b08]',
    glowGradient: 'radial-gradient(ellipse 80% 50% at 50% -20%, rgba(220, 56, 45, 0.22) 0%, transparent 70%)',
    logo: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 3L2 8L12 13L22 8L12 3Z" fill="#DC382D" fillOpacity="0.3" stroke="#DC382D" strokeWidth="1.6"/>
        <path d="M2 12L12 17L22 12" stroke="#F87171" strokeWidth="1.6"/>
        <path d="M2 16L12 21L22 16" stroke="#EF4444" strokeWidth="1.6"/>
      </svg>
    ),
  },
  notion: {
    name: 'notion',
    displayName: 'Notion',
    accentColor: '#F5F5F7',
    borderHover: 'hover:border-white/60 hover:shadow-[0_0_20px_-3px_rgba(255,255,255,0.2)]',
    badgeBg: 'bg-[#1e1e24]',
    glowGradient: 'radial-gradient(ellipse 80% 50% at 50% -20%, rgba(255, 255, 255, 0.12) 0%, transparent 70%)',
    logo: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="3" y="3" width="18" height="18" rx="4" fill="#FFFFFF" fillOpacity="0.1" stroke="#FFFFFF" strokeWidth="1.8"/>
        <path d="M7 7L13 17H16V7H14V14L9 7H7V17H9V10L14 17" fill="#F8FAFC"/>
      </svg>
    ),
  },
  linear: {
    name: 'linear',
    displayName: 'Linear',
    accentColor: '#5E6AD2',
    borderHover: 'hover:border-[#5E6AD2]/60 hover:shadow-[0_0_20px_-3px_rgba(94,106,210,0.25)]',
    badgeBg: 'bg-[#181b3b]',
    glowGradient: 'radial-gradient(ellipse 80% 50% at 50% -20%, rgba(94, 106, 210, 0.22) 0%, transparent 70%)',
    logo: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 2L2 12L12 22L22 12L12 2Z" fill="#5E6AD2" fillOpacity="0.2" stroke="#818CF8" strokeWidth="1.8" strokeLinejoin="round"/>
        <path d="M12 6L6 12L12 18L18 12L12 6Z" fill="#818CF8" fillOpacity="0.4"/>
      </svg>
    ),
  },
  jira: {
    name: 'jira',
    displayName: 'Jira',
    accentColor: '#0052CC',
    borderHover: 'hover:border-[#0052CC]/60 hover:shadow-[0_0_20px_-3px_rgba(0,82,204,0.25)]',
    badgeBg: 'bg-[#062459]',
    glowGradient: 'radial-gradient(ellipse 80% 50% at 50% -20%, rgba(0, 82, 204, 0.22) 0%, transparent 70%)',
    logo: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M11.5 2C11.5 7.5 7 12 1.5 12C7 12 11.5 16.5 11.5 22C11.5 16.5 16 12 21.5 12C16 12 11.5 7.5 11.5 2Z" fill="#2684FF" fillOpacity="0.3" stroke="#38BDF8" strokeWidth="1.8"/>
      </svg>
    ),
  },
  'brave-search': {
    name: 'brave-search',
    displayName: 'Brave Search',
    accentColor: '#FB542B',
    borderHover: 'hover:border-[#FB542B]/60 hover:shadow-[0_0_20px_-3px_rgba(251,84,43,0.25)]',
    badgeBg: 'bg-[#401206]',
    glowGradient: 'radial-gradient(ellipse 80% 50% at 50% -20%, rgba(251, 84, 43, 0.22) 0%, transparent 70%)',
    logo: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 2L4 6V11C4 16.5 7.5 21.2 12 22C16.5 21.2 20 16.5 20 11V6L12 2Z" fill="#FB542B" fillOpacity="0.2" stroke="#FB542B" strokeWidth="1.8"/>
        <circle cx="10" cy="11" r="3" stroke="#FDBA74" strokeWidth="1.5"/>
        <path d="M12.5 13.5L16 17" stroke="#FDBA74" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    ),
  },
  gitlab: {
    name: 'gitlab',
    displayName: 'GitLab',
    accentColor: '#FC6D26',
    borderHover: 'hover:border-[#FC6D26]/60 hover:shadow-[0_0_20px_-3px_rgba(252,109,38,0.25)]',
    badgeBg: 'bg-[#3b1506]',
    glowGradient: 'radial-gradient(ellipse 80% 50% at 50% -20%, rgba(252, 109, 38, 0.22) 0%, transparent 70%)',
    logo: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 21.5L2 14.2L4 4.8L7.5 14.2H16.5L20 4.8L22 14.2L12 21.5Z" fill="#FC6D26" fillOpacity="0.2" stroke="#FC6D26" strokeWidth="1.8" strokeLinejoin="round"/>
        <path d="M12 21.5L7.5 14.2H16.5L12 21.5Z" fill="#FCA326"/>
      </svg>
    ),
  },
  sentry: {
    name: 'sentry',
    displayName: 'Sentry',
    accentColor: '#362D59',
    borderHover: 'hover:border-[#FF4565]/60 hover:shadow-[0_0_20px_-3px_rgba(255,69,101,0.25)]',
    badgeBg: 'bg-[#231b3d]',
    glowGradient: 'radial-gradient(ellipse 80% 50% at 50% -20%, rgba(255, 69, 101, 0.2) 0%, transparent 70%)',
    logo: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 3C7 3 3 7 3 12C3 17 7 21 12 21C17 21 21 17 21 12" stroke="#FF4565" strokeWidth="2" strokeLinecap="round"/>
        <path d="M12 7V12L15 15" stroke="#FB7185" strokeWidth="1.8" strokeLinecap="round"/>
        <circle cx="20" cy="12" r="2" fill="#FF4565"/>
      </svg>
    ),
  },
  sendgrid: {
    name: 'sendgrid',
    displayName: 'SendGrid',
    accentColor: '#1A82E2',
    borderHover: 'hover:border-[#1A82E2]/60 hover:shadow-[0_0_20px_-3px_rgba(26,130,226,0.25)]',
    badgeBg: 'bg-[#082340]',
    glowGradient: 'radial-gradient(ellipse 80% 50% at 50% -20%, rgba(26, 130, 226, 0.2) 0%, transparent 70%)',
    logo: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="4" y="4" width="7" height="7" rx="1.5" fill="#38BDF8"/>
        <rect x="13" y="4" width="7" height="7" rx="1.5" fill="#1A82E2"/>
        <rect x="4" y="13" width="7" height="7" rx="1.5" fill="#0284C7"/>
        <rect x="13" y="13" width="7" height="7" rx="1.5" fill="#0369A1"/>
      </svg>
    ),
  },
  twilio: {
    name: 'twilio',
    displayName: 'Twilio',
    accentColor: '#F22F46',
    borderHover: 'hover:border-[#F22F46]/60 hover:shadow-[0_0_20px_-3px_rgba(242,47,70,0.25)]',
    badgeBg: 'bg-[#3b080e]',
    glowGradient: 'radial-gradient(ellipse 80% 50% at 50% -20%, rgba(242, 47, 70, 0.2) 0%, transparent 70%)',
    logo: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="12" cy="12" r="9" stroke="#F22F46" strokeWidth="1.8" fill="#F22F46" fillOpacity="0.15"/>
        <circle cx="9" cy="9" r="1.5" fill="#F87171"/>
        <circle cx="15" cy="9" r="1.5" fill="#F87171"/>
        <circle cx="9" cy="15" r="1.5" fill="#F87171"/>
        <circle cx="15" cy="15" r="1.5" fill="#F87171"/>
      </svg>
    ),
  },
  tavily: {
    name: 'tavily',
    displayName: 'Tavily AI Search',
    accentColor: '#06B6D4',
    borderHover: 'hover:border-[#06B6D4]/60 hover:shadow-[0_0_20px_-3px_rgba(6,182,212,0.25)]',
    badgeBg: 'bg-[#042830]',
    glowGradient: 'radial-gradient(ellipse 80% 50% at 50% -20%, rgba(6, 182, 212, 0.2) 0%, transparent 70%)',
    logo: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="12" cy="12" r="9" stroke="#06B6D4" strokeWidth="1.8"/>
        <path d="M12 6L14 10L18 12L14 14L12 18L10 14L6 12L10 10L12 6Z" fill="#22D3EE"/>
      </svg>
    ),
  },
  sqlite: {
    name: 'sqlite',
    displayName: 'SQLite',
    accentColor: '#003B57',
    borderHover: 'hover:border-[#38BDF8]/60 hover:shadow-[0_0_20px_-3px_rgba(56,189,248,0.25)]',
    badgeBg: 'bg-[#052130]',
    glowGradient: 'radial-gradient(ellipse 80% 50% at 50% -20%, rgba(0, 59, 87, 0.22) 0%, transparent 70%)',
    logo: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M4 6C4 4.5 7.5 3 12 3C16.5 3 20 4.5 20 6M4 6V18C4 19.5 7.5 21 12 21C16.5 21 20 19.5 20 18V6M4 6C4 7.5 7.5 9 12 9C16.5 9 20 7.5 20 6M4 12C4 13.5 7.5 15 12 15C16.5 15 20 13.5 20 12" stroke="#38BDF8" strokeWidth="1.8" strokeLinejoin="round"/>
      </svg>
    ),
  },
  filesystem: {
    name: 'filesystem',
    displayName: 'Local Filesystem',
    accentColor: '#64748B',
    borderHover: 'hover:border-slate-400/60 hover:shadow-[0_0_20px_-3px_rgba(148,163,184,0.25)]',
    badgeBg: 'bg-[#1e293b]',
    glowGradient: 'radial-gradient(ellipse 80% 50% at 50% -20%, rgba(148, 163, 184, 0.15) 0%, transparent 70%)',
    logo: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M3 6C3 4.9 3.9 4 5 4H10L12 6H19C20.1 6 21 6.9 21 8V18C21 19.1 20.1 20 19 20H5C3.9 20 3 19.1 3 18V6Z" stroke="#94A3B8" strokeWidth="1.8" strokeLinejoin="round" fill="#94A3B8" fillOpacity="0.15"/>
      </svg>
    ),
  },
  memory: {
    name: 'memory',
    displayName: 'Memory Cache',
    accentColor: '#F59E0B',
    borderHover: 'hover:border-[#F59E0B]/60 hover:shadow-[0_0_20px_-3px_rgba(245,158,11,0.25)]',
    badgeBg: 'bg-[#3b2304]',
    glowGradient: 'radial-gradient(ellipse 80% 50% at 50% -20%, rgba(245, 158, 11, 0.2) 0%, transparent 70%)',
    logo: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="4" y="4" width="16" height="16" rx="3" stroke="#F59E0B" strokeWidth="1.8" fill="#F59E0B" fillOpacity="0.15"/>
        <path d="M8 8V16M12 8V16M16 8V16" stroke="#FCD34D" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    ),
  },
  http: {
    name: 'http',
    displayName: 'HTTP & Webhooks',
    accentColor: '#10B981',
    borderHover: 'hover:border-[#10B981]/60 hover:shadow-[0_0_20px_-3px_rgba(16,185,129,0.25)]',
    badgeBg: 'bg-[#04281b]',
    glowGradient: 'radial-gradient(ellipse 80% 50% at 50% -20%, rgba(16, 185, 129, 0.2) 0%, transparent 70%)',
    logo: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="12" cy="12" r="9" stroke="#10B981" strokeWidth="1.8"/>
        <path d="M3 12H21M12 3C14.5 5.5 16 8.5 16 12C16 15.5 14.5 18.5 12 21C9.5 18.5 8 15.5 8 12C8 8.5 9.5 5.5 12 3Z" stroke="#6EE7B7" strokeWidth="1.4"/>
      </svg>
    ),
  },
  higgsfield: {
    name: 'higgsfield',
    displayName: 'Higgsfield AI Video',
    accentColor: '#8B5CF6',
    borderHover: 'hover:border-[#8B5CF6]/60 hover:shadow-[0_0_20px_-3px_rgba(139,92,246,0.25)]',
    badgeBg: 'bg-[#2e1065]',
    glowGradient: 'radial-gradient(ellipse 80% 50% at 50% -20%, rgba(139, 92, 246, 0.22) 0%, transparent 70%)',
    logo: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="2" y="4" width="20" height="16" rx="4" stroke="#8B5CF6" strokeWidth="1.8" fill="#8B5CF6" fillOpacity="0.15"/>
        <path d="M10 9L16 12L10 15V9Z" fill="#A78BFA" stroke="#C4B5FD" strokeWidth="1.2" strokeLinejoin="round"/>
        <circle cx="18" cy="7" r="1.5" fill="#F43F5E"/>
      </svg>
    ),
  },
  playwright: {
    name: 'playwright',
    displayName: 'Playwright Automation',
    accentColor: '#2EAD33',
    borderHover: 'hover:border-[#2EAD33]/60 hover:shadow-[0_0_20px_-3px_rgba(46,173,51,0.25)]',
    badgeBg: 'bg-[#0f3612]',
    glowGradient: 'radial-gradient(ellipse 80% 50% at 50% -20%, rgba(46, 173, 51, 0.22) 0%, transparent 70%)',
    logo: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M4 6C4 4.89543 4.89543 4 6 4H18C19.1046 4 20 4.89543 20 6V18C20 19.1046 19.1046 20 18 20H6C4.89543 20 4 19.1046 4 18V6Z" stroke="#2EAD33" strokeWidth="1.8" fill="#2EAD33" fillOpacity="0.15"/>
        <path d="M8 12L11 15L16 9" stroke="#4ADE80" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
  },
  context7: {
    name: 'context7',
    displayName: 'Context7 Documentation',
    accentColor: '#0EA5E9',
    borderHover: 'hover:border-[#0EA5E9]/60 hover:shadow-[0_0_20px_-3px_rgba(14,165,233,0.25)]',
    badgeBg: 'bg-[#082f49]',
    glowGradient: 'radial-gradient(ellipse 80% 50% at 50% -20%, rgba(14, 165, 233, 0.22) 0%, transparent 70%)',
    logo: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" stroke="#0EA5E9" strokeWidth="1.8"/>
        <path d="M6.5 2H20V22H6.5A2.5 2.5 0 0 1 4 19.5V4.5A2.5 2.5 0 0 1 6.5 2Z" stroke="#38BDF8" strokeWidth="1.8" fill="#0EA5E9" fillOpacity="0.15"/>
        <path d="M9 7L13 11L9 15" stroke="#7DD3FC" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
  },
  supabase: {
    name: 'supabase',
    displayName: 'Supabase Cloud',
    accentColor: '#3ECF8E',
    borderHover: 'hover:border-[#3ECF8E]/60 hover:shadow-[0_0_20px_-3px_rgba(62,207,142,0.25)]',
    badgeBg: 'bg-[#06331e]',
    glowGradient: 'radial-gradient(ellipse 80% 50% at 50% -20%, rgba(62, 207, 142, 0.22) 0%, transparent 70%)',
    logo: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M13.4 2.5C13.8 1.9 14.8 2.2 14.8 2.9V10.8H20.7C21.4 10.8 21.8 11.7 21.3 12.2L11.6 22.3C11.1 22.8 10.2 22.5 10.2 21.8V13.8H4.3C3.6 13.8 3.2 12.9 3.7 12.4L13.4 2.5Z" fill="#3ECF8E" fillOpacity="0.2" stroke="#3ECF8E" strokeWidth="1.8" strokeLinejoin="round"/>
      </svg>
    ),
  },
  exa: {
    name: 'exa',
    displayName: 'Exa Neural Search',
    accentColor: '#F59E0B',
    borderHover: 'hover:border-[#F59E0B]/60 hover:shadow-[0_0_20px_-3px_rgba(245,158,11,0.25)]',
    badgeBg: 'bg-[#3b2304]',
    glowGradient: 'radial-gradient(ellipse 80% 50% at 50% -20%, rgba(245, 158, 11, 0.22) 0%, transparent 70%)',
    logo: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="12" cy="12" r="9" stroke="#F59E0B" strokeWidth="1.8" fill="#F59E0B" fillOpacity="0.15"/>
        <circle cx="12" cy="12" r="3" fill="#FCD34D"/>
        <path d="M12 3V6M12 18V21M3 12H6M18 12H21" stroke="#F59E0B" strokeWidth="1.8" strokeLinecap="round"/>
      </svg>
    ),
  },
  reddit: {
    name: 'reddit',
    displayName: 'Reddit Community Platform',
    accentColor: '#FF4500',
    borderHover: 'hover:border-[#FF4500]/60 hover:shadow-[0_0_20px_-3px_rgba(255,69,0,0.3)]',
    badgeBg: 'bg-[#3d1204]',
    glowGradient: 'radial-gradient(ellipse 80% 50% at 50% -20%, rgba(255, 69, 0, 0.25) 0%, transparent 70%)',
    logo: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="12" cy="12" r="10" fill="#FF4500" fillOpacity="0.2" stroke="#FF4500" strokeWidth="1.8"/>
        <circle cx="9" cy="12" r="1.5" fill="#FF4500"/>
        <circle cx="15" cy="12" r="1.5" fill="#FF4500"/>
        <path d="M9.5 15.5C10.2 16.2 11.1 16.5 12 16.5C12.9 16.5 13.8 16.2 14.5 15.5" stroke="#FF4500" strokeWidth="1.5" strokeLinecap="round"/>
        <path d="M14.5 7.5L16.5 4.5H19" stroke="#FF4500" strokeWidth="1.5" strokeLinecap="round"/>
        <circle cx="19" cy="4.5" r="1.5" fill="#FF4500"/>
      </svg>
    ),
  },
};

export function getServiceBrand(idOrName: string): ServiceBrand {
  const normalized = idOrName.toLowerCase().replace(/[^a-z0-9-]/g, '');
  if (SERVICE_BRANDS[normalized]) {
    return SERVICE_BRANDS[normalized];
  }
  // Check substring
  for (const [key, brand] of Object.entries(SERVICE_BRANDS)) {
    if (normalized.includes(key) || key.includes(normalized)) {
      return brand;
    }
  }

  // Refined fallback (not AI purple-pink)
  return {
    name: normalized,
    displayName: idOrName,
    accentColor: '#38BDF8',
    borderHover: 'hover:border-[#38BDF8]/60 hover:shadow-[0_0_20px_-3px_rgba(56,189,248,0.25)]',
    badgeBg: 'bg-[#0c2a38]',
    glowGradient: 'radial-gradient(ellipse 80% 50% at 50% -20%, rgba(56, 189, 248, 0.18) 0%, transparent 70%)',
    logo: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="#38BDF8" strokeWidth="1.8" strokeLinejoin="round"/>
        <path d="M2 17L12 22L22 17M2 12L12 17L22 12" stroke="#0284C7" strokeWidth="1.8" strokeLinejoin="round"/>
      </svg>
    ),
  };
}
