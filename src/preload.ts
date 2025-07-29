import { contextBridge, ipcRenderer } from 'electron';

// Expose IPC methods to the renderer process through the 'window.electronAPI' object
contextBridge.exposeInMainWorld('electronAPI', {
  // Register a listener for fake cursor updates
  onFakeCursorUpdate: (callback: (position: { x: number, y: number }) => void) => {
    ipcRenderer.on('update-fake-cursor', (_event, position) => callback(position));
  },

  // Register a listener for showing/hiding the fake cursor
  onShowFakeCursor: (callback: (show: boolean) => void) => {
    ipcRenderer.on('show-fake-cursor', (_event, show) => callback(show));
  },

  // Allow renderer to move the fake cursor
  moveFakeCursor: async (x: number, y: number) => {
    return await ipcRenderer.invoke('move-fake-cursor', { x, y });
  },

  // Allow renderer to simulate clicks at the fake cursor position
  clickAtPosition: async (x: number, y: number, button: string = 'left') => {
    return await ipcRenderer.invoke('click-at-position', { x, y, button });
  },

  // Allow renderer to toggle ChatGPT view visibility
  toggleChatGPTView: async (visible: boolean) => {
    return await ipcRenderer.invoke('toggle-view', visible);
  },

  // Allow renderer to reload ChatGPT
  reloadChatGPT: async () => {
    return await ipcRenderer.invoke('reload-chatgpt');
  },

  // Allow renderer to open settings window
  toggleSettings: async () => {
    return await ipcRenderer.invoke('toggle-settings');
  },

  // Get current window opacity
  getWindowOpacity: async () => {
    return await ipcRenderer.invoke('get-window-opacity');
  },

  // Set window opacity
  setWindowOpacity: async (opacity: number) => {
    return await ipcRenderer.invoke('set-window-opacity', opacity);
  },

  // Save settings
  saveSettings: async (settings: { transparency: number }) => {
    return await ipcRenderer.invoke('save-settings', settings);
  },

  // Notify main process that settings were closed
  settingsClosed: async () => {
    return await ipcRenderer.invoke('settings-closed');
  },

  // Reset settings to defaults
  resetSettings: async () => {
    return await ipcRenderer.invoke('reset-settings');
  },

  // Open the ChatGPT authentication window
  openAuthWindow: async () => {
    return await ipcRenderer.invoke('open-auth-window');
  },

  // Check if logged into ChatGPT
  checkLoginStatus: async () => {
    return await ipcRenderer.invoke('check-login-status');
  },

  // Logout from ChatGPT
  logoutFromChatGPT: async () => {
    return await ipcRenderer.invoke('logout-from-chatgpt');
  },

  // Get stealth cursor enabled status
  getStealthCursorEnabled: async () => {
    return await ipcRenderer.invoke('get-stealth-cursor-enabled');
  },

  // Set stealth cursor enabled status
  setStealthCursorEnabled: async (enabled: boolean) => {
    return await ipcRenderer.invoke('set-stealth-cursor-enabled', enabled);
  },

  // Firebase Analytics Methods
  initializeAnalytics: async () => {
    return await ipcRenderer.invoke('initialize-analytics');
  },

  trackEvent: async (eventName: string, params?: Record<string, any>) => {
    return await ipcRenderer.invoke('track-event', { eventName, params });
  },

  setUserProperty: async (propertyName: string, value: string) => {
    return await ipcRenderer.invoke('set-user-property', { propertyName, value });
  },

  setAnalyticsUserId: async (userId: string) => {
    return await ipcRenderer.invoke('set-analytics-user-id', userId);
  },

  // Cloak GPT Authentication Methods
  signInWithGoogle: async () => {
    return await ipcRenderer.invoke('sign-in-with-google');
  },

  signOutUser: async () => {
    return await ipcRenderer.invoke('sign-out-user');
  },

  checkCloakGPTLoginStatus: async () => {
    return await ipcRenderer.invoke('check-cloak-gpt-login-status');
  },

  // Hide windows and disable keyboard for auth
  hideForAuth: async () => {
    return await ipcRenderer.invoke('hide-for-auth');
  },

  // Show windows and enable keyboard after auth
  showAfterAuth: async () => {
    return await ipcRenderer.invoke('show-after-auth');
  },

  // Listen for auth state changes
  onAuthStateChanged: (callback: (isLoggedIn: boolean) => void) => {
    ipcRenderer.on('auth-state-changed', (_event, { isAuthenticated }) => callback(isAuthenticated));
  },

  // Listen for auth window closed event
  onAuthWindowClosed: (callback: () => void) => {
    // Register with main process to receive auth window closed events
    ipcRenderer.invoke('register-auth-window-closed-listener');

    // Set up the event listener
    ipcRenderer.on('auth-window-closed', () => callback());

    // Return unsubscribe function
    return () => {
      ipcRenderer.removeListener('auth-window-closed', callback);
    };
  },

  // Open external links
  openExternal: async (url: string) => {
    return await ipcRenderer.invoke('open-external', url);
  },


});