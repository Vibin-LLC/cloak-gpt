// Add global declarations for type safety
declare global {
  // Add types for the global namespace in Node.js
  namespace NodeJS {
    interface Global {
      analyticsUserId: string;
    }
  }

  // Add types for global variables in the browser environment
  interface Window {
    electronAPI: {
      onFakeCursorUpdate: (callback: (position: { x: number, y: number }) => void) => void;
      onShowFakeCursor: (callback: (show: boolean) => void) => void;
      moveFakeCursor: (x: number, y: number) => Promise<boolean>;
      clickAtPosition: (x: number, y: number, button?: string) => Promise<boolean>;
      toggleChatGPTView: (visible: boolean) => Promise<boolean>;
      reloadChatGPT: () => Promise<boolean>;
      toggleSettings: () => Promise<boolean>;
      getWindowOpacity: () => Promise<number>;
      setWindowOpacity: (opacity: number) => Promise<boolean>;
      saveSettings: (settings: { transparency: number }) => Promise<boolean>;
      settingsClosed: () => Promise<boolean>;
      resetSettings: () => Promise<boolean>;
      openAuthWindow: () => Promise<boolean>;
      checkLoginStatus: () => Promise<boolean>;
      logoutFromChatGPT: () => Promise<boolean>;
      getStealthCursorEnabled: () => Promise<boolean>;
      setStealthCursorEnabled: (enabled: boolean) => Promise<boolean>;
      initializeAnalytics: () => Promise<boolean>;
      trackEvent: (eventName: string, params?: Record<string, any>) => Promise<boolean>;
      setUserProperty: (propertyName: string, value: string) => Promise<boolean>;
      setAnalyticsUserId: (userId: string) => Promise<boolean>;
    };
  }
}

// This export is needed to make this a module
export {};