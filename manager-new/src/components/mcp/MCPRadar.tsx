import React, { useState } from 'react';
import type { McpServerItem } from '../../lib/api/client';

interface MCPRadarProps {
  servers: McpServerItem[];
}

export const MCPRadar: React.FC<MCPRadarProps> = ({ servers }) => {
  const [selectedServer, setSelectedServer] = useState<McpServerItem | null>(null);

  // Fallback items if servers empty
  const displayServers = servers.length > 0 ? servers : [
    { id: 'fs', name: 'filesystem', command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem'], status: 'running' as const, toolsCount: 6 },
    { id: 'gh', name: 'github', command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'], status: 'running' as const, toolsCount: 8 },
    { id: 'wp', name: 'wordpress', command: 'node', args: ['dist/adapters/wordpress.js'], status: 'running' as const, toolsCount: 14 },
    { id: 'nw', name: 'northwest', command: 'node', args: ['dist/adapters/northwest.js'], status: 'running' as const, toolsCount: 12 },
    { id: 'yt', name: 'youtube', command: 'node', args: ['dist/executors/youtube-upload.js'], status: 'running' as const, toolsCount: 5 },
  ];

  // Coordinates calculation for circular radar
  const center = 150;
  const radius = 120;

  const blips = displayServers.map((srv, idx) => {
    const angle = (idx * (360 / displayServers.length) * Math.PI) / 180;
    const distance = 40 + ((idx * 37) % (radius - 50));
    const x = center + distance * Math.cos(angle);
    const y = center + distance * Math.sin(angle);
    return { ...srv, x, y };
  });

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '1.5rem',
        background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.95) 0%, rgba(10, 15, 30, 0.98) 100%)',
        borderRadius: 'var(--radius-lg)',
        border: '1px solid var(--border-default)',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center', marginBottom: '1rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span className="forge-badge forge-badge-read">Active Radar Sentinel</span>
            <span style={{ fontSize: '0.75rem', fontFamily: 'monospace', color: 'var(--text-tertiary)' }}>
              SCAN: 360° / 2.4s
            </span>
          </div>
          <div style={{ fontSize: '1rem', fontWeight: 700, color: '#ffffff', marginTop: '0.25rem' }}>
            Model Context Protocol Topology & Sentinel
          </div>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '0.65rem', color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>Nodes Online</div>
            <div style={{ fontSize: '1rem', fontWeight: 800, color: 'var(--tech-400)' }}>{displayServers.length} ACTIVE</div>
          </div>
        </div>
      </div>

      <div style={{ position: 'relative', width: '300px', height: '300px' }}>
        <svg width="300" height="300" viewBox="0 0 300 300" style={{ overflow: 'visible' }}>
          <defs>
            {/* Radar sweep gradient */}
            <linearGradient id="sweepGradient" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="var(--tech-500)" stopOpacity="0.4" />
              <stop offset="100%" stopColor="var(--tech-500)" stopOpacity="0" />
            </linearGradient>

            {/* Glowing filter */}
            <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Background grid circles */}
          <circle cx={center} cy={center} r={radius} fill="none" stroke="rgba(56, 189, 248, 0.15)" strokeWidth="1" strokeDasharray="4 4" />
          <circle cx={center} cy={center} r={radius * 0.75} fill="none" stroke="rgba(56, 189, 248, 0.12)" strokeWidth="1" />
          <circle cx={center} cy={center} r={radius * 0.5} fill="none" stroke="rgba(56, 189, 248, 0.1)" strokeWidth="1" strokeDasharray="4 4" />
          <circle cx={center} cy={center} r={radius * 0.25} fill="none" stroke="rgba(56, 189, 248, 0.08)" strokeWidth="1" />

          {/* Crosshairs */}
          <line x1={center} y1={20} x2={center} y2={280} stroke="rgba(56, 189, 248, 0.12)" strokeWidth="1" />
          <line x1={20} y1={center} x2={280} y2={center} stroke="rgba(56, 189, 248, 0.12)" strokeWidth="1" />

          {/* Radar Sweep Line */}
          <g>
            <path
              d={`M ${center} ${center} L ${center + radius} ${center} A ${radius} ${radius} 0 0 0 ${center} ${center - radius} Z`}
              fill="url(#sweepGradient)"
            >
              <animateTransform
                attributeName="transform"
                type="rotate"
                from={`0 ${center} ${center}`}
                to={`360 ${center} ${center}`}
                dur="4s"
                repeatCount="indefinite"
              />
            </path>
            <line x1={center} y1={center} x2={center + radius} y2={center} stroke="var(--tech-400)" strokeWidth="1.5">
              <animateTransform
                attributeName="transform"
                type="rotate"
                from={`0 ${center} ${center}`}
                to={`360 ${center} ${center}`}
                dur="4s"
                repeatCount="indefinite"
              />
            </line>
          </g>

          {/* Center Origin Node */}
          <circle cx={center} cy={center} r="5" fill="var(--brand-500)" filter="url(#glow)" />
          <circle cx={center} cy={center} r="10" fill="none" stroke="var(--brand-400)" strokeWidth="1" opacity="0.6">
            <animate attributeName="r" values="5;15;5" dur="2s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.8;0;0.8" dur="2s" repeatCount="indefinite" />
          </circle>

          {/* Server blips */}
          {blips.map((blip) => (
            <g
              key={blip.id}
              style={{ cursor: 'pointer' }}
              onClick={() => setSelectedServer(blip)}
              onMouseEnter={() => setSelectedServer(blip)}
            >
              <circle
                cx={blip.x}
                cy={blip.y}
                r="6"
                fill={selectedServer?.id === blip.id ? 'var(--brand-400)' : 'var(--tech-400)'}
                filter="url(#glow)"
              />
              <circle
                cx={blip.x}
                cy={blip.y}
                r="12"
                fill="none"
                stroke="var(--tech-400)"
                strokeWidth="1"
                opacity="0.4"
              >
                <animate attributeName="r" values="6;16;6" dur="2.5s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.6;0;0.6" dur="2.5s" repeatCount="indefinite" />
              </circle>
              <text
                x={blip.x + 8}
                y={blip.y + 4}
                fill="#ffffff"
                fontSize="9"
                fontFamily="monospace"
                fontWeight="bold"
              >
                {blip.name}
              </text>
            </g>
          ))}
        </svg>
      </div>

      {/* Selected Blip Detail Card */}
      {selectedServer && (
        <div
          style={{
            marginTop: '1rem',
            width: '100%',
            padding: '0.75rem 1rem',
            background: 'rgba(255, 255, 255, 0.04)',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border-subtle)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div>
            <div style={{ fontWeight: 700, fontSize: '0.85rem', color: '#ffffff' }}>
              {selectedServer.name} MCP Node
            </div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)', fontFamily: 'monospace' }}>
              {selectedServer.command} {selectedServer.args?.join(' ')}
            </div>
          </div>
          <span className="forge-badge forge-badge-write">
            {selectedServer.toolsCount} Tools Active
          </span>
        </div>
      )}
    </div>
  );
};
