'use client';

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

type InstallContextValue = {
  prompt: InstallPromptEvent | null;
  clearPrompt: () => void;
  installed: boolean;
};

const InstallContext = createContext<InstallContextValue | null>(null);
let installedThisSession = false;

function getInstalled() {
  return (
    installedThisSession ||
    window.matchMedia('(display-mode: standalone)').matches ||
    ('standalone' in navigator && navigator.standalone === true)
  );
}

function subscribeInstallation(notify: () => void) {
  const display = window.matchMedia('(display-mode: standalone)');
  const onInstalled = () => {
    installedThisSession = true;
    notify();
  };
  window.addEventListener('appinstalled', onInstalled);
  display.addEventListener('change', notify);
  return () => {
    window.removeEventListener('appinstalled', onInstalled);
    display.removeEventListener('change', notify);
  };
}

/** Capture l'invitation dès l'entrée dans l'app, même avant d'ouvrir les paramètres. */
export function InstallProvider({ children }: { children: ReactNode }) {
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null);
  const installed = useSyncExternalStore(subscribeInstallation, getInstalled, () => false);

  useEffect(() => {
    const onPrompt = (event: Event) => {
      if (!('prompt' in event) || typeof event.prompt !== 'function' || !('userChoice' in event))
        return;
      event.preventDefault();
      setPrompt(event as InstallPromptEvent);
    };
    const onInstalled = () => setPrompt(null);
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  return (
    <InstallContext.Provider value={{ prompt, clearPrompt: () => setPrompt(null), installed }}>
      {children}
    </InstallContext.Provider>
  );
}

export function useInstall() {
  const value = useContext(InstallContext);
  if (!value) throw new Error('InstallProvider is required');
  return value;
}
