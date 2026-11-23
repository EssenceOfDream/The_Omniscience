import { createElement, StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

declare global {
  interface Window {
    __omniscienceFilterInjected?: boolean;
  }
}

export type ProgramWindow = {
  label: string;
  title: string;
  minimized: boolean;
  focused: boolean;
  maximized: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type Program = {
  id: string;
  name: string;
  category: string;
  launchable: boolean;
  launchType?: string;
};

export type DirectoryEntry = {
  name: string;
  path: string;
  kind: 'directory' | 'file' | 'symlink' | 'other';
  size: number;
};

export async function nodeRequest<T>(method: string, payload: object = {}): Promise<T> {
  return invoke<T>('node_request', { method, payload });
}

export function installWindowChrome(themeSettings?: Record<string, unknown>) {
  let border = document.getElementById('__omni_window_border__');
  if (!border) {
    border = document.createElement('div');
    border.id = '__omni_window_border__';
    border.setAttribute('aria-hidden', 'true');
    border.style.position = 'fixed';
    border.style.inset = '0';
    border.style.border = '1px dashed #00ffff';
    border.style.boxSizing = 'border-box';
    border.style.pointerEvents = 'none';
    border.style.zIndex = '2147483647';
    document.documentElement.appendChild(border);
  }

  if (themeSettings) {
    try {
      localStorage.setItem('__omni_settings__', JSON.stringify(themeSettings));
    } catch (error) {
      console.error('[tauri-theme] could not store theme settings:', error);
    }
    window.dispatchEvent(new CustomEvent('__omni_settings_updated__', { detail: themeSettings }));
  }

  const installThemeAssets = () => {
    if (!document.querySelector('[data-omni-theme]')) {
      const stylesheet = document.createElement('link');
      stylesheet.dataset.omniTheme = 'true';
      stylesheet.rel = 'stylesheet';
      stylesheet.href = '/omniscience/__omniscience/theme/base.css';
      document.head.appendChild(stylesheet);
    }
    if (!window.__omniscienceFilterInjected && !document.querySelector('script[data-omni-theme]')) {
      const script = document.createElement('script');
      script.dataset.omniTheme = 'true';
      script.src = '/omniscience/__omniscience/theme/content.js';
      document.head.appendChild(script);
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installThemeAssets, { once: true });
  } else {
    installThemeAssets();
  }
}

export function mountApp(app: ReactNode) {
  const element = document.getElementById('root');
  if (!element) throw new Error('The application root element is missing');
  createRoot(element).render(createElement(StrictMode, null, app));
}

export { invoke, listen };
