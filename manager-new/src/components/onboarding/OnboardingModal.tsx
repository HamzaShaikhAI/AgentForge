import React, { useState } from 'react';
import { useUIStore } from '../../lib/store';
import {
  Folder,
  X,
  Play,
  ArrowRight,
  ArrowLeft,
  GitBranch,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export const OnboardingModal: React.FC = () => {
  const { showOnboarding, setShowOnboarding, openSetupWizard } = useUIStore();
  const [step, setStep] = useState(1);
  const [selectedMcp, setSelectedMcp] = useState<string>('filesystem');
  const navigate = useNavigate();

  if (!showOnboarding) return null;

  const handleStartMcp = () => {
    setShowOnboarding(false);
    openSetupWizard(selectedMcp);
  };

  const handleFinish = () => {
    setShowOnboarding(false);
    navigate('/workflows');
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        background: 'rgba(2, 6, 23, 0.88)',
        backdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1.5rem',
      }}
    >
      <div
        className="forge-card"
        style={{
          width: '100%',
          maxWidth: '680px',
          background: 'var(--bg-base)',
          border: '1px solid var(--border-default)',
          boxShadow: 'var(--elevation-5)',
          borderRadius: 'var(--radius-xl)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '1.25rem 1.5rem',
            borderBottom: '1px solid var(--border-subtle)',
            background: 'var(--bg-elevated)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span className="forge-badge forge-badge-publish">Welcome to AgentForge</span>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)', fontFamily: 'monospace' }}>
                STEP {step} OF 3
              </span>
            </div>
            <h3 style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--text-primary)', marginTop: '0.25rem' }}>
              First-Run Assisted Onboarding
            </h3>
          </div>
          <button
            className="forge-btn forge-btn-outline"
            style={{ padding: '0.4rem', borderRadius: 'var(--radius-full)' }}
            onClick={() => setShowOnboarding(false)}
            aria-label="Skip onboarding"
          >
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        <div style={{ padding: '1.75rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {step === 1 && (
            <div>
              <h4 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.35rem' }}>
                Step 1: Choose Your Core MCP Server
              </h4>
              <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: '1.25rem' }}>
                MCP servers give your AI agents safe, sandboxed tools to interact with real systems.
              </p>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div
                  onClick={() => setSelectedMcp('filesystem-mcp')}
                  style={{
                    padding: '1rem',
                    borderRadius: 'var(--radius-md)',
                    border: selectedMcp === 'filesystem-mcp' ? '2px solid var(--brand-500)' : '1px solid var(--border-subtle)',
                    background: selectedMcp === 'filesystem-mcp' ? 'rgba(244, 63, 94, 0.08)' : 'var(--bg-input)',
                    cursor: 'pointer',
                  }}
                >
                  <Folder size={22} style={{ color: 'var(--brand-400)' }} />
                  <div style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-primary)', marginTop: '0.5rem' }}>
                    📁 Local Filesystem
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', marginTop: '0.2rem' }}>
                    Instant sandboxed file read, write, and list tools.
                  </div>
                </div>

                <div
                  onClick={() => setSelectedMcp('github-mcp')}
                  style={{
                    padding: '1rem',
                    borderRadius: 'var(--radius-md)',
                    border: selectedMcp === 'github-mcp' ? '2px solid var(--brand-500)' : '1px solid var(--border-subtle)',
                    background: selectedMcp === 'github-mcp' ? 'rgba(244, 63, 94, 0.08)' : 'var(--bg-input)',
                    cursor: 'pointer',
                  }}
                >
                  <GitBranch size={22} style={{ color: 'var(--tech-400)' }} />
                  <div style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-primary)', marginTop: '0.5rem' }}>
                    🐙 GitHub Repos
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', marginTop: '0.2rem' }}>
                    Inspect issues, branches, and commits with Git bridge.
                  </div>
                </div>
              </div>

              <button
                className="forge-btn forge-btn-primary"
                onClick={handleStartMcp}
                style={{ marginTop: '1.25rem', width: '100%' }}
              >
                Launch Setup Wizard for Selected MCP
              </button>
            </div>
          )}

          {step === 2 && (
            <div>
              <h4 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.35rem' }}>
                Step 2: Connect an Identity (Optional)
              </h4>
              <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: '1.25rem' }}>
                Hardware DPAPI encryption stores your tokens locally. Never uploaded to external servers.
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem 1rem', background: 'var(--bg-input)', borderRadius: 'var(--radius-md)' }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-primary)' }}>Google YouTube</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>Authorized for video uploads and statistics</div>
                  </div>
                  <span className="forge-badge forge-badge-write">Active</span>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem 1rem', background: 'var(--bg-input)', borderRadius: 'var(--radius-md)' }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-primary)' }}>Northwest Domain Control</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>hamzashaikhai.com DNS & SSL linked</div>
                  </div>
                  <span className="forge-badge forge-badge-write">Active</span>
                </div>
              </div>
            </div>
          )}

          {step === 3 && (
            <div>
              <h4 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.35rem' }}>
                Step 3: Ready to Run Your First Autonomous Workflow
              </h4>
              <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: '1.25rem' }}>
                Choose a starter workflow to run end-to-end with operator approval safeguards.
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <div
                  style={{
                    padding: '0.75rem 1rem',
                    background: 'var(--bg-input)',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--border-subtle)',
                  }}
                >
                  <div style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-primary)' }}>
                    Autonomous AI Website Deploy & DNS Linker
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>
                    Verifies hamzashaikhai.com, links Vercel hosting, and sets up HTTPS.
                  </div>
                </div>

                <div
                  style={{
                    padding: '0.75rem 1rem',
                    background: 'var(--bg-input)',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--border-subtle)',
                  }}
                >
                  <div style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-primary)' }}>
                    Workspace Code & Commit Audit
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>
                    Read-only Git verification of repository working tree cleanliness.
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '1rem 1.5rem',
            borderTop: '1px solid var(--border-subtle)',
            background: 'var(--bg-elevated)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          {step > 1 ? (
            <button className="forge-btn forge-btn-outline" onClick={() => setStep((s) => s - 1)}>
              <ArrowLeft size={14} /> Back
            </button>
          ) : (
            <button className="forge-btn forge-btn-outline" onClick={() => setShowOnboarding(false)}>
              Skip Setup
            </button>
          )}

          {step < 3 ? (
            <button className="forge-btn forge-btn-primary" onClick={() => setStep((s) => s + 1)}>
              Next Step <ArrowRight size={14} />
            </button>
          ) : (
            <button className="forge-btn forge-btn-primary" onClick={handleFinish}>
              <Play size={14} /> Launch Workflows
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
