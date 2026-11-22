import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

interface UIState {
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;

  theme: 'light' | 'dark' | 'system';
  setTheme: (theme: 'light' | 'dark' | 'system') => void;
  resolvedTheme: 'light' | 'dark';
  setResolvedTheme: (theme: 'light' | 'dark') => void;

  density: 'comfortable' | 'compact' | 'data';
  setDensity: (density: 'comfortable' | 'compact' | 'data') => void;

  activeTab: string;
  setActiveTab: (tab: string) => void;

  activeSubTab: Record<string, string>;
  setActiveSubTab: (parentTab: string, subTab: string) => void;

  globalSearchOpen: boolean;
  setGlobalSearchOpen: (open: boolean) => void;

  onboardingCompleted: boolean;
  setOnboardingCompleted: (completed: boolean) => void;

  showOnboarding: boolean;
  setShowOnboarding: (show: boolean) => void;

  showSetupWizard: boolean;
  setupWizardTarget: string | null;
  openSetupWizard: (target: string) => void;
  closeSetupWizard: () => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
      setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),

      theme: 'system',
      setTheme: (theme) => set({ theme }),
      resolvedTheme: 'dark',
      setResolvedTheme: (resolvedTheme) => set({ resolvedTheme }),

      density: 'comfortable',
      setDensity: (density) => set({ density }),

      activeTab: 'dashboard',
      setActiveTab: (activeTab) => set({ activeTab }),

      activeSubTab: {},
      setActiveSubTab: (parentTab, subTab) =>
        set((state) => ({
          activeSubTab: { ...state.activeSubTab, [parentTab]: subTab },
        })),

      globalSearchOpen: false,
      setGlobalSearchOpen: (globalSearchOpen) => set({ globalSearchOpen }),

      onboardingCompleted: false,
      setOnboardingCompleted: (onboardingCompleted) => set({ onboardingCompleted }),

      showOnboarding: false,
      setShowOnboarding: (showOnboarding) => set({ showOnboarding }),

      showSetupWizard: false,
      setupWizardTarget: null,
      openSetupWizard: (target) => set({ showSetupWizard: true, setupWizardTarget: target }),
      closeSetupWizard: () => set({ showSetupWizard: false, setupWizardTarget: null }),
    }),
    {
      name: 'agentforge-ui',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        sidebarCollapsed: state.sidebarCollapsed,
        theme: state.theme,
        density: state.density,
        activeTab: state.activeTab,
        activeSubTab: state.activeSubTab,
        onboardingCompleted: state.onboardingCompleted,
      }),
    }
  )
);

interface ModalState {
  modals: Record<string, { open: boolean; data?: unknown }>;
  openModal: (key: string, data?: unknown) => void;
  closeModal: (key: string) => void;
  closeAllModals: () => void;
  isModalOpen: (key: string) => boolean;
}

export const useModalStore = create<ModalState>((set, get) => ({
  modals: {},
  openModal: (key, data) =>
    set((state) => ({
      modals: { ...state.modals, [key]: { open: true, data } },
    })),
  closeModal: (key) =>
    set((state) => {
      const next = { ...state.modals };
      delete next[key];
      return { modals: next };
    }),
  closeAllModals: () => set({ modals: {} }),
  isModalOpen: (key) => get().modals[key]?.open ?? false,
}));

interface ToastState {
  toasts: Array<{ id: string; message: string; type: 'success' | 'error' | 'info' | 'warning' }>;
  addToast: (message: string, type: 'success' | 'error' | 'info' | 'warning') => void;
  removeToast: (id: string) => void;
}

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  addToast: (message, type) =>
    set((state) => ({
      toasts: [...state.toasts, { id: generateId(), message, type }],
    })),
  removeToast: (id) =>
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    })),
}));

function generateId(): string {
  return Math.random().toString(36).slice(2, 11);
}