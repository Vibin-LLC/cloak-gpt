import React, { useState, useEffect, useRef } from 'react';
import Settings from './Settings';
// CSS is loaded via link tag in index.html

const DEBUG_MODE = true; // Enable debug logs

// Mouse cursor styles
const CURSOR_STYLES = {
  default: {
    width: '24px',
    height: '24px',
    borderRadius: '50%',
    backgroundColor: 'rgba(101, 105, 112, 0.6)',
    border: '2px solid white',
    boxShadow: '0 0 8px rgba(0, 0, 0, 0.5)',
    pointerEvents: 'none',
    position: 'fixed',
    zIndex: 9999,
    transform: 'translate(-50%, -50%)'
  } as React.CSSProperties
};

const App: React.FC = () => {
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  // Fake cursor state
  const [showFakeCursor, setShowFakeCursor] = useState(false);
  const [cursorPosition, setCursorPosition] = useState({ x: 0, y: 0 });
  const [cursorStyle, setCursorStyle] = useState<React.CSSProperties>(CURSOR_STYLES.default);
  const contentRef = useRef<HTMLDivElement>(null);

  // Debug logging
  const debugLog = (message: string, ...args: any[]) => {
    if (DEBUG_MODE) {
      console.log(`[DEBUG] ${message}`, ...args);
    }
  };

  useEffect(() => {
    debugLog('App component mounted');

    // Listen for fake cursor updates from main process
    window.electronAPI.onFakeCursorUpdate((position) => {
      setCursorPosition(position);
    });

    // Listen for fake cursor show/hide events
    window.electronAPI.onShowFakeCursor((show) => {
      setShowFakeCursor(show);
    });

    // Add keyboard shortcut for reloading and cursor clicks
    const handleKeyDown = (e: KeyboardEvent) => {
      // Alt+R to reload ChatGPT
      if (e.altKey && e.key === 'r') {
        handleRetryLoading();
      }

      // Enter key to click at the cursor position when cursor is shown
      if (e.key === 'Enter' && showFakeCursor) {
        handleFakeCursorClick();
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    // Simulate loading time for the BrowserView
    // Since we can't directly listen to BrowserView loading events in the renderer
    const loadingTimeout = setTimeout(() => {
      setIsLoading(false);
    }, 3000);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      clearTimeout(loadingTimeout);
    };
  }, [showFakeCursor]);

  // Handle fake cursor click
  const handleFakeCursorClick = async () => {
    try {
      await window.electronAPI.clickAtPosition(cursorPosition.x, cursorPosition.y);

      // Visual feedback for click
      setCursorStyle({
        ...CURSOR_STYLES.default,
        backgroundColor: 'rgba(255, 64, 129, 0.8)'
      });

      // Reset cursor style after click animation
      setTimeout(() => {
        setCursorStyle(CURSOR_STYLES.default);
      }, 200);
    } catch (err) {
      debugLog('Error with cursor click:', err);
    }
  };

  const handleRetryLoading = async () => {
    debugLog("Retrying loading ChatGPT");
    setIsLoading(true);
    setHasError(false);

    try {
      const result = await window.electronAPI.reloadChatGPT();
      debugLog("Reload requested:", result);

      // Since we can't listen directly to BrowserView events,
      // simulate the loading state with a timeout
      setTimeout(() => {
        setIsLoading(false);
      }, 3000);
    } catch (err) {
      debugLog("Error reloading:", err);
      setHasError(true);
      setIsLoading(false);
    }
  };

  debugLog('Rendering App component');

  return (
    <div className="app-container" id="app-container">
      {/* Conditionally render the fake cursor */}
      {showFakeCursor && (
        <div
          className="fake-cursor"
          style={{
            ...cursorStyle,
            left: `${cursorPosition.x}px`,
            top: `${cursorPosition.y}px`
          }}
        />
      )}

      {/* Always render the content area */}
      <div
        ref={contentRef}
        className="browserView-placeholder"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          width: '100%',
          height: '100%',
          pointerEvents: hasError ? 'none' : 'auto'
        }}
      >
        <webview
          id="chatgpt-webview"
          src="https://chatgpt.com"
          useragent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36"
          className="chatgpt-iframe"
          allowpopups="true"
          webpreferences="contextIsolation=yes"
        />
      </div>

      {/* Error state */}
      {hasError && (
        <div className="iframe-error">
          <h2>Unable to load ChatGPT</h2>
          <p>Due to security restrictions, ChatGPT may not allow loading in this way.</p>
          <div className="button-group">
            <button onClick={handleRetryLoading}>Retry</button>
          </div>
        </div>
      )}

      {/* Loading state */}
      {isLoading && !hasError && (
        <div className="iframe-loading">
          <div className="loading-spinner"></div>
          <p>Loading ChatGPT...</p>
        </div>
      )}
    </div>
  );
};

export default App;