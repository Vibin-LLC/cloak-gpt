export {};

// Type definitions for the exposed Electron API
interface ElectronAPI {
  // Fake cursor functions
  onFakeCursorUpdate: (callback: (position: { x: number, y: number }) => void) => void;
  onShowFakeCursor: (callback: (show: boolean) => void) => void;
  moveFakeCursor: (x: number, y: number) => Promise<boolean>;
  clickAtPosition: (x: number, y: number, button?: string) => Promise<boolean>;

  // View management
  toggleChatGPTView: (visible: boolean) => Promise<boolean>;
  reloadChatGPT: () => Promise<boolean>;

  // Settings management
  onToggleSettings: (callback: () => void) => void;
  toggleSettings: () => Promise<boolean>;

  // Window opacity/transparency settings
  getWindowOpacity: () => Promise<number>;
  setWindowOpacity: (opacity: number) => Promise<boolean>;
  saveSettings: (settings: { transparency: number }) => Promise<boolean>;
  settingsClosed: () => Promise<boolean>;
  resetSettings: () => Promise<boolean>;

  // Authentication
  openAuthWindow: () => Promise<boolean>;
  checkLoginStatus: () => Promise<boolean>;
  logoutFromChatGPT: () => Promise<boolean>;

  // Cloak GPT Authentication
  signInWithGoogle: () => Promise<boolean>;
  signOutUser: () => Promise<boolean>;
  checkCloakGPTLoginStatus: () => Promise<boolean>;

  // Stealth cursor
  getStealthCursorEnabled: () => Promise<boolean>;
  setStealthCursorEnabled: (enabled: boolean) => Promise<boolean>;

  // Firebase Analytics Methods
  initializeAnalytics: () => Promise<boolean>;
  trackEvent: (eventName: string, params?: Record<string, any>) => Promise<boolean>;
  setUserProperty: (propertyName: string, value: string) => Promise<boolean>;
  setAnalyticsUserId: (userId: string) => Promise<boolean>;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}