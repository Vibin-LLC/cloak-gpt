// The lines commented out below are done for a reason (to not spam the console), do not uncomment them.
import { app, BrowserWindow, globalShortcut, ipcMain, screen, dialog, session, BrowserView, nativeImage, clipboard, desktopCapturer, shell } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as crypto from 'crypto';
import { cursors } from './native';
import analytics from './firebase';

// Auto-update functionality
const { updateElectronApp } = require('update-electron-app');
updateElectronApp({
  logger: require('electron-log')
});

// Set the user agent for all webviews
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';

// Set user agent for all sessions
function setupUserAgent() {
  // Set for default session
  session.defaultSession.setUserAgent(USER_AGENT);

  // Set for all future sessions
  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    details.requestHeaders['User-Agent'] = USER_AGENT;
    callback({ requestHeaders: details.requestHeaders });
  });
}

// Define the types for our mouse button
type MouseButton = 'left' | 'middle' | 'right';

const CHATGPT_URL = "https://chatgpt.com";

let mainWindow: BrowserWindow | null = null;
let chatGPTView: BrowserView | null = null;
let settingsWindow: BrowserWindow | null = null;
let authWindow: BrowserWindow | null = null; // Track the auth window instance
let isViewVisible = true;
let fakeCursorPosition = { x: 0, y: 0 };
let isAppVisible = false;
let isCapturingInput = false;
let isCapturingKeystrokes = false;
let keyBuffer = '';
// Define layout states: 0 = default centered, 1 = vertical right, 2 = vertical left
// These will be initialized from stored settings below
let currentLayout: number;
// Track whether stealth cursor is enabled
let stealthCursorEnabled: boolean;
// Debounce timer for position saving
let positionSaveTimeout: NodeJS.Timeout;

// Configure content security policy to allow external URLs
function setupSecurityPolicies() {
  // Disable web security checks for the entire session
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        // Disable content security policy completely
        'Content-Security-Policy': [''],
        // Allow cross-origin
        'Access-Control-Allow-Origin': ['*']
      }
    });
  });

  // Log all navigation and loading events for debugging
  // Ensure single instance lock for Windows
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  console.log('Another instance is running, quitting...');
  app.quit();
} else {
  console.log('Registering protocol handler...');

  // Register custom protocol handler for OAuth callback
  try {
    // Check if we're in development or production
    const isDev = !app.isPackaged;
    console.log('Running in', isDev ? 'development' : 'production', 'mode');

    if (isDev && process.platform === 'darwin') {
      // In development on macOS, we need to handle the protocol manually
      console.log('Development mode on macOS: Protocol handler will be simulated');
      // We'll handle the URL directly in the open-url event
    } else {
      if (!app.isDefaultProtocolClient('cloak-gpt-auth')) {
        // For Windows or production macOS builds
        const success = app.setAsDefaultProtocolClient('cloak-gpt-auth');
        if (success) {
          // console.log('Successfully registered as protocol handler for cloak-gpt-auth://');
        } else {
          // //console.error('Failed to register as protocol handler');
        }
      } else {
        console.log('Already registered as protocol handler for cloak-gpt-auth://');
      }
    }
  } catch (error) {
    console.error('Error registering protocol handler:', error);
  }
}

app.on('web-contents-created', (event, contents) => {
    contents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
      console.error('Failed to load:', validatedURL, 'Error:', errorCode, errorDescription);
    });

    contents.on('did-finish-load', () => {
      console.log('Finished loading:', contents.getURL());
    });

    contents.on('did-start-loading', () => {
      console.log('Started loading URL:', contents.getURL());
    });

    // Enable remote debugging (only in development)
    if (!app.isPackaged && (contents.getType() === 'webview' || contents.getURL().includes('chatgpt.com'))) {
      console.log('Enabling remote debugging for webview/chatgpt');
      contents.openDevTools({ mode: 'detach' });
    }
  });
}

function createChatGPTView(parentWindow: BrowserWindow) {
  // Create a BrowserView to host ChatGPT
  chatGPTView = new BrowserView({
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false,
      allowRunningInsecureContent: true,
      sandbox: false,
      devTools: !app.isPackaged, // Only enable DevTools in development
      session: session.defaultSession // Explicitly use default session for auth sharing
    }
  });

  // Explicitly set the user agent and ensure it persists
  chatGPTView.webContents.setUserAgent(USER_AGENT);
  chatGPTView.webContents.session.setUserAgent(USER_AGENT);

  // Set up request interceptor to ensure user agent is maintained
  chatGPTView.webContents.session.webRequest.onBeforeSendHeaders((details, callback) => {
    details.requestHeaders['User-Agent'] = USER_AGENT;
    callback({ requestHeaders: details.requestHeaders });
  });

  console.log('Using modified user agent for ChatGPT view:', USER_AGENT);

  // Add the view to the window
  parentWindow.addBrowserView(chatGPTView);

  // Set the initial bounds (we'll update this on resize)
  const bounds = parentWindow.getBounds();
  chatGPTView.setBounds({
    x: 0,
    y: 0,
    width: bounds.width,
    height: bounds.height
  });

  // Auto-resize the view with the window
  chatGPTView.setAutoResize({
    width: true,
    height: true
  });

  // Load ChatGPT
  chatGPTView.webContents.loadURL(CHATGPT_URL);

  // Open DevTools for the ChatGPT view for debugging (only in development)
  if (!app.isPackaged) {
    chatGPTView.webContents.openDevTools({ mode: 'detach' });
  }

  // Listen for dom-ready to execute scripts in the ChatGPT page
  chatGPTView.webContents.on('dom-ready', () => {
    if (!chatGPTView) return; // Safety check

    // Apply cursor settings based on user preference
    applyCursorSettings();



    // Set up popup closing functionality
    chatGPTView.webContents.executeJavaScript(`
      // Function to check and close popup
      function closePopupIfExists() {
        const closeButton = document.querySelector('[data-testid="close-button"]');
        if (closeButton) {
          console.log('Found popup close button, clicking it');
          closeButton.click();
          return true;
        }
        return false;
      }

      // Initial check
      let popupFound = closePopupIfExists();

      // If popup not found initially, set up periodic checks
      if (!popupFound) {
        let checkCount = 0;
        const maxChecks = 17; // 5 seconds / 300ms = ~17 checks
        const checkInterval = setInterval(() => {
          checkCount++;
          if (closePopupIfExists() || checkCount >= maxChecks) {
            clearInterval(checkInterval);
          }
        }, 300);
      }
    `).catch(err => {
      console.error('Error injecting popup closing script:', err);
    });

    // Inject fake cursor element and controller script
    chatGPTView.webContents.executeJavaScript(`
      // Create fake cursor element if it doesn't exist
      if (!document.getElementById('fake-cursor')) {
        const fakeCursor = document.createElement('div');
        fakeCursor.id = 'fake-cursor';
        document.body.appendChild(fakeCursor);

        // Initialize position in the center
        fakeCursor.style.left = '50%';
        fakeCursor.style.top = '50%';

        // Function to move cursor to specific coordinates
        window.moveFakeCursor = function(x, y) {
          fakeCursor.style.left = x + 'px';
          fakeCursor.style.top = y + 'px';
        };

        // Function to click at the current cursor position
        window.fakeCursorClick = function() {
          const x = parseInt(fakeCursor.style.left);
          const y = parseInt(fakeCursor.style.top);

          // Find element at position and click it
          const element = document.elementFromPoint(x, y);
          if (element) {
            element.click();

            // Visual feedback for click
            const clickEffect = document.createElement('div');
            clickEffect.style.position = 'fixed';
            clickEffect.style.left = (x - 5) + 'px';
            clickEffect.style.top = (y - 5) + 'px';
            clickEffect.style.width = '10px';
            clickEffect.style.height = '10px';
            clickEffect.style.borderRadius = '50%';
            clickEffect.style.backgroundColor = 'rgba(255,255,255,0.7)';
            clickEffect.style.pointerEvents = 'none';
            clickEffect.style.zIndex = '10000';
            clickEffect.style.transition = 'all 0.2s ease-out';

            document.body.appendChild(clickEffect);

            setTimeout(() => {
              clickEffect.style.transform = 'scale(2)';
              clickEffect.style.opacity = '0';
            }, 10);

            setTimeout(() => {
              document.body.removeChild(clickEffect);
            }, 200);
          }
        };
      }

      // Focus the input field whenever the page is ready or activated
      function focusChatInput() {
        // Try to find and focus the chat input
        const inputField = document.querySelector('textarea') ||
                          document.querySelector('[contenteditable="true"]') ||
                          document.querySelector('input[type="text"]');

        if (inputField) {
          console.log('Found input field, focusing it');
          inputField.focus();
          return true;
        } else {
          console.log('No input field found');
          return false;
        }
      }

      // Try to focus immediately and set up a periodic check
      focusChatInput();

      // Try again after a delay to make sure UI is fully loaded
      setTimeout(focusChatInput, 1000);
      setTimeout(focusChatInput, 3000);

      // Set up a MutationObserver to detect UI changes
      const observer = new MutationObserver(() => {
        focusChatInput();
      });

      // Start observing the document body
      observer.observe(document.body, {
        childList: true,
        subtree: true
      });

      console.log('ChatGPT input focus script injected');
    `).catch(err => {
      console.error('Error injecting cursor script:', err);
    });
  });

  // Update the view bounds when the window is resized
  parentWindow.on('resize', () => {
    if (chatGPTView && isViewVisible) {
      const newBounds = parentWindow.getBounds();
      chatGPTView.setBounds({
        x: 0,
        y: 0,
        width: newBounds.width,
        height: newBounds.height
      });
    }
  });

  // Save window position when it's moved
  parentWindow.on('moved', () => {
    if (isAppVisible) {
      const [x, y] = parentWindow.getPosition();
      // Debounce position saving to avoid excessive writes
      clearTimeout(positionSaveTimeout);
      positionSaveTimeout = setTimeout(() => {
        saveSettings({ position: { x, y } });
      }, 500);
    }
  });
}

function setViewVisibility(visible: boolean) {
  isViewVisible = visible;

  if (mainWindow && chatGPTView) {
    if (visible) {
      mainWindow.addBrowserView(chatGPTView);
      const bounds = mainWindow.getBounds();
      chatGPTView.setBounds({
        x: 0,
        y: 0,
        width: bounds.width,
        height: bounds.height
      });
    } else {
      mainWindow.removeBrowserView(chatGPTView);
    }
  }
}

function createWindow() {
  // Create the browser window.
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000', // Transparent background color
    opacity: 0.95, // Slight opacity to ensure it's visible
    show: false, // Don't show until ready-to-show
    focusable: false, // CRITICAL: Must be false to prevent focus stealing
    alwaysOnTop: true, // Always on top
    skipTaskbar: true, // Hide from taskbar
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      webSecurity: false, // Disable web security for testing
      allowRunningInsecureContent: true, // Allow mixed content
      webviewTag: true, // Enable webview
      sandbox: false, // Disable sandbox for iframe support
      devTools: !app.isPackaged // Only enable devtools in development
    }
  });

  // Protect window content from screen capture
  mainWindow.setContentProtection(true);

  // Ignore mouse events and pass them through
  mainWindow.setIgnoreMouseEvents(true, { forward: true });

  // More aggressive prevention of focus
  if (process.platform === 'darwin') {
    // On macOS, we use more specific techniques to prevent focus stealing
    app.dock?.hide(); // Hide from dock to reduce focus stealing possibilities
  }

  // Set window to be always on top at screen-saver level
  mainWindow.setAlwaysOnTop(true, 'screen-saver');

  // On macOS, make it visible on all workspaces including fullscreen apps
  if (process.platform === 'darwin') {
    mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

    // Hide window from screen recording/capture
    const windowId = mainWindow.getNativeWindowHandle().readInt32LE(0);
    cursors.setWindowHiddenFromCapture(windowId);
  } else if (process.platform === 'win32') {
    // On Windows, hide from screen capture
    const windowId = mainWindow.getNativeWindowHandle().readInt32LE(0);
    cursors.setWindowHiddenFromCapture(windowId);
  }

  // Create ChatGPT view once the window is ready
  createChatGPTView(mainWindow);

  // Show window when ready to show (prevents flashing)
  mainWindow.once('ready-to-show', () => {
    if (mainWindow) {
      // Set app as visible on first launch
      isAppVisible = true;
      isCapturingKeystrokes = true;

      // Don't focus the window, just show it
      showWithoutFocus();

      // Open DevTools for debugging (only in development)
      if (!app.isPackaged) {
        mainWindow.webContents.openDevTools({ mode: 'detach' });
      }

      // Log that window is showing to help with debugging
      console.log('Window is now visible');

      // Apply default layout (centered)
      toggleLayout(0);
      console.log('Applied default layout on app launch');

      // Initialize fake cursor position
      const screenSize = screen.getPrimaryDisplay().workAreaSize;
      fakeCursorPosition = {
        x: Math.floor(screenSize.width / 2),
        y: Math.floor(screenSize.height / 2)
      };

      // Tell renderer to show fake cursor
      mainWindow.webContents.send('update-fake-cursor', fakeCursorPosition);

      // Enable input capture for initial launch
      toggleInputCapture(true);
      console.log('Enabled input capture on initial launch');

      // Register all keyboard shortcuts for initial launch
      registerAllKeyShortcuts();
      console.log('Registered keyboard shortcuts on initial launch');

      // If we have a ChatGPT view, make sure it's active and ready for input
      if (chatGPTView) {
        // Force focus on the ChatGPT input field
        chatGPTView.webContents.executeJavaScript(`
          (function() {
            console.log('Activating ChatGPT input for initial launch');

            // Focus the input field with multiple attempts
            function focusChatInput() {
              const inputField = document.querySelector('textarea') ||
                                document.querySelector('[contenteditable="true"]') ||
                                document.querySelector('input[type="text"]');

              if (inputField) {
                console.log('Found input field, focusing it');
                inputField.focus();
                return true;
              }
              return false;
            }

            // Try to focus immediately and set up a periodic check
            focusChatInput();

            // Try again after delays to make sure UI is fully loaded
            setTimeout(focusChatInput, 1000);
            setTimeout(focusChatInput, 3000);
            setTimeout(focusChatInput, 5000);

            return true;
          })()
        `).catch(err => {
          console.error('Error activating ChatGPT input on launch:', err);
        });
      }
    }
  });

  // Setup mouse movement tracking for fake cursor
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (!isAppVisible || !mainWindow) return;

    // If keystroke capture is active for the overlay, Electron global shortcuts are responsible.
    // Prevent default here to ensure the main window doesn't process the event,
    // and stop further processing in this particular handler.
    if (isCapturingKeystrokes) {
      // Electron global shortcuts should have already handled the event.
      // This is an additional safety net at the Electron window level.
      console.log(`Main window 'before-input-event' for key '${input.key}': isCapturingKeystrokes is true. Preventing default and returning.`);
      event.preventDefault();
      return; // Let Electron global shortcuts handle the logic via handleKeypress.
    }

    // If we reach here, isCapturingKeystrokes is false.
    // This implies the overlay might be visible but not in active "typing-into-ChatGPT" mode.
    // The original code had a section here for moving a fake cursor on the main window
    // using arrow keys. Since isCapturingKeystrokes is true whenever isAppVisible is true (due to shortcut logic),
    // this block will likely not be hit when the app is visible.
    // Keeping it for consistency with original structure if that assumption changes.
    if (input.type === 'keyDown') {
      let moved = false;
      const step = 10; // Pixels to move per key press

      switch (input.key) {
        case 'ArrowUp':
          fakeCursorPosition.y = Math.max(0, fakeCursorPosition.y - step);
          moved = true;
          break;
        case 'ArrowDown':
          fakeCursorPosition.y = Math.min(mainWindow.getBounds().height, fakeCursorPosition.y + step);
          moved = true;
          break;
        case 'ArrowLeft':
          fakeCursorPosition.x = Math.max(0, fakeCursorPosition.x - step);
          moved = true;
          break;
        case 'ArrowRight':
          fakeCursorPosition.x = Math.min(mainWindow.getBounds().width, fakeCursorPosition.x + step);
          moved = true;
          break;
      }

      if (moved) {
        console.log(`Main window 'before-input-event': Arrow key '${input.key}'. isCapturingKeystrokes is false. Updating main window fake cursor.`);
        mainWindow.webContents.send('update-fake-cursor', fakeCursorPosition);
        // If these arrow keys are exclusively for this cursor when not capturing, prevent default.
        // Otherwise, allow them to pass through to the underlying app.
        // For now, preventing default if an action is taken.
        event.preventDefault();
      }
    }
  });

  // Load the index.html of the app
  const possiblePaths = [
    path.join(__dirname, 'renderer/index.html'),
    path.join(__dirname, '../dist/renderer/index.html'),
    path.join(__dirname, '../renderer/index.html'),
    path.join(__dirname, '../src/renderer/index.html'),
    path.join(app.getAppPath(), 'dist/renderer/index.html'),
    path.join(app.getAppPath(), 'src/renderer/index.html')
  ];

  // Try to load the file from different possible paths
  let htmlFound = false;
  for (const htmlPath of possiblePaths) {
    if (fs.existsSync(htmlPath)) {
      console.log(`Loading HTML from: ${htmlPath}`);
      mainWindow.loadFile(htmlPath).catch(err => {
        console.error('Error loading file:', err);
      });
      htmlFound = true;
      break;
    }
  }

  if (!htmlFound) {
    console.error('Could not find renderer index.html. Paths checked:', possiblePaths);

    // As a last resort, try to create a minimal HTML file on the fly
    const tempHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Ghost GPT Overlay</title>
        <style>
          body { background: rgba(0,0,0,0.7); color: white; font-family: Arial; padding: 20px; }
          .error { color: #ff6b6b; }
          .container { max-width: 600px; margin: 0 auto; }
        </style>
      </head>
      <body>
        <div class="container">
          <h2>Ghost GPT Overlay</h2>
          <p class="error">Unable to find the application's HTML files.</p>
          <p>This may be because the application hasn't been built correctly.</p>
          <p>Try running: <code>npm run build</code></p>
        </div>
      </body>
      </html>
    `;

    mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(tempHtml)}`);
  }

  // Enable opening links in external browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    require('electron').shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    chatGPTView = null;
  });
}

// Show the window without focusing it
function showWithoutFocus() {
  if (!mainWindow) return;

  // Ensure proper window settings for visibility
  mainWindow.setFocusable(true);  // Allow focus for keyboard capture
  mainWindow.setAlwaysOnTop(true, 'screen-saver');  // Stay on top

  // Configure mouse events based on stealth mode
  if (stealthCursorEnabled) {
    // Stealth mode: pass-through mouse events
    mainWindow.setIgnoreMouseEvents(true, { forward: true });
  } else {
    // Normal mode: capture mouse events
    mainWindow.setIgnoreMouseEvents(false);
  }

  // Set the window to be visible on all workspaces, including fullscreen apps
  if (process.platform === 'darwin') {
    // Make sure the window is visible on all spaces, including fullscreen
    mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

    // We need to set a slightly higher level to display over fullscreen apps
    mainWindow.setAlwaysOnTop(true, 'screen-saver');

    // Core focus prevention technique - use showInactive
    mainWindow.showInactive();

    // Additional defense against focus stealing
    setTimeout(() => {
      // This helps prevent taking focus away from the current application
      try {
        // Find the current frontmost application using macOS-specific API
        // This is just a hint - even if this fails, our other techniques should work
        const { exec } = require('child_process');
        exec('osascript -e \'tell application "System Events" to get name of first application process whose frontmost is true\'',
          (error: Error | null, stdout: string) => {
            if (!error && stdout.trim()) {
              const frontApp = stdout.trim();
              // Refocus the previous app - but with a delay to avoid focus issues
              exec(`osascript -e 'tell application "${frontApp}" to activate'`);
            }
          }
        );
      } catch (e) {
        console.error('Error attempting to restore focus:', e);
      }
    }, 100);
  } else if (process.platform === 'win32') {
    mainWindow.showInactive();
  } else {
    // Linux or other platforms
    mainWindow.show();
    mainWindow.setAlwaysOnTop(true, 'screen-saver');
    mainWindow.moveTop(); // Make sure it's on top
  }
}

// Hide the window
function hideWindow() {
  if (!mainWindow) return;
  mainWindow.hide();
}

// Register global input hooks for capture mode
function setupInputHooks() {
  // This function is no longer used.
  console.log('Input hooks setup removed - using Electron global shortcuts instead');
}

// Simulate a mouse click in the ChatGPT view
function simulateClick(x: number, y: number, button: string = 'left') {
  if (!chatGPTView) return;

  // Convert string button to Electron expected button type
  const electronButton: MouseButton =
    button === 'left' ? 'left' :
    button === 'right' ? 'right' :
    'middle';

  chatGPTView.webContents.sendInputEvent({
    type: 'mouseDown',
    x, y,
    button: electronButton,
    clickCount: 1
  });

  chatGPTView.webContents.sendInputEvent({
    type: 'mouseUp',
    x, y,
    button: electronButton,
    clickCount: 1
  });

  // Send visual feedback to the renderer
  if (mainWindow) {
    mainWindow.webContents.send('fake-cursor-click', { x, y });
  }
}

// Start/stop input capture mode
function toggleInputCapture(enabled: boolean) {
  isCapturingInput = enabled;
  isCapturingKeystrokes = enabled;

  if (enabled) {
    console.log('==== INPUT CAPTURE ENABLED ====');
    // Input capture is now handled by Electron global shortcuts

    // When in capture mode, ensure ChatGPT view is fully ready
    if (chatGPTView) {
      console.log('Preparing ChatGPT view for input capture');

      // Make sure the ChatGPT input is ready
      chatGPTView.webContents.executeJavaScript(`
        (function() {
          // Find the main input field
          const inputField = document.querySelector('textarea') ||
                            document.querySelector('[contenteditable="true"]') ||
                            document.querySelector('input[type="text"]');

          // If found, force focus it
          if (inputField) {
            inputField.focus();
            // Create a visual indication that the input is active
            inputField.style.outline = '2px solid rgba(0, 255, 255, 0.5)';
            return 'Input field focused successfully';
          }

          return 'No input field found';
        })()
      `).then(result => {
        console.log('ChatGPT input preparation:', result);
      }).catch(err => {
        console.error('Error preparing ChatGPT input:', err);
      });
    }
  } else {
    console.log('==== INPUT CAPTURE DISABLED ====');
    // Input capture is now handled by Electron global shortcuts

    // Remove any visual indicators from ChatGPT input
    if (chatGPTView) {
      chatGPTView.webContents.executeJavaScript(`
        (function() {
          const inputField = document.querySelector('textarea') ||
                            document.querySelector('[contenteditable="true"]') ||
                            document.querySelector('input[type="text"]');

          if (inputField) {
            inputField.style.outline = '';
            return true;
          }
          return false;
        })()
      `).catch(err => {
        console.error('Error resetting ChatGPT input:', err);
      });
    }
  }

  if (mainWindow) {
    // Configure mouse event handling based on stealth cursor mode
    if (stealthCursorEnabled) {
      // Stealth mode: always pass-through mouse events to underlying app
      mainWindow.setIgnoreMouseEvents(true, { forward: true });
    } else {
      // Normal cursor mode: capture mouse events in our window
      mainWindow.setIgnoreMouseEvents(false);
    }

    // Make sure the window is set up correctly for the current state
    if (enabled) {
      // Defensive settings to ensure proper behavior
      mainWindow.setFocusable(true);                       // Allow focus for keyboard capture
      mainWindow.setAlwaysOnTop(true, 'screen-saver');     // Stay on top
      mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); // Visible in fullscreen
    }
  }
}

// Setup better global keyboard shortcuts
function setupKeyboardCapture() {
  // Keyboard capture is now handled entirely by Electron global shortcuts
  console.log("Setting up keyboard capture using Electron global shortcuts");

  // Register essential global shortcuts
  globalShortcut.register('Escape', () => {
    if (isAppVisible) {
      isAppVisible = false;
      hideWindow();
      cursors.restoreCursor();
      toggleInputCapture(false);
      return true;
    }
    return false;
  });
}

// Function to handle a key press
function handleKeypress(key: string) {
  if (!chatGPTView || !isAppVisible) return;

  console.log('Processing key:', key);

  // Special keys
  if (key === 'Escape') {
    isAppVisible = false;
    hideWindow();
    cursors.restoreCursor();
    toggleInputCapture(false);
    return;
  } else if (key === 'Enter') {
    // Click at cursor position
    chatGPTView.webContents.executeJavaScript('window.fakeCursorClick && window.fakeCursorClick()').catch(err => {
      console.error('Error executing fake cursor click:', err);
    });
    return;
  }

  // Handle cursor movement with arrow keys
  if (key === 'ArrowUp') {
    fakeCursorPosition.y = Math.max(0, fakeCursorPosition.y - 20);
    updateFakeCursor();
    return;
  } else if (key === 'ArrowDown') {
    fakeCursorPosition.y = Math.min(mainWindow!.getBounds().height, fakeCursorPosition.y + 20);
    updateFakeCursor();
    return;
  } else if (key === 'ArrowLeft') {
    fakeCursorPosition.x = Math.max(0, fakeCursorPosition.x - 20);
    updateFakeCursor();
    return;
  } else if (key === 'ArrowRight') {
    fakeCursorPosition.x = Math.min(mainWindow!.getBounds().width, fakeCursorPosition.x + 20);
    updateFakeCursor();
    return;
  }

  // For text entry, send the character directly
  if (key && key.length === 1) {
    console.log('Sending character to ChatGPT:', key);
    sendCharToWebView(key);
  }
}

// Helper function to send a character to the ChatGPT webview
function sendCharToWebView(char: string) {
  if (!chatGPTView) return;

  // Handle special characters - do appropriate conversions
  let charToInsert = char;
  let keyName = char;
  let isSpecial = false;

  // Map special characters
  if (char === '\b') {
    charToInsert = '';  // No actual character to insert
    keyName = 'Backspace';
    isSpecial = true;
  } else if (char === '\n') {
    charToInsert = '\n';
    keyName = 'Enter';
    isSpecial = true;
  } else if (char === '\t') {
    charToInsert = '\t';
    keyName = 'Tab';
    isSpecial = true;
  }

  // Add console log to confirm this function is being called with the right character
  //console.log(`Sending ${isSpecial ? 'special key' : 'character'} to ChatGPT webview: '${keyName}'`);

  if (isSpecial) {
    // For special keys, we need specific handling
    if (keyName === 'Backspace') {
      chatGPTView.webContents.executeJavaScript(`
        (function() {
          console.log('Executing special key: Backspace');

          const inputField = document.querySelector('textarea[placeholder="Message ChatGPT…"]') ||
                           document.querySelector('textarea[data-id="root"]') ||
                           document.querySelector('textarea[tabindex="0"]') ||
                           document.querySelector('textarea') ||
                           document.querySelector('[contenteditable="true"]') ||
                           document.querySelector('input[type="text"]');

          if (inputField) {
            console.log('Found input field for backspace');

            // Force focus
            inputField.focus();

            if (inputField.tagName === 'TEXTAREA' || inputField.tagName === 'INPUT') {
              const start = inputField.selectionStart || 0;
              const end = inputField.selectionEnd || start;

              // If text is selected, delete the selection
              if (start !== end) {
                inputField.value = inputField.value.substring(0, start) + inputField.value.substring(end);
                inputField.selectionStart = inputField.selectionEnd = start;
              }
              // Otherwise delete the character before cursor
              else if (start > 0) {
                inputField.value = inputField.value.substring(0, start - 1) + inputField.value.substring(start);
                inputField.selectionStart = inputField.selectionEnd = start - 1;
              }
            } else if (inputField.isContentEditable) {
              // For contenteditable elements
              const selection = window.getSelection();
              if (selection && selection.rangeCount > 0) {
                const range = selection.getRangeAt(0);
                // If there's a selection, delete it
                if (!range.collapsed) {
                  range.deleteContents();
                }
                // Otherwise delete character behind cursor
                else {
                  range.setStart(range.startContainer, Math.max(0, range.startOffset - 1));
                  range.deleteContents();
                }
              }
            }

            // Dispatch events to ensure UI updates
            const events = ['input', 'change'];
            events.forEach(eventType => {
              inputField.dispatchEvent(new Event(eventType, { bubbles: true }));
            });

            // Also try the execCommand approach
            try {
              document.execCommand('delete', false, null);
            } catch (e) {
              console.warn('execCommand delete failed:', e);
            }

            return true;
          }
          return false;
        })()
      `).then(result => {
        // console.log('Backspace result:', result);
      }).catch(err => {
        console.error('Error executing backspace:', err);
      });
      return;
    }
    else if (keyName === 'Enter') {
      chatGPTView.webContents.executeJavaScript(`
        (function() {
          console.log('Executing special key: Enter');

          // We no longer automatically click submit button with plain Enter key
          // Instead, we'll use Command+Enter for that purpose

          const inputField = document.querySelector('textarea[placeholder="Message ChatGPT…"]') ||
                          document.querySelector('textarea[data-id="root"]') ||
                          document.querySelector('textarea[tabindex="0"]') ||
                          document.querySelector('textarea') ||
                          document.querySelector('[contenteditable="true"]') ||
                          document.querySelector('input[type="text"]');

          if (inputField) {
            console.log('Found input field for enter key');

            // Force focus
            inputField.focus();

            // First check if this is a single-line input (likely a search/chat box)
            const isSingleLine = inputField.tagName === 'INPUT' ||
                                (inputField.tagName === 'TEXTAREA' &&
                                (inputField.rows === 1 || inputField.getAttribute('data-single-line') === 'true'));

            if (isSingleLine) {
              console.log('Detected single-line input, but not auto-submitting (use Command+Enter)');

              // Regular Enter key no longer submits - just triggers keyboard events
              // For forms that absolutely need Enter to submit, we'll still allow that specific behavior
              const form = inputField.closest('form');
              if (form && form.getAttribute('data-auto-submit') === 'true') {
                console.log('Form has data-auto-submit attribute, submitting directly');
                form.dispatchEvent(new Event('submit', { bubbles: true }));
                return true;
              }
            } else {
              console.log('Multi-line input, inserting newline');
              // For multi-line inputs, insert a newline
              if (inputField.tagName === 'TEXTAREA') {
                const start = inputField.selectionStart || 0;
                const end = inputField.selectionEnd || start;

                // Insert a newline at cursor position
                inputField.value = inputField.value.substring(0, start) +
                                "\\n" +
                                inputField.value.substring(end);

                // Move cursor after the inserted newline
                inputField.selectionStart = inputField.selectionEnd = start + 1;
              } else if (inputField.isContentEditable) {
                // For contenteditable use execCommand
                document.execCommand('insertLineBreak', false, null);
              }
            }

            // Dispatch both keyboard and change events
            ['keydown', 'keypress', 'keyup'].forEach(eventType => {
              const event = new KeyboardEvent(eventType, { key: 'Enter', code: 'Enter', bubbles: true });
              inputField.dispatchEvent(event);
            });

            // Also trigger form events
            inputField.dispatchEvent(new Event('input', { bubbles: true }));
            inputField.dispatchEvent(new Event('change', { bubbles: true }));

            return true;
          }

          // No input field or button found, try clicking at the fake cursor position
          console.log('Attempting to click at fake cursor position');
          if (typeof window.fakeCursorClick === 'function') {
            window.fakeCursorClick();
            return true;
          }

          return false;
        })()
      `).then(result => {
        console.log('Enter key result:', result);
      }).catch(err => {
        console.error('Error executing enter key:', err);
      });
      return;
    }
  }

  // Execute more specific ChatGPT input field detection and text insertion
  chatGPTView.webContents.executeJavaScript(`
    (function() {
      console.log('Executing character insertion for: ' + '${charToInsert}');

      // More specific selectors for ChatGPT input field
      const inputField = document.querySelector('textarea[placeholder="Message ChatGPT…"]') ||
                       document.querySelector('textarea[data-id="root"]') ||
                       document.querySelector('textarea[tabindex="0"]') ||
                       document.querySelector('textarea') ||
                       document.querySelector('[contenteditable="true"]') ||
                       document.querySelector('input[type="text"]');

      if (inputField) {
        console.log('Found input field:', inputField.tagName, inputField.getAttribute('placeholder') || '(no placeholder)');

        // Force focus the input field first
        inputField.focus();

        // For debugging - highlight the input field to confirm we found it
        const originalBorder = inputField.style.border;
        inputField.style.border = '2px solid magenta';
        setTimeout(() => { inputField.style.border = originalBorder; }, 500);

        try {
          // Try different approaches to insert text

          // Approach 1: Directly modify value/textContent
          if (inputField.tagName === 'TEXTAREA' || inputField.tagName === 'INPUT') {
            const start = inputField.selectionStart || 0;
            const end = inputField.selectionEnd || start;

            const oldValue = inputField.value || '';
            const newValue = oldValue.substring(0, start) + '${charToInsert}' + oldValue.substring(end);

            console.log('Setting value from:', JSON.stringify(oldValue), 'to:', JSON.stringify(newValue));
            inputField.value = newValue;

            // Move cursor after the inserted character
            inputField.selectionStart = inputField.selectionEnd = start + 1;
          } else if (inputField.isContentEditable) {
            // For contenteditable elements
            const selection = window.getSelection();
            if (selection && selection.rangeCount > 0) {
              const range = selection.getRangeAt(0);
              const textNode = document.createTextNode('${charToInsert}');
              range.deleteContents();
              range.insertNode(textNode);

              // Move cursor after inserted text
              range.setStartAfter(textNode);
              range.setEndAfter(textNode);
              selection.removeAllRanges();
              selection.addRange(range);
            } else {
              // Fallback if no selection
              inputField.textContent = (inputField.textContent || '') + '${charToInsert}';
            }
          }

          // Approach 2: Use execCommand (legacy but sometimes works)
          document.execCommand('insertText', false, '${charToInsert}');

          // Approach 3: Simulate keyboard events
          ['keydown', 'keypress', 'keyup'].forEach(eventType => {
            const event = new KeyboardEvent(eventType, {
              key: '${charToInsert}',
              code: '${charToInsert.length === 1 ? 'Key' + charToInsert.toUpperCase() : charToInsert}',
              bubbles: true,
              cancelable: true
            });
            inputField.dispatchEvent(event);
          });

          // Approach 4: Create a "beforeinput" event for modern browsers
          const inputEvent = new InputEvent('beforeinput', {
            bubbles: true,
            cancelable: true,
            inputType: 'insertText',
            data: '${charToInsert}'
          });
          inputField.dispatchEvent(inputEvent);

          // Trigger React/framework update events
          inputField.dispatchEvent(new Event('input', { bubbles: true }));
          inputField.dispatchEvent(new Event('change', { bubbles: true }));

          console.log('Character insertion complete');
          return true;
        } catch (e) {
          console.error('Error inserting character:', e);
          return false;
        }
      } else {
        console.error('No input field found in ChatGPT UI');

        // Desperate measure: try to find any input element
        const allInputs = Array.from(document.querySelectorAll('input, textarea, [contenteditable]'));
        console.log('Found ' + allInputs.length + ' potential input elements');

        if (allInputs.length > 0) {
          console.log('First input element:', allInputs[0].tagName, allInputs[0].getAttribute('placeholder') || '(no placeholder)');
        }

        return false;
      }
    })();
  `).then(result => {
   // console.log('Character insertion result:', result);
  }).catch(err => {
    console.error('Error executing character insertion script:', err);
  });
}

// Helper function to update the fake cursor position
function updateFakeCursor() {
  if (!chatGPTView) return;

  // Update the fake cursor position in the ChatGPT view
  chatGPTView.webContents.executeJavaScript(`
    if (typeof window.moveFakeCursor === 'function') {
      window.moveFakeCursor(${fakeCursorPosition.x}, ${fakeCursorPosition.y});

      // Enhance the fakeCursorClick function to improve click detection
      window.fakeCursorClick = function() {
        const x = ${fakeCursorPosition.x};
        const y = ${fakeCursorPosition.y};

        // Log click position for debugging
        console.log('Attempting fake cursor click at:', x, y);

        // First try to find element at position and click it
        const element = document.elementFromPoint(x, y);
        if (element) {
          console.log('Found element at cursor position:', element.tagName,
                    element.id ? 'id=' + element.id : '',
                    element.className ? 'class=' + element.className : '');

          // Check if the element is the submit button
          if (element.id === 'composer-submit-button' ||
              element.getAttribute('aria-label') === 'Submit message') {
            console.log('Found submit button, clicking it');
          }

          // Click the element
          element.click();

          // Visual feedback
          const clickEffect = document.createElement('div');
          clickEffect.style.position = 'fixed';
          clickEffect.style.left = (x - 5) + 'px';
          clickEffect.style.top = (y - 5) + 'px';
          clickEffect.style.width = '10px';
          clickEffect.style.height = '10px';
          clickEffect.style.borderRadius = '50%';
          clickEffect.style.backgroundColor = 'rgba(255, 0, 255, 0.7)';
          clickEffect.style.pointerEvents = 'none';
          clickEffect.style.zIndex = '10000';
          clickEffect.style.transition = 'all 0.2s ease-out';

          document.body.appendChild(clickEffect);

          setTimeout(() => {
            clickEffect.style.transform = 'scale(2)';
            clickEffect.style.opacity = '0';
          }, 10);

          setTimeout(() => {
            document.body.removeChild(clickEffect);
          }, 200);

          return true;
        } else {
          console.log('No element found at cursor position');
          return false;
        }
      };
    }
  `).catch(err => {
    console.error('Error moving fake cursor:', err);
  });
}

// Function to toggle between different layout modes or set a specific layout
function toggleLayout(specificLayout?: number) {
  if (!mainWindow || !chatGPTView) return false;

  // Get screen dimensions
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;

  if (specificLayout !== undefined) {
    // Set to a specific layout
    currentLayout = specificLayout % 3;
  } else {
    // Only allow toggle if the app is visible
    if (!isAppVisible) return false;

    // Cycle through layouts: 0 (default) → 1 (vertical right) → 2 (vertical left) → 0 (default)
    currentLayout = (currentLayout + 1) % 3;
  }

  console.log(`Switching to layout mode ${currentLayout}`);

  // Save layout setting to disk (only when actively toggled, not during initialization)
  if (specificLayout === undefined) {
    saveSettings({ layout: currentLayout });
  }

  // Calculate new bounds based on the layout mode
  let newBounds = { x: 0, y: 0, width: 0, height: 0 };

  switch (currentLayout) {
    case 0: // Default centered layout
      // Use standard size, centered on screen
      const width  = Math.floor(screenWidth  * 0.85);
      const height = Math.floor(screenHeight * 0.95);

      newBounds = {
        width: width,
        height: height,
        x: Math.floor((screenWidth  - width)  / 2),
        y: Math.floor((screenHeight - height) / 2)
      };
      break;

    case 1: // Vertical right layout
      // Narrow view on the right side
      newBounds = {
        width: Math.floor(screenWidth * 0.35),
        height: Math.floor(screenHeight * 0.95),
        x: Math.floor(screenWidth * 0.63),
        y: Math.floor(screenHeight * 0.05)
      };
      break;

    case 2: // Vertical left layout
      // Narrow view on the left side
      newBounds = {
        width: Math.floor(screenWidth * 0.35),
        height: Math.floor(screenHeight * 0.95),
        x: Math.floor(screenWidth * 0.02),
        y: Math.floor(screenHeight * 0.05)
      };
      break;
  }

  // Apply new window bounds
  mainWindow.setBounds(newBounds);

  // Ensure the ChatGPT view fills the entire window
  chatGPTView.setBounds({
    x: 0,
    y: 0,
    width: newBounds.width,
    height: newBounds.height
  });

    // Show a visual indicator of layout change (only when toggling, not during initial launch)
  if (specificLayout === undefined && isAppVisible) {
    chatGPTView.webContents.executeJavaScript(`
      (function() {
        // Create a temporary notification element if it doesn't exist
        let notification = document.getElementById('layout-notification');
        if (!notification) {
          notification = document.createElement('div');
          notification.id = 'layout-notification';
          notification.style.position = 'fixed';
          notification.style.top = '10px';
          notification.style.left = '50%';
          notification.style.transform = 'translateX(-50%)';
          notification.style.backgroundColor = 'rgba(16, 163, 127, 0.9)';
          notification.style.color = 'white';
          notification.style.padding = '8px 16px';
          notification.style.borderRadius = '6px';
          notification.style.zIndex = '9999';
          notification.style.fontWeight = 'bold';
          notification.style.fontSize = '14px';
          notification.style.boxShadow = '0 2px 10px rgba(0, 0, 0, 0.3)';
          document.body.appendChild(notification);
        }

        // Update notification text based on layout
        const layoutName = ${currentLayout} === 0 ? 'Default Centered' :
                          ${currentLayout} === 1 ? 'Vertical Right' : 'Vertical Left';
        notification.textContent = 'Layout: ' + layoutName;

        // Show the notification
        notification.style.opacity = '1';
        notification.style.transition = 'opacity 0.3s';

        // Hide after 2 seconds
        setTimeout(() => {
          notification.style.opacity = '0';
          setTimeout(() => {
            if (notification.parentNode) {
              notification.parentNode.removeChild(notification);
            }
          }, 300);
        }, 2000);
      })();
    `).catch(err => {
      console.error('Error showing layout notification:', err);
    });
  }

  return true;
}

// Function to switch between ChatGPT models
async function switchChatGPTModel() {
  if (!chatGPTView || !isAppVisible) {
    console.log('Cannot switch model - ChatGPT view not available or app not visible');
    return false;
  }

  console.log('Attempting to switch ChatGPT model...');

  try {
    // First, check if user is logged in and get user info
    const loginInfo = await isLoggedIntoChatGPT();
    if (!loginInfo || !loginInfo.isLoggedIn) {
      console.log('User is not logged in to ChatGPT. Cannot switch models.');

      // Show notification to user
      chatGPTView.webContents.executeJavaScript(`
        (function() {
          const notification = document.createElement('div');
          notification.textContent = 'Please log in to ChatGPT to switch models';
          notification.style.position = 'fixed';
          notification.style.top = '10px';
          notification.style.left = '50%';
          notification.style.transform = 'translateX(-50%)';
          notification.style.backgroundColor = 'rgba(255, 59, 48, 0.9)';
          notification.style.color = 'white';
          notification.style.padding = '8px 16px';
          notification.style.borderRadius = '6px';
          notification.style.zIndex = '9999';
          notification.style.fontWeight = 'bold';
          notification.style.fontSize = '14px';
          notification.style.boxShadow = '0 2px 10px rgba(0, 0, 0, 0.3)';

          document.body.appendChild(notification);

          setTimeout(() => {
            notification.style.opacity = '0';
            notification.style.transition = 'opacity 0.3s';
            setTimeout(() => notification.remove(), 300);
          }, 3000);

          return false;
        })()
      `);

      return false;
    }



    // Proceed with model switching
    const modelSwitched = await chatGPTView.webContents.executeJavaScript(`
      (async function() {
        try {
          // Click the model switcher dropdown button
          const modelSwitcherButton = document.querySelector('button[data-testid="model-switcher-dropdown-button"]');
          if (!modelSwitcherButton) {
            console.log('Model switcher button not found');
            return false;
          }

          console.log('Clicking model switcher button...');
          modelSwitcherButton.click();

          // Wait for the menu to appear
          await new Promise(resolve => setTimeout(resolve, 500));

          // Find the menu
          const menu = document.querySelector('div[role="menu"][data-side="bottom"][data-align="center"][data-radix-menu-content]');
          if (!menu) {
            console.log('Model menu not found');
            return false;
          }

          // Get all menu items (excluding those with data-state attribute)
          const menuItems = Array.from(menu.querySelectorAll('div[role="menuitem"]'))
            .filter(item => !item.hasAttribute('data-state'));

          if (!menuItems.length) {
            console.log('No model menu items found');
            return false;
          }

          console.log('Found ' + menuItems.length + ' model options');

          // Find the currently selected model (has an SVG inside)
          let currentIndex = -1;
          menuItems.forEach((item, index) => {
            if (item.querySelector('svg')) {
              currentIndex = index;
            }
          });

          // If we couldn't identify the current model, default to first
          if (currentIndex === -1) {
            currentIndex = 0;
          }

          // Calculate the next model index
          const nextIndex = (currentIndex + 1) % menuItems.length;
          const nextModel = menuItems[nextIndex];

          // Get the name of the next model
          const nextModelName = nextModel.textContent || 'Next model';
          console.log('Switching to model: ' + nextModelName);

          // Click the next model
          nextModel.click();

          // Show a success notification
          setTimeout(() => {
            const notification = document.createElement('div');
            notification.textContent = 'Switched to ' + nextModelName;
            notification.style.position = 'fixed';
            notification.style.top = '10px';
            notification.style.left = '50%';
            notification.style.transform = 'translateX(-50%)';
            notification.style.backgroundColor = 'rgba(16, 163, 127, 0.9)';
            notification.style.color = 'white';
            notification.style.padding = '8px 16px';
            notification.style.borderRadius = '6px';
            notification.style.zIndex = '9999';
            notification.style.fontWeight = 'bold';
            notification.style.fontSize = '14px';
            notification.style.boxShadow = '0 2px 10px rgba(0, 0, 0, 0.3)';

            document.body.appendChild(notification);

            setTimeout(() => {
              notification.style.opacity = '0';
              notification.style.transition = 'opacity 0.3s';
              setTimeout(() => notification.remove(), 300);
            }, 3000);
          }, 500);

          return true;
        } catch (error) {
          console.error('Error switching model:', error);
          return false;
        }
      })()
    `);

    return modelSwitched;
  } catch (error) {
    console.error('Error in switchChatGPTModel:', error);
    return false;
  }
}

// Function to handle key shortcuts
function handleKeyPress(key: string) {
  if (!isAppVisible || !chatGPTView) return;

  // Track keyboard shortcut usage
  if (key === 'CommandOrControlEnter' ||
      key === 'CommandOrControlDelete' ||
      key === 'CommandOrControlS' ||
      key === 'CommandOrControlV' ||
      key === 'CommandOrControlM') {
    console.log('Feature used: keyboard_shortcut_' + key);
  }

  // console.log(`Global shortcut pressed: ${key}`);

  // Special cases for different key types
  if (key === 'ArrowUp' || key === 'ArrowDown' || key === 'ArrowLeft' || key === 'ArrowRight') {
    // Handle arrow keys (cursor movement)
    const step = 20;
    if (key === 'ArrowUp') {
      fakeCursorPosition.y = Math.max(0, fakeCursorPosition.y - step);
    } else if (key === 'ArrowDown') {
      fakeCursorPosition.y = Math.min(mainWindow!.getBounds().height, fakeCursorPosition.y + step);
    } else if (key === 'ArrowLeft') {
      fakeCursorPosition.x = Math.max(0, fakeCursorPosition.x - step);
    } else if (key === 'ArrowRight') {
      fakeCursorPosition.x = Math.min(mainWindow!.getBounds().width, fakeCursorPosition.x + step);
    }

    // Update the fake cursor in the ChatGPT view
    updateFakeCursor();

  } else if (key === 'Enter') {
    // For Enter key, we need to check if we should click at the fake cursor position
    // or send Enter to the input field

    // First, try clicking at the fake cursor position
    chatGPTView.webContents.executeJavaScript(`
      (function() {
        console.log('Enter key pressed - checking if we should click at cursor position');

        // This is our fake cursor click function - try to click at the current cursor position
        if (typeof window.fakeCursorClick === 'function') {
          console.log('Clicking at fake cursor position');
          window.fakeCursorClick();
          return true;
        }

        // No fake cursor click function found - fallback to looking for input field
        console.log('No fakeCursorClick function found, looking for input');

        // Check if there's a focused input element that should get Enter
        const activeElement = document.activeElement;
        const isInputElement = activeElement.tagName === 'INPUT' ||
                             activeElement.tagName === 'TEXTAREA' ||
                             activeElement.isContentEditable;

        if (isInputElement) {
          console.log('Input element has focus, sending regular Enter key (not submitting)');
          // No longer automatically clicking submit buttons - use Command+Enter instead
          return false;
        }

        return false;
      })()
    `).then(result => {
      if (!result) {
        // If direct click failed, use our standard character insertion method
        // console.log('Direct click failed, using character insertion method');
        sendCharToWebView('\n');
      } else {
        console.log('Successfully clicked at cursor position');
      }
    }).catch(err => {
      console.error('Error with Enter key handling:', err);
      // Fallback to character method
      sendCharToWebView('\n');
    });
  } else if (key === 'CommandOrControlEnter') {
    // Make sure chatGPTView exists
    if (!chatGPTView) {
      console.error('Cannot send message: chatGPTView is null');
      return;
    }

    // Proceed with sending the message
    chatGPTView.webContents.executeJavaScript(`
      (function() {
        console.log('Command+Enter pressed - attempting to submit message');

        // First try to find the specific composer-submit-button
        const submitButton = document.getElementById('composer-submit-button');
        if (submitButton) {
          console.log('Found composer-submit-button, clicking it');
          submitButton.click();
          return true;
        }

        // If specific button not found, try other selectors
        const alternateButtons = [
          document.querySelector('button[aria-label="Submit message"]'),
          document.querySelector('button.send-button'),
          document.querySelector('button[type="submit"]'),
          document.querySelector('form')?.querySelector('button[type="submit"]'),
          // Find any button that looks like a submit button
          Array.from(document.querySelectorAll('button'))
            .find(btn => {
              const text = btn.textContent?.toLowerCase() || '';
              const ariaLabel = btn.getAttribute('aria-label')?.toLowerCase() || '';
              return text.includes('send') || text.includes('submit') ||
                    ariaLabel.includes('send') || ariaLabel.includes('submit') ||
                    btn.classList.contains('send'); // Common class for send buttons
            })
        ].filter(Boolean);

        if (alternateButtons.length > 0) {
          console.log('Found alternate submit button, clicking it');
          alternateButtons[0].click();
          return true;
        }

        console.log('No submit button found');
        return false;
      })()
    `).then(result => {
      console.log('Command+Enter submit result:', result);
    }).catch(err => {
      console.error('Error with Command+Enter handling:', err);
    });
  } else if (key === 'CommandOrControlDelete') {
    console.log('===== HANDLING CLEAR COMMAND =====');
    // Handle Command+Delete to clear the ChatGPT prompt
    chatGPTView.webContents.executeJavaScript(`
      (function() {
        console.log('Clearing the ChatGPT prompt - triggered by keyboard shortcut');

        // Try to find the prompt textarea specifically by ID
        const promptTextarea = document.getElementById('prompt-textarea');
        if (promptTextarea) {
          console.log('Found prompt-textarea by ID, clearing it');

          // Different input types need different clear methods
          if (promptTextarea.tagName === 'TEXTAREA' || promptTextarea.tagName === 'INPUT') {
            console.log('Element is a TEXTAREA or INPUT, setting value=""');
            // For standard input elements
            promptTextarea.value = '';
          } else {
            console.log('Element is a ' + promptTextarea.tagName + ', clearing content');
            // For div based inputs - may have paragraph inside
            const paragraph = promptTextarea.querySelector('p');
            if (paragraph) {
              // If there's a paragraph inside, clear it
              console.log('Found paragraph inside, clearing its textContent');
              paragraph.textContent = '';
            } else {
              // Otherwise clear the element directly
              console.log('No paragraph found, clearing element textContent directly');
              promptTextarea.textContent = '';
            }
          }

          // Trigger events to ensure UI updates
          console.log('Dispatching input and change events');
          promptTextarea.dispatchEvent(new Event('input', { bubbles: true }));
          promptTextarea.dispatchEvent(new Event('change', { bubbles: true }));

          // Focus the textarea
          promptTextarea.focus();

          return true;
        }

        console.log('Could not find #prompt-textarea, trying alternate selectors');

        // If specific ID not found, try common textarea selectors
        const alternateInputs = [
          document.querySelector('textarea[placeholder="Message ChatGPT…"]'),
          document.querySelector('textarea[data-id="root"]'),
          document.querySelector('textarea[tabindex="0"]'),
          document.querySelector('textarea'),
          document.querySelector('[contenteditable="true"]'),
          document.querySelector('input[type="text"]')
        ].filter(Boolean);

        console.log('Found ' + alternateInputs.length + ' potential input elements');

        if (alternateInputs.length > 0) {
          const input = alternateInputs[0];
          console.log('Using first match: ' + input.tagName +
                     (input.placeholder ? ' with placeholder ' + input.placeholder : '') +
                     (input.id ? ' with id ' + input.id : ''));

          if (input.tagName === 'TEXTAREA' || input.tagName === 'INPUT') {
            input.value = '';
          } else {
            input.textContent = '';
          }

          // Trigger events
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));

          // Focus the input
          input.focus();

          return true;
        }

        console.log('No input field found to clear');

        // Last resort - try to find and clear any element that looks like it might be an input
        const possibleInputs = Array.from(document.querySelectorAll('*')).filter(el => {
          return el.tagName === 'DIV' && (
            (el.getAttribute('role') === 'textbox') ||
            (el.contentEditable === 'true') ||
            (el.classList.contains('input')) ||
            (el.classList.contains('textarea'))
          );
        });

        if (possibleInputs.length > 0) {
          console.log('Found ' + possibleInputs.length + ' possible DIV-based inputs as last resort');
          const divInput = possibleInputs[0];
          divInput.textContent = '';
          divInput.dispatchEvent(new Event('input', { bubbles: true }));
          divInput.focus();
          return true;
        }

        return false;
      })()
    `).then(result => {
      console.log('Command+Delete clear result:', result);
    }).catch(err => {
      console.error('Error with Command+Delete handling:', err);
    });
  } else if (key === 'CommandOrControlS') {
    // Handle Command+S to take a screenshot and drop it into ChatGPT
    console.log('===== HANDLING SCREENSHOT AND DROP =====');

    // Step 1: Temporarily hide the window to take screenshot of what's underneath
    if (mainWindow) {
      const wasVisible = !mainWindow.isMinimized() && mainWindow.isVisible();

      // Hide the overlay window
      mainWindow.hide();

      // Wait a brief moment for the window to fully hide
      setTimeout(async () => {
        try {
          // Get the primary display
          const primaryDisplay = screen.getPrimaryDisplay();
          const { bounds } = primaryDisplay;

          console.log('Requesting screen capture permissions...');

          // On macOS, ensure screen recording permission is granted
          if (process.platform === 'darwin') {
            // Check if we have screen capture permission using system dialog
            const { systemPreferences } = require('electron');
            const hasScreenCapturePermission = systemPreferences.getMediaAccessStatus('screen');

            console.log('Screen capture permission status:', hasScreenCapturePermission);

            if (hasScreenCapturePermission !== 'granted') {
              // Request permission explicitly
              systemPreferences.askForMediaAccess('screen')
                .then((isGranted: boolean) => {
                  console.log('Screen capture permission granted:', isGranted);
                  if (!isGranted) {
                    dialog.showMessageBoxSync({
                      type: 'warning',
                      title: 'Permission Required',
                      message: 'Screen recording permission is required for screenshots.\nPlease enable it in System Preferences > Security & Privacy > Privacy > Screen Recording',
                      buttons: ['OK']
                    });
                  }
                });
            }
          }

          console.log('Capturing screenshot of the screen...');

          // Use try/catch specifically for the desktop capturer
          try {
            // Capture the entire screen
            const sources = await desktopCapturer.getSources({
              types: ['screen'],
              thumbnailSize: {
                width: bounds.width,
                height: bounds.height
              }
            });

            console.log(`Found ${sources.length} screen sources:`, sources.map(s => s.name));

            // Find the primary display source with more flexible matching
            const primarySource = sources.find(source =>
              source.name === 'Entire Screen' ||
              source.name === 'Screen 1' ||
              source.name.includes('Primary') ||
              source.name.includes('Display') ||
              source.id.includes('screen') ||
              source.name.includes('screen') ||
              // Fall back to first source if nothing specific is found
              sources.indexOf(source) === 0
            );

            if (!primarySource) {
              console.error('No screen source found for screenshot');
              throw new Error('No screen source found');
            }

            if (!primarySource.thumbnail) {
              console.error('Screen source has no thumbnail');
              throw new Error('Screen source thumbnail is missing');
            }

            // Convert the thumbnail to a dataURL
            const screenshotDataUrl = primarySource.thumbnail.toDataURL();
            console.log('Screenshot captured successfully');

            // Show the window again if it was visible before
            if (wasVisible && mainWindow) {
              mainWindow.show();
              showWithoutFocus();
            }

            // Wait a moment for the window to be visible again before dropping the screenshot
            setTimeout(() => {
              if (chatGPTView) {
                // Step 2: Simulate dropping the screenshot into the ChatGPT thread
                console.log('Simulating file drop into ChatGPT...');

                chatGPTView.webContents.executeJavaScript(`
                  (function() {
                    console.log('Starting file drop simulation for screenshot');

                    // Find the thread div to drop the image into
                    const threadContainer = document.querySelector('#thread > div');
                    if (!threadContainer) {
                      console.error('Could not find #thread > div element');

                      // Try to find any drop zone as a fallback
                      const possibleDropZones = [
                        document.querySelector('.drop-target'),
                        document.querySelector('[role="presentation"]'),
                        document.querySelector('.prose'),
                        document.querySelector('form'),
                        document.querySelector('main')
                      ].filter(Boolean);

                      if (possibleDropZones.length === 0) {
                        console.error('No drop targets found');
                        return false;
                      }

                      console.log('Using fallback drop zone:', possibleDropZones[0]);
                      threadContainer = possibleDropZones[0];
                    }

                    // Convert data URL to blob
                    const dataUrl = '${screenshotDataUrl}';
                    const byteString = atob(dataUrl.split(',')[1]);
                    const mimeType = dataUrl.split(',')[0].split(':')[1].split(';')[0];

                    const ab = new ArrayBuffer(byteString.length);
                    const ia = new Uint8Array(ab);
                    for (let i = 0; i < byteString.length; i++) {
                      ia[i] = byteString.charCodeAt(i);
                    }

                    const blob = new Blob([ab], { type: mimeType });

                    // Create File object from the blob
                    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                    const file = new File([blob], 'screenshot-' + timestamp + '.png', { type: 'image/png' });

                    console.log('Created file object:', file.name);

                    // Create a DataTransfer object and add the file
                    const dataTransfer = new DataTransfer();
                    dataTransfer.items.add(file);

                    console.log('Created DataTransfer with file');

                    // Create and dispatch the drop event
                    const dropEvent = new DragEvent('drop', {
                      bubbles: true,
                      cancelable: true,
                      dataTransfer: dataTransfer
                    });

                    // Log events for debugging
                    threadContainer.addEventListener('drop', () => {
                      console.log('Drop event fired on target');
                    }, { once: true });

                    console.log('Dispatching drop event to target element');
                    threadContainer.dispatchEvent(dropEvent);

                    // If the standard drop event doesn't work, try alternative approach with paste
                    // Try to find the textarea or input
                    const textArea = document.querySelector('#prompt-textarea') ||
                                      document.querySelector('textarea');

                    if (textArea) {
                      console.log('Found textarea, attempting to paste image via clipboard');

                      // Create a document fragment with an img element
                      const fragment = document.createDocumentFragment();
                      const img = document.createElement('img');
                      img.src = dataUrl;
                      fragment.appendChild(img);

                      // Select the textarea and dispatch a paste event
                      textArea.focus();

                      // Create a clipboard event
                      const clipboardData = new DataTransfer();
                      clipboardData.setData('text/html', '<img src="' + dataUrl + '">');

                      const pasteEvent = new ClipboardEvent('paste', {
                        bubbles: true,
                        cancelable: true,
                        clipboardData: clipboardData
                      });

                      textArea.dispatchEvent(pasteEvent);
                    }

                    return true;
                  })()
                `).then(result => {
                  console.log('File drop simulation result:', result);
                }).catch(err => {
                  console.error('Error simulating file drop:', err);
                });
              }
            }, 500); // Wait for window to be shown again
          } catch (captureError: unknown) {
            console.error('Desktop capturer error:', captureError);

            // Show a message to the user
            if (wasVisible && mainWindow) {
              mainWindow.show();
              showWithoutFocus();

              dialog.showMessageBox({
                type: 'error',
                title: 'Screenshot Failed',
                message: 'Failed to capture screenshot. Please check screen recording permissions.',
                detail: captureError instanceof Error ? captureError.message : String(captureError),
                buttons: ['OK']
              });
            }
          }
        } catch (err) {
          console.error('Error capturing or processing screenshot:', err);

          // Show the window again if it was visible before
          if (wasVisible && mainWindow) {
            mainWindow.show();
            showWithoutFocus();
          }
        }
      }, 200); // Wait for window to hide
    }
  } else if (key === 'Backspace') {
    // Send backspace character to webview with our enhanced function
    sendCharToWebView('\b'); // Special handling for backspace character
  } else if (key === 'Space') {
    // For space, insert a space character
    sendCharToWebView(' ');
  } else if (key === 'Tab') {
    // Send tab character
    sendCharToWebView('\t');
  } else if (key === 'CommandOrControlV') {
    // Handle Command+V to toggle layout
    toggleLayout();
  } else if (key === 'CommandOrControlM') {
    // Handle Command+M to switch ChatGPT models
    switchChatGPTModel();
  } else {
    // For regular characters, send them to the webview
    sendCharToWebView(key);
  }
}

// Function to unregister all individual key shortcuts
function unregisterAllKeyShortcuts() {
  console.log('Unregistering all individual key shortcuts');
  globalShortcut.unregisterAll();
  // Re-register our main toggle shortcut
  registerGlobalShortcuts();
}

// Register all individual key shortcuts when the overlay is visible
function registerAllKeyShortcuts() {
  console.log('Registering individual key shortcuts...');

  // Common keys to register
  const alphaKeys = 'abcdefghijklmnopqrstuvwxyz'.split('');
  const numberKeys = '0123456789'.split('');
  const specialKeys = [
    'Space', 'Backspace', 'Tab', 'Enter',
    'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
    '-', '=', '[', ']', '\\', ';', "'", ',', '.', '/',
    // Additional special keys that don't require shift
    '`'
  ];

  // Special characters that typically require shift
  const shiftSpecialKeys = [
    // Shift + number keys
    { key: '!', code: 'Shift+1' }, // Shift+1
    { key: '@', code: 'Shift+2' }, // Shift+2
    { key: '#', code: 'Shift+3' }, // Shift+3
    { key: '$', code: 'Shift+4' }, // Shift+4
    { key: '%', code: 'Shift+5' }, // Shift+5
    { key: '^', code: 'Shift+6' }, // Shift+6
    { key: '&', code: 'Shift+7' }, // Shift+7
    { key: '*', code: 'Shift+8' }, // Shift+8
    { key: '(', code: 'Shift+9' }, // Shift+9
    { key: ')', code: 'Shift+0' }, // Shift+0

    // Shift + special keys
    { key: '_', code: 'Shift+-' },  // Shift+minus
    { key: '+', code: 'Shift+=' },  // Shift+equals
    { key: '{', code: 'Shift+[' },  // Shift+left bracket
    { key: '}', code: 'Shift+]' },  // Shift+right bracket
    { key: '|', code: 'Shift+\\' }, // Shift+backslash
    { key: ':', code: 'Shift+;' },  // Shift+semicolon
    { key: '"', code: "Shift+'" },  // Shift+quote
    { key: '<', code: 'Shift+,' },  // Shift+comma
    { key: '>', code: 'Shift+.' },  // Shift+period
    { key: '?', code: 'Shift+/' },  // Shift+slash
    { key: '~', code: 'Shift+`' }   // Shift+backtick
  ];

  // All keys to register
  const allKeys = [...alphaKeys, ...numberKeys, ...specialKeys];

  // Count of successfully registered keys
  let successCount = 0;

  // Register each key
  allKeys.forEach(key => {
    // For letter keys, register both lowercase and shift+key (uppercase)
    if (alphaKeys.includes(key)) {
      // Register lowercase version (without shift)
      const registered = globalShortcut.register(key, () => handleKeyPress(key));
      if (registered) successCount++;

      // Also register uppercase version (with shift) for letter keys
      const uppercaseKey = key.toUpperCase();
      const registeredUpper = globalShortcut.register(`Shift+${key}`, () => handleKeyPress(uppercaseKey));
      if (registeredUpper) {
        successCount++;
        //console.log(`Registered uppercase key: ${uppercaseKey}`);
      }
    } else {
      // For non-letter keys (numbers, special keys, etc.)
      let shortcutKey = key;

      // Map keys to their Electron shortcut representation
      if (key === 'Space') shortcutKey = 'Space';
      else if (key === 'Backspace') shortcutKey = 'Backspace';
      else if (key === 'Tab') shortcutKey = 'Tab';
      else if (key === 'Enter') shortcutKey = 'Return';
      else if (key.startsWith('Arrow')) shortcutKey = key.replace('Arrow', '');

      // Register the shortcut
      const registered = globalShortcut.register(shortcutKey, () => handleKeyPress(key));
      if (registered) successCount++;
    }
  });

  // Register special characters that require shift key
  shiftSpecialKeys.forEach(specialChar => {
    const registered = globalShortcut.register(specialChar.code, () => handleKeyPress(specialChar.key));
    if (registered) {
      successCount++;
     // console.log(`Registered shifted special character: ${specialChar.key}`);
    } else {
      // console.warn(`Failed to register shifted special character: ${specialChar.key}`);
    }
  });

  // Register Command+Enter as a special shortcut for submitting
  const registeredCommandEnter = globalShortcut.register('CommandOrControl+Return',
    () => handleKeyPress('CommandOrControlEnter'));

  if (registeredCommandEnter) {
    successCount++;
    // console.log('Successfully registered Command+Enter shortcut for submission');
  } else {
    // //console.error('Failed to register Command+Enter shortcut');
  }

  // Register Command+Delete to clear the input field - try multiple key combinations for different platforms
  console.log('Attempting to register Command+Delete shortcut...');

  // Try multiple formats to ensure compatibility across platforms
  let registeredCommandDelete = false;

  // First attempt - standard format
  registeredCommandDelete = globalShortcut.register('CommandOrControl+Delete', () => {
    console.log('CommandOrControl+Delete triggered!');
    handleKeyPress('CommandOrControlDelete');
  });

  // If first attempt failed, try platform-specific formats
  if (!registeredCommandDelete) {
    console.log('First attempt to register Command+Delete failed, trying alternatives...');

    if (process.platform === 'darwin') {
      // macOS specific formats
      const macFormats = ['Command+Delete', 'Command+Backspace', 'cmd+delete', 'cmd+backspace'];

      for (const format of macFormats) {
        //console.log(`Trying to register ${format}...`);
        registeredCommandDelete = globalShortcut.register(format, () => {
          console.log(`${format} triggered!`);
          handleKeyPress('CommandOrControlDelete');
        });

        if (registeredCommandDelete) {
          // console.log(`Successfully registered ${format} for clearing input`);
          break;
        }
      }
    } else {
      // Windows/Linux specific formats
      const winFormats = ['Control+Delete', 'ctrl+delete', 'ctrl+del'];

      for (const format of winFormats) {
        // console.log(`Trying to register ${format}...`);
        registeredCommandDelete = globalShortcut.register(format, () => {
          console.log(`${format} triggered!`);
          handleKeyPress('CommandOrControlDelete');
        });

        if (registeredCommandDelete) {
         // console.log(`Successfully registered ${format} for clearing input`);
          break;
        }
      }
    }
  }

  // If all standard formats failed, try an alternative key combination
  if (!registeredCommandDelete) {
    console.log('All Command+Delete formats failed, trying alternative: Command+Shift+K');

    registeredCommandDelete = globalShortcut.register('CommandOrControl+Shift+K', () => {
      console.log('Command+Shift+K triggered as alternative to Command+Delete!');
      handleKeyPress('CommandOrControlDelete');
    });

    if (registeredCommandDelete) {
      // console.log('Successfully registered Command+Shift+K as alternative for clearing input');
    } else {
      // //console.error('Failed to register any clear input shortcut');
    }
  }

  // Register Command+Escape as another alternative for clearing text
  // This is more likely to work on macOS
  const registeredCommandEscape = globalShortcut.register('CommandOrControl+Escape', () => {
    console.log('Command+Escape triggered for text clearing!');
    handleKeyPress('CommandOrControlDelete');
  });

  if (registeredCommandEscape) {
    // console.log('Successfully registered Command+Escape for clearing input');
    successCount++;
  } else {
    // //console.error('Failed to register Command+Escape shortcut');
  }

  // Try one more explicit registration for Command+Backspace on macOS
  // (This is often what macOS users think of as "Delete")
  if (process.platform === 'darwin') {
    const registeredCmdBackspace = globalShortcut.register('Command+Backspace', () => {
      console.log('Command+Backspace (macOS) triggered for text clearing!');
      handleKeyPress('CommandOrControlDelete');
    });

    if (registeredCmdBackspace) {
      // console.log('Successfully registered Command+Backspace for clearing input on macOS');
      successCount++;
    } else {
      // Try with lowercase 'cmd'
      const registeredCmdBackspaceLower = globalShortcut.register('cmd+backspace', () => {
        console.log('cmd+backspace (lowercase) triggered for text clearing!');
        handleKeyPress('CommandOrControlDelete');
      });

      if (registeredCmdBackspaceLower) {
       // console.log('Successfully registered cmd+backspace (lowercase) for clearing input');
        successCount++;
      } else {
        // //console.error('Failed to register Command+Backspace/cmd+backspace shortcut on macOS');
      }
    }
  }

  // Register a very simple fallback that's unlikely to conflict with system shortcuts
  const registeredCtrlSpace = globalShortcut.register('Control+Space', () => {
    console.log('Control+Space triggered as fallback for text clearing!');
    handleKeyPress('CommandOrControlDelete');
  });

  if (registeredCtrlSpace) {
    // console.log('Successfully registered Control+Space as fallback for clearing input');
    successCount++;
  } else {
    // //console.error('Failed to register Control+Space shortcut');
  }

  if (registeredCommandDelete) {
    successCount++;
  }

  // Register Command+S to take screenshot and drop into ChatGPT
  const registeredCommandS = globalShortcut.register('CommandOrControl+s',
    () => handleKeyPress('CommandOrControlS'));

  if (registeredCommandS) {
    successCount++;
    // console.log('Successfully registered Command+S shortcut for screenshot and drop');
  } else {
    // //console.error('Failed to register Command+S shortcut');
  }

  // Register Command+Up to scroll chat up
  const registeredCommandUp = globalShortcut.register('CommandOrControl+Up', () => {
    if (chatGPTView && isAppVisible) {
      chatGPTView.webContents.executeJavaScript(`
        (function() {
          const chatContainer = document.querySelector("#thread > div > div.flex.basis-auto.flex-col.-mb-\\\\(--composer-overlap-px\\\\).\\\\[--composer-overlap-px\\\\:24px\\\\].grow.overflow-hidden > div > div");
          if (chatContainer) {
            chatContainer.scrollBy({ top: -300, behavior: 'smooth' });
            return true;
          }
          return false;
        })()
      `).then(result => {
        console.log('Scroll up result:', result);
      }).catch(err => {
        console.error('Error scrolling up:', err);
      });
    }
  });

  // Register Command+Down to scroll chat down
  const registeredCommandDown = globalShortcut.register('CommandOrControl+Down', () => {
    if (chatGPTView && isAppVisible) {
      chatGPTView.webContents.executeJavaScript(`
        (function() {
          const chatContainer = document.querySelector("#thread > div > div.flex.basis-auto.flex-col.-mb-\\\\(--composer-overlap-px\\\\).\\\\[--composer-overlap-px\\\\:24px\\\\].grow.overflow-hidden > div > div");
          if (chatContainer) {
            chatContainer.scrollBy({ top: 300, behavior: 'smooth' });
            return true;
          }
          return false;
        })()
      `).then(result => {
        console.log('Scroll down result:', result);
      }).catch(err => {
        console.error('Error scrolling down:', err);
      });
    }
  });

  // Register Command+N to start a new chat
  const registeredCommandN = globalShortcut.register('CommandOrControl+n', () => {
    if (chatGPTView && isAppVisible) {
      console.log('Command+N pressed - Starting a new chat by navigating to ChatGPT home');
      chatGPTView.webContents.loadURL(CHATGPT_URL);
      return true;
    }
    return false;
  });

  if (registeredCommandN) {
    successCount++;
    // console.log('Successfully registered Command+N shortcut for starting a new chat');
  } else {
    //console.error('Failed to register Command+N shortcut for starting a new chat');
  }

  if (registeredCommandUp && registeredCommandDown) {
    successCount += 2;
    // console.log('Successfully registered Command+Up and Command+Down shortcuts for scrolling');
  } else {
    //console.error('Failed to register Command+Up/Down shortcuts for scrolling');
  }

    // Register Command+V to toggle layout
  const registeredCommandV = globalShortcut.register('CommandOrControl+v', () => {
    if (isAppVisible) {
      console.log('Command+V pressed - Toggling layout');
      return toggleLayout();
    }
    return false;
  });

  if (registeredCommandV) {
    successCount++;
    // console.log('Successfully registered Command+V shortcut for layout toggle');
  } else {
    //console.error('Failed to register Command+V shortcut');
  }

  // Register Command+M to switch ChatGPT models
  const registeredCommandM = globalShortcut.register('CommandOrControl+m', () => {
    if (isAppVisible) {
      console.log('Command+M pressed - Switching ChatGPT model');
      switchChatGPTModel();
      return true;
    }
    return false;
  });

  if (registeredCommandM) {
    successCount++;
    // console.log('Successfully registered Command+M shortcut for model switching');
  } else {
    //console.error('Failed to register Command+M shortcut');
  }

  // console.log(`Successfully registered ${successCount} out of ${allKeys.length + shiftSpecialKeys.length + 6 + alphaKeys.length + 2} key shortcuts`);
}

// Register global shortcuts with error handling
function registerGlobalShortcuts() {
  console.log('Registering global shortcuts...');

  // Unregister any existing shortcuts to avoid conflicts
  globalShortcut.unregisterAll();

  // Register transparency control shortcuts (Command+Plus/Minus)
  registerTransparencyShortcuts();

  // Register app quit shortcut (Command+Q)
  registerQuitShortcut();

  // Register window movement shortcuts (Option+Arrow keys)
  const moveStep = 20; // Pixels to move per keystroke

  // Option+Arrow Up: Move window up
  globalShortcut.register('Alt+Up', () => {
    if (mainWindow && isAppVisible) {
      const bounds = mainWindow.getBounds();
      mainWindow.setBounds({
        x: bounds.x,
        y: bounds.y - moveStep,
        width: bounds.width,
        height: bounds.height
      });
      console.log(`Window moved up to y=${bounds.y - moveStep}`);
      return true;
    }
    return false;
  });

  // Option+Arrow Down: Move window down
  globalShortcut.register('Alt+Down', () => {
    if (mainWindow && isAppVisible) {
      const bounds = mainWindow.getBounds();
      mainWindow.setBounds({
        x: bounds.x,
        y: bounds.y + moveStep,
        width: bounds.width,
        height: bounds.height
      });
      console.log(`Window moved down to y=${bounds.y + moveStep}`);
      return true;
    }
    return false;
  });

  // Option+Arrow Left: Move window left
  globalShortcut.register('Alt+Left', () => {
    if (mainWindow && isAppVisible) {
      const bounds = mainWindow.getBounds();
      mainWindow.setBounds({
        x: bounds.x - moveStep,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height
      });
      console.log(`Window moved left to x=${bounds.x - moveStep}`);
      return true;
    }
    return false;
  });

  // Option+Arrow Right: Move window right
  globalShortcut.register('Alt+Right', () => {
    if (mainWindow && isAppVisible) {
      const bounds = mainWindow.getBounds();
      mainWindow.setBounds({
        x: bounds.x + moveStep,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height
      });
      console.log(`Window moved right to x=${bounds.x + moveStep}`);
      return true;
    }
    return false;
  });

  // Option+R: Reset settings to defaults
  globalShortcut.register('Alt+R', () => {
    console.log('Reset settings shortcut triggered');
    // Reset settings even if overlay is not visible
    return resetToDefaultSettings();
  });

  // Register shortcut to show/hide the overlay
  const registeredShowHide = globalShortcut.register('CommandOrControl+B', async () => {
    // Normal overlay toggle behavior
    isAppVisible = !isAppVisible;
    isCapturingKeystrokes = isAppVisible;

    // Close settings window if it's open
    if (settingsWindow) {
      settingsWindow.close();
    }

    // Track overlay visibility state change
    console.log('Overlay toggled:', isAppVisible);

    if (isAppVisible) {
      // Ensure we're not focusable to prevent focus stealing
      if (mainWindow) {
        // Double check settings to make sure we don't steal focus
        mainWindow.setFocusable(false);
        mainWindow.setAlwaysOnTop(true, 'screen-saver');

        // Make sure we're passing mouse events through
        mainWindow.setIgnoreMouseEvents(true, { forward: true });

        // On macOS, make sure it's visible on fullscreen apps
        if (process.platform === 'darwin') {
          mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
        }
      }

      // Show the window without focusing it
      showWithoutFocus();

      // Re-register transparency and quit shortcuts
      registerTransparencyShortcuts();
      registerQuitShortcut();

      // If we have a ChatGPT view, make sure it's active and ready for input
      if (chatGPTView) {
        // Force focus on the ChatGPT input field
        chatGPTView.webContents.executeJavaScript(`
          (function() {
            // All of these logs will appear in the ChatGPT webview DevTools
            console.log('🔍 Activating ChatGPT input for key capture');

            // First ensure the ChatGPT UI is ready
            function activateInput() {
              const inputField = document.querySelector('textarea') ||
                                document.querySelector('[contenteditable="true"]') ||
                                document.querySelector('input[type="text"]');

              if (inputField) {
                console.log('🎯 Found input field, focusing it');

                // Create a function to focus with retry logic
                const focusWithRetry = () => {
                  try {
                    // For contenteditable elements, also set up the selection
                    if (inputField.isContentEditable) {
                      const selection = window.getSelection();
                      const range = document.createRange();

                      // Try to position the cursor at the end of the content
                      if (inputField.childNodes.length > 0) {
                        const lastNode = inputField.childNodes[inputField.childNodes.length - 1];
                        range.setStartAfter(lastNode);
                        range.setEndAfter(lastNode);
                      } else {
                        range.setStart(inputField, 0);
                        range.setEnd(inputField, 0);
                      }

                      selection.removeAllRanges();
                      selection.addRange(range);
                    }

                    // Focus the element
                    inputField.focus();

                    // Visual indicator that the input is ready
                    inputField.style.outline = '2px solid rgba(0, 255, 255, 0.5)';

                    return true;
                  } catch (e) {
                    console.error('Focus attempt failed:', e);
                    return false;
                  }
                };

                // Try focusing now
                if (!focusWithRetry()) {
                  // If immediate focus fails, retry after a short delay
                  setTimeout(focusWithRetry, 100);
                  // And another retry with longer delay as a fallback
                  setTimeout(focusWithRetry, 500);
                }

                return true;
              }

              console.warn('⚠️ No input field found');
              return false;
            }

            // Try activating now
            const result = activateInput();

            // If we didn't find an input field, retry after a short delay
            // (ChatGPT UI might still be loading or changing)
            if (!result) {
              console.log('Scheduling input activation retries...');
              setTimeout(activateInput, 500);
              setTimeout(activateInput, 1500);
              setTimeout(activateInput, 3000);
            }

            return result;
          })()
        `).then(result => {
          console.log('ChatGPT input activation result:', result);
        }).catch(err => {
          console.error('Error activating ChatGPT input:', err);
        });
      }

      // Enable input capture - will now set isCapturingKeystrokes as well
      toggleInputCapture(true);

      // Initialize the fake cursor in the ChatGPT view
      updateFakeCursor();

      // Register shortcuts for individual keys to capture keystrokes
      registerAllKeyShortcuts();
    } else {
      // Hide the window
      hideWindow();

      // Disable input capture
      toggleInputCapture(false);

      // Unregister individual key shortcuts when hiding
      unregisterAllKeyShortcuts();

      // Unregister transparency and quit shortcuts when overlay is hidden
      // This allows the underlying app to receive these shortcuts
      globalShortcut.unregister('CommandOrControl+=');
      globalShortcut.unregister('CommandOrControl+-');
      globalShortcut.unregister('CommandOrControl+Q');
    }
  });

  // Register shortcut to open settings (Command+Comma) - only when overlay is visible
  const registeredSettings = globalShortcut.register('CommandOrControl+,', () => {
    // Only process the shortcut when the overlay is visible
    if (isAppVisible) {
      // If settings window is already open, close it
      if (settingsWindow) {
        console.log('Settings shortcut pressed - closing settings window');
        settingsWindow.close();
        return true;
      } else {
        // Otherwise open a new settings window
        console.log('Settings shortcut pressed - opening settings window');
        createSettingsWindow();
        return true;
      }
    }
    // Return false to allow the underlying application to handle the shortcut
    return false;
  });

  if (!registeredShowHide) {
    //console.error('Failed to register CommandOrControl+B shortcut');
  }

  if (!registeredSettings) {
    //console.error('Failed to register CommandOrControl+, shortcut');
  }

  console.log('Global shortcuts registered successfully:',
    {
      'CommandOrControl+B': registeredShowHide,
      'CommandOrControl+,': registeredSettings
    }
  );
}

// Main app initialization function
app.whenReady().then(async () => {
  try {
    // Set up user agent before creating any windows
    setupUserAgent();

    // Generate a unique anonymous ID based on machine details
    const machineId = crypto
      .createHash('sha256')
      .update(os.hostname() + os.totalmem() + os.cpus()[0].model)
      .digest('hex')
      .substring(0, 16); // Use just the first 16 chars as ID

    // In Electron main process, we can't fully initialize Firebase Analytics
    // but we can prepare the event data for later tracking
    console.log('Preparing analytics in main process with ID:', machineId);

    // Save the machine ID to app storage for use in renderer process
    app.setAppUserModelId(machineId);

    // Log analytics events in main process (they'll be queued/logged but not sent)
    console.log('App initialized:', {
      app_version: app.getVersion(),
      platform: process.platform,
      os_version: os.release(),
      is_dev: app.isPackaged ? 'production' : 'development'
    });

    // Store the machine ID for later use in renderer
    // @ts-ignore - Ignore TypeScript error for global property
    global.analyticsUserId = machineId;



    // Initialize the app window and security features
    const settings = loadSettings();
    createWindow();

    if (!settings.isAuthenticated) {
      // User needs to authenticate, hide windows and disable keyboard capture
      ipcMain.emit('hide-for-auth', null, { disableKeyboard: true });
    }

    setupSecurityPolicies();
    registerGlobalShortcuts();


  } catch (error) {
    console.error('Error during app initialization:', error);
  }

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
      registerGlobalShortcuts();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  // Unregister all shortcuts
  globalShortcut.unregisterAll();

  // Make sure to restore cursor if app quits while visible
  if (isAppVisible) {
    cursors.restoreCursor();
  }
});

// IPC handlers
ipcMain.handle('toggle-view', (event, visible) => {
  // Only toggle view if we're not showing settings
  if (!mainWindow?.webContents.send('is-showing-settings')) {
    setViewVisibility(visible);
  }
  return isViewVisible;
});

ipcMain.handle('reload-chatgpt', () => {
  if (chatGPTView) {
    chatGPTView.webContents.reload();
    return true;
  }
  return false;
});

ipcMain.handle('move-fake-cursor', (event, { x, y }) => {
  if (isAppVisible && mainWindow) {
    fakeCursorPosition = { x, y };
    mainWindow.webContents.send('update-fake-cursor', fakeCursorPosition);
    return true;
  }
  return false;
});

ipcMain.handle('click-at-position', (event, { x, y, button = 'left' }) => {
  simulateClick(x, y, button);
  return true;
});

// Add new IPC handler for toggling settings
ipcMain.handle('toggle-settings', () => {
  // Check if settings window exists and is visible
  if (settingsWindow) {
    // Close the existing settings window
    settingsWindow.close();
    return false;
  } else {
    // Open a new settings window
    createSettingsWindow();
    return true;
  }
});

// Add handler for when settings are closed
ipcMain.handle('settings-closed', () => {
  if (mainWindow) {
    // Restore mouse event ignoring when settings are closed
    mainWindow.setIgnoreMouseEvents(true, { forward: true });

    // Restore the ChatGPT view when settings are closed (only if it should be visible)
    if (chatGPTView && isViewVisible) {
      mainWindow.addBrowserView(chatGPTView);
      const bounds = mainWindow.getBounds();
      chatGPTView.setBounds({
        x: 0,
        y: 0,
        width: bounds.width,
        height: bounds.height
      });
      console.log('ChatGPT view restored after settings closed');
    }
    return true;
  }
  return false;
});

// Get window opacity
ipcMain.handle('get-window-opacity', () => {
  if (mainWindow) {
    return mainWindow.getOpacity();
  }
  return 0.95; // Default opacity
});

// Set window opacity
ipcMain.handle('set-window-opacity', (_event, opacity: number) => {
  if (mainWindow) {
    // Make sure opacity is between 0.5 and 1
    const validOpacity = Math.max(0.5, Math.min(1, opacity));
    mainWindow.setOpacity(validOpacity);

    // Save the setting persistently
    saveSettings({ transparency: validOpacity });

    return true;
  }
  return false;
});

// Save settings
ipcMain.handle('save-settings', (_event, settings: Partial<AppSettings>) => {
  if (mainWindow && settings) {
    // Apply transparency setting if provided
    if (typeof settings.transparency === 'number') {
      const validOpacity = Math.max(0.5, Math.min(1, settings.transparency));
      mainWindow.setOpacity(validOpacity);
      settings.transparency = validOpacity;
    }

    // Apply stealth cursor setting if provided
    if (typeof settings.stealthCursorEnabled === 'boolean' &&
        settings.stealthCursorEnabled !== stealthCursorEnabled) {
      stealthCursorEnabled = settings.stealthCursorEnabled;

      // Apply cursor settings if the app is visible
      if (isAppVisible && chatGPTView) {
        applyCursorSettings();
      }
    }

    // Apply layout setting if provided
    if (typeof settings.layout === 'number' &&
        settings.layout !== currentLayout) {
      currentLayout = settings.layout;

      // Apply layout if app is visible
      if (isAppVisible && mainWindow) {
        toggleLayout(currentLayout);
      }
    }

    // Save settings to disk
    saveSettings(settings);

    return true;
  }
  return false;
});

// Get stealth cursor enabled state
ipcMain.handle('get-stealth-cursor-enabled', () => {
  return stealthCursorEnabled;
});

// Set stealth cursor enabled state
ipcMain.handle('set-stealth-cursor-enabled', (_event, enabled: boolean) => {
  console.log(`Setting stealth cursor enabled: ${enabled}`);
  stealthCursorEnabled = enabled;

  // Apply the setting immediately to both cursor style and window behavior
  if (chatGPTView && mainWindow) {
    // Apply cursor appearance changes
    applyCursorSettings();

    // Adjust window mouse event handling based on mode
    if (enabled) {
      // Stealth mode: pass-through mouse events to underlying app
      mainWindow.setIgnoreMouseEvents(true, { forward: true });
      console.log('Enabling mouse click pass-through for stealth mode');
    } else {
      // Normal mode: capture mouse events in our window
      mainWindow.setIgnoreMouseEvents(false);
      console.log('Disabling mouse click pass-through for normal cursor mode');
    }
  }

  // Save setting to disk
  saveSettings({ stealthCursorEnabled: enabled });

  return true;
});

// Reset settings to defaults
ipcMain.handle('reset-settings', () => {
  // Reset stealth cursor to default (enabled)
  stealthCursorEnabled = true;
  if (chatGPTView) {
    applyCursorSettings();
  }

  return resetToDefaultSettings();
});

// Define settings interface
interface AppSettings {
  transparency: number;
  position: {
    x: number | undefined;
    y: number | undefined;
  };
  stealthCursorEnabled: boolean;
  layout: number;
  isAuthenticated: boolean;
}

// Default settings values
const DEFAULT_SETTINGS: AppSettings = {
  transparency: 0.95,
  position: {
    x: undefined, // Will be set to center of screen when needed
    y: undefined  // Will be set to center of screen when needed
  },
  stealthCursorEnabled: true,
  layout: 0,
  isAuthenticated: false
};

// Get the app's user data directory for storing settings
const USER_DATA_PATH = app.getPath('userData');
const SETTINGS_FILE_PATH = path.join(USER_DATA_PATH, 'settings.json');

// Function to load settings from disk
function loadSettings(): AppSettings {
  console.log(`Loading settings from ${SETTINGS_FILE_PATH}`);

  try {
    // Check if settings file exists
    if (fs.existsSync(SETTINGS_FILE_PATH)) {
      // Read and parse the settings file
      const settingsData = fs.readFileSync(SETTINGS_FILE_PATH, 'utf8');
      const loadedSettings = JSON.parse(settingsData);

      // Merge with default settings to ensure all properties exist
      const mergedSettings = {
        ...DEFAULT_SETTINGS,
        ...loadedSettings
      };

      console.log('Settings loaded successfully', mergedSettings);
      return mergedSettings;
    } else {
      console.log('No settings file found, using defaults');
      return { ...DEFAULT_SETTINGS };
    }
  } catch (error) {
    console.error('Error loading settings:', error);
    return { ...DEFAULT_SETTINGS };
  }
}

// Function to save settings to disk
function saveSettings(settings: Partial<AppSettings>) {
  console.log('Saving settings:', settings);

  // Track settings changes
  if (settings.transparency) {
    console.log('Setting transparency:', settings.transparency);
  }
  if (settings.stealthCursorEnabled !== undefined) {
    console.log('Setting stealth cursor:', settings.stealthCursorEnabled);
  }
  if (settings.layout !== undefined) {
    console.log('Setting layout:', settings.layout);
  }

  try {
    // Make sure the directory exists
    if (!fs.existsSync(USER_DATA_PATH)) {
      fs.mkdirSync(USER_DATA_PATH, { recursive: true });
    }

    // Load current settings and merge with new values
    let currentSettings = { ...DEFAULT_SETTINGS };

    if (fs.existsSync(SETTINGS_FILE_PATH)) {
      try {
        const existingData = fs.readFileSync(SETTINGS_FILE_PATH, 'utf8');
        currentSettings = {
          ...currentSettings,
          ...JSON.parse(existingData)
        };
      } catch (e) {
        console.warn('Error reading existing settings, overwriting with new settings');
      }
    }

    // Merge with new settings
    const newSettings = {
      ...currentSettings,
      ...settings
    };

    // Write to file
    fs.writeFileSync(SETTINGS_FILE_PATH, JSON.stringify(newSettings, null, 2), 'utf8');
    console.log('Settings saved successfully');
    return true;
  } catch (error) {
    console.error('Error saving settings:', error);
    return false;
  }
}

// Load settings when module is imported
const loadedSettings = loadSettings();

// Initialize settings from loaded values
stealthCursorEnabled = loadedSettings.stealthCursorEnabled;
currentLayout = loadedSettings.layout;

// Function to reset app settings to default values
// Function to register transparency control shortcuts (Command+Plus/Minus)
function registerTransparencyShortcuts() {
  // Command+Plus: Increase transparency
  globalShortcut.register('CommandOrControl+=', () => {
    if (isAppVisible && mainWindow) {
      // Get current opacity
      const currentOpacity = mainWindow.getOpacity();
      // Increase by 0.05, max 1.0
      const newOpacity = Math.min(1.0, currentOpacity + 0.05);
      // Apply new opacity
      mainWindow.setOpacity(newOpacity);
      console.log(`Increased transparency to ${Math.round(newOpacity * 100)}%`);
      return true;
    }
    return false;
  });

  // Command+Minus: Decrease transparency
  globalShortcut.register('CommandOrControl+-', () => {
    if (isAppVisible && mainWindow) {
      // Get current opacity
      const currentOpacity = mainWindow.getOpacity();
      // Decrease by 0.05, min 0.5
      const newOpacity = Math.max(0.5, currentOpacity - 0.05);
      // Apply new opacity
      mainWindow.setOpacity(newOpacity);
      console.log(`Decreased transparency to ${Math.round(newOpacity * 100)}%`);
      return true;
    }
    return false;
  });
}

// Function to register quit shortcut (Command+Q)
function registerQuitShortcut() {
  globalShortcut.register('CommandOrControl+Q', () => {
    if (isAppVisible) {
      console.log('Command+Q pressed, quitting application');
      app.quit();
      return true;
    }
    return false;
  });
}

function resetToDefaultSettings() {
  if (mainWindow) {
    console.log('Resetting to default settings');

    // Reset transparency
    mainWindow.setOpacity(DEFAULT_SETTINGS.transparency);

    // Reset stealth cursor to default (enabled)
    stealthCursorEnabled = DEFAULT_SETTINGS.stealthCursorEnabled;
    console.log(`Reset stealth cursor to ${stealthCursorEnabled ? 'enabled' : 'disabled'}`);

    // Reset layout
    currentLayout = DEFAULT_SETTINGS.layout;

    // Apply cursor settings
    if (isAppVisible && chatGPTView) {
      applyCursorSettings();

      // Adjust mouse event handling for stealth mode
      if (stealthCursorEnabled) {
        mainWindow.setIgnoreMouseEvents(true, { forward: true });
      } else {
        mainWindow.setIgnoreMouseEvents(false);
      }

      // Apply layout
      toggleLayout(currentLayout);
    }

    // Save default settings to disk
    saveSettings(DEFAULT_SETTINGS);

    // Reset position to center of screen
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width, height } = primaryDisplay.workAreaSize;

    const windowSize = mainWindow.getSize();
    const newX = Math.floor((width - windowSize[0]) / 2);
    const newY = Math.floor((height - windowSize[1]) / 2);

    mainWindow.setPosition(newX, newY);

    // Notify the renderer about the reset
    mainWindow.webContents.executeJavaScript(`
      console.log('Resetting settings to defaults');

      // Update opacity slider if it exists
      const opacitySlider = document.getElementById('opacity-slider');
      const opacityValue = document.getElementById('opacity-value');

      if (opacitySlider && opacityValue) {
        opacitySlider.value = ${DEFAULT_SETTINGS.transparency};
        opacityValue.textContent = '${Math.round(DEFAULT_SETTINGS.transparency * 100)}%';
      }

      // Show feedback to the user
      const showDebugIndicator = window.showDebugIndicator || function(msg) {
        console.log(msg);
      };

      showDebugIndicator('Settings reset to defaults');
    `).catch(err => {
      console.error('Error resetting settings in renderer:', err);
    });

    return true;
  }
  return false;
}

// Function to create and show the settings window
function createSettingsWindow() {
  // Don't create multiple instances
  if (settingsWindow) {
    settingsWindow.focus();
    return;
  }

  console.log('Creating settings window');

  // Create the settings window
  settingsWindow = new BrowserWindow({
    width: 500,
    height: 700, // Increase height to accommodate the additional content
    title: 'Cloak GPT Settings',
    show: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    backgroundColor: '#232323',
    alwaysOnTop: true, // Always on top
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      devTools: !app.isPackaged // Only enable DevTools in development
    }
  });

  // Protect window content from screen capture
  settingsWindow.setContentProtection(true);

  // Set window to be always on top with the highest level
  // Use a higher level than the main window to ensure it appears on top
  settingsWindow.setAlwaysOnTop(true, 'screen-saver');

  // On macOS, make it visible on all workspaces including fullscreen apps
  if (process.platform === 'darwin') {
    settingsWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

    // Hide window from screen recording/capture
    const windowId = settingsWindow.getNativeWindowHandle().readInt32LE(0);
    cursors.setWindowHiddenFromCapture(windowId);
  } else if (process.platform === 'win32') {
    // On Windows, hide from screen capture
    const windowId = settingsWindow.getNativeWindowHandle().readInt32LE(0);
    cursors.setWindowHiddenFromCapture(windowId);
  }

  // Remove the menu bar
  settingsWindow.setMenu(null);

  // Load the settings HTML file
  const settingsPath = path.join(__dirname, 'renderer', 'settings.html');
  settingsWindow.loadFile(settingsPath);

  // Show window when ready and ensure it's on top of everything
  settingsWindow.once('ready-to-show', () => {
    if (settingsWindow) {
      // Make sure it's on top of everything, including the main window
      settingsWindow.moveTop();
      settingsWindow.setAlwaysOnTop(true, 'screen-saver');
      settingsWindow.show();
      settingsWindow.focus();

      // Center the window on the screen
      settingsWindow.center();
    }
  });

  // Clean up when window is closed
  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });

  // Add keyboard shortcut listener for Command+Comma to close the window
  settingsWindow.webContents.on('before-input-event', (event, input) => {
    // Check for Command+Comma (macOS) or Control+Comma (Windows/Linux)
    const isCommandOrControlComma =
      (process.platform === 'darwin' && input.meta && input.key === ',') ||
      (process.platform !== 'darwin' && input.control && input.key === ',');

    if (isCommandOrControlComma && input.type === 'keyDown') {
      console.log('Command+Comma pressed in settings window - closing');
      settingsWindow?.close();
      event.preventDefault();
    }
  });

  return settingsWindow;
}

// Function to open ChatGPT authentication window
function createAuthWindow() {
  // Check if an auth window already exists, if so, just focus it
  if (authWindow) {
    authWindow.focus();
    authWindow.moveTop();
    return authWindow;
  }

  console.log('Creating authentication window...');
  // Temporarily lower the z-order of existing windows
  if (settingsWindow) {
    console.log('Temporarily lowering settings window z-order');
    settingsWindow.setAlwaysOnTop(false);
  }
  if (mainWindow) {
    console.log('Temporarily lowering main window z-order');
    mainWindow.setAlwaysOnTop(false);
  }

  // Create an authentication window with a nice loading UI built-in
  authWindow = new BrowserWindow({
    width: 800,
    height: 600,
    title: 'Sign in to ChatGPT',
    show: false, // Don't show until we explicitly call show() with a delay
    backgroundColor: '#232323', // Dark background for the loading state
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  // Create a BrowserView to host ChatGPT login
  const authView = new BrowserView({
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false,
      allowRunningInsecureContent: true,
      sandbox: false,
      devTools: !app.isPackaged, // Only enable DevTools in development
      session: session.defaultSession // Explicitly use default session for auth sharing
    }
  });

  // Explicitly set the user agent and ensure it persists
  authView.webContents.setUserAgent(USER_AGENT);
  authView.webContents.session.setUserAgent(USER_AGENT);

  // Set up request interceptor to ensure user agent is maintained
  authView.webContents.session.webRequest.onBeforeSendHeaders((details, callback) => {
    details.requestHeaders['User-Agent'] = USER_AGENT;
    callback({ requestHeaders: details.requestHeaders });
  });

  console.log('Using modified user agent for auth view:', USER_AGENT);

  // Add the view to the window and set its bounds
  authWindow.addBrowserView(authView);
  const bounds = authWindow.getBounds();
  authView.setBounds({
    x: 0,
    y: 0,
    width: bounds.width,
    height: bounds.height
  });

  // Initially hide the BrowserView until we reach the login page
  authView.setBackgroundColor('#00000000');  // Transparent background
  authWindow.removeBrowserView(authView);

  // Set up loading spinner HTML - we'll display this in the main window
  const loadingHTML = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Loading ChatGPT</title>
      <style>
        body {
          margin: 0;
          padding: 0;
          display: flex;
          justify-content: center;
          align-items: center;
          height: 100vh;
          background-color: #232323;
          color: white;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
        }
        .loading-container {
          text-align: center;
        }
        .spinner {
          border: 5px solid rgba(255, 255, 255, 0.3);
          border-radius: 50%;
          border-top: 5px solid #10a37f;
          width: 50px;
          height: 50px;
          animation: spin 1s linear infinite;
          margin: 0 auto 20px;
        }
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        h2 {
          margin: 0;
          font-weight: 500;
        }
        p {
          margin-top: 10px;
          opacity: 0.8;
        }
        .info {
          margin-top: 30px;
          font-size: 14px;
          opacity: 0.6;
          max-width: 400px;
          text-align: center;
        }
      </style>
    </head>
    <body>
      <div class="loading-container">
        <div class="spinner"></div>
        <h2>Preparing ChatGPT Login</h2>
        <p>Connecting to ChatGPT, please wait...</p>
        <div class="info">
          The login page will appear automatically once it's ready.
          All keyboard input will be directed to the login form when it appears.
        </div>
      </div>
    </body>
    </html>
  `;

  // First show loading screen in the main window
  authWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(loadingHTML)}`);

  // Disable all keyboard capture mechanisms
  if (isCapturingInput || isCapturingKeystrokes) {
    console.log('Disabling input capture for login');
    toggleInputCapture(false);
  }

  // Unregister all individual key shortcuts
  console.log('Unregistering all keyboard shortcuts for login');
  unregisterAllKeyShortcuts();

  // Keep the Cloak GPT view visible during login
  const wasCloakGPTViewVisible = isViewVisible;

  // Store the state to restore later
  const wasAppVisible = isAppVisible;

  // Show the window with loading indicator
  setTimeout(() => {
    if (authWindow) {
      // Re-apply always on top with different modes to force proper z-ordering
      authWindow.setAlwaysOnTop(false);
      authWindow.setAlwaysOnTop(true, 'floating');

      // Show and focus the window with loading spinner
      authWindow.show();
      authWindow.focus();
      authWindow.moveTop();

      console.log('Auth window showing loading spinner');

      // Now load ChatGPT in the BrowserView
      authView.webContents.loadURL('https://chatgpt.com');
    }
  }, 100);

  // Monitor page load to click login button when the page is ready
  authView.webContents.on('did-finish-load', () => {
    if (!authWindow) return;

    const currentURL = authView.webContents.getURL();
    console.log('Auth view loaded:', currentURL);

    // Check if we're on chatgpt.com and need to click the login button
    if (currentURL.includes('chatgpt.com')) {
      console.log('On chatgpt.com, attempting to click login button');

      // Wait a moment for the page to fully render, then click the login button
      setTimeout(() => {
        if (!authWindow || !authView) return;

        // Find and click the login button
        authView.webContents.executeJavaScript(`
          (function() {
            try {
              console.log('Looking for login button...');
              const loginButton = document.querySelector('[data-testid="login-button"]');

              if (loginButton) {
                console.log('Login button found, clicking...');
                loginButton.click();
                return true;
              } else {
                console.log('Login button not found');
                return false;
              }
            } catch (error) {
              console.error('Error clicking login button:', error);
              return false;
            }
          })();
        `)
        .then(result => {
          console.log('Login button click result:', result);
        })
        .catch(err => {
          console.error('Error clicking login button:', err);
        });
      }, 1000);
    }

    // Show the BrowserView once we reach the auth.openai.com login page
    if (currentURL.includes('auth.openai.com')) {
      console.log('On login page, showing BrowserView and ensuring window is on top');
      if (authWindow && authView) {
                // Remove the loading HTML by loading a blank page first
        authWindow.loadURL('about:blank').then(() => {
          // Check if authWindow still exists before proceeding
          if (!authWindow) {
            console.log('Auth window was closed before finishing setup');
            return;
          }

          // Then show the BrowserView with the login page
          authWindow.addBrowserView(authView);

          // Make sure the BrowserView fills the entire window
          const bounds = authWindow.getBounds();
          authView.setBounds({
            x: 0,
            y: 0,
            width: bounds.width,
            height: bounds.height
          });

          // Set the view to auto-resize with the window
          authView.setAutoResize({
            width: true,
            height: true
          });

          // Inject CSS to prevent cursor changes
          authView.webContents.insertCSS(`
            /* Prevent any element from changing the system cursor */
            *, *::before, *::after {
              cursor: default !important;
            }

            /* Target specific cursor types that might appear */
            [style*="cursor"], [style*="cursor:pointer"], a, button, input, textarea, select, [role="button"],
            [role="link"], [role="textbox"], [contenteditable="true"] {
              cursor: default !important;
            }
          `).catch(err => {
            console.error('Error injecting CSS for auth view:', err);
          });

          // Make sure the window and view are properly focused
          if (authWindow) {
            authWindow.setAlwaysOnTop(false);
            authWindow.setAlwaysOnTop(true, 'floating');
            authWindow.focus();
            authWindow.moveTop();
            authView.webContents.focus();
          }
        }).catch(err => {
          console.error('Error loading blank page:', err);
        });
      }
    }
  });

  // Monitor navigation events
  authView.webContents.on('did-navigate', (event, url) => {
    console.log('Auth view navigated to:', url);

    // If we detect navigation to chat.openai.com or chatgpt.com (after auth), the user has logged in
    if (url.includes('chat.openai.com') ||
        (url.includes('chatgpt.com') && !url.includes('auth.openai.com'))) {
      console.log('Login successful, closing auth window and settings window');

      // Close the settings window if it exists
      if (settingsWindow) {
        console.log('Closing settings window after successful login');
        settingsWindow.close();
      }

      // Close the auth window since login is complete
      if (authWindow) {
        authWindow.close();
      }
    }
  });

  // Also monitor navigation to chatgpt.com specifically for redirect after auth
  authView.webContents.on('did-finish-load', () => {
    if (!authWindow) return;

    const currentURL = authView.webContents.getURL();
    console.log('Auth view finished loading:', currentURL);

    // Check if we've been redirected back to chatgpt.com after auth
    if (currentURL.includes('chatgpt.com') &&
        !currentURL.includes('auth.openai.com') &&
        !currentURL.includes('login')) {
      console.log('Detected redirect back to chatgpt.com after auth, closing auth window');

      // Give a brief moment to ensure everything is loaded properly
      setTimeout(() => {
        // Close the settings window if it exists
        if (settingsWindow) {
          console.log('Closing settings window after successful login');
          settingsWindow.close();
        }

        // Close the auth window since login is complete
        if (authWindow) {
          authWindow.close();
        }
      }, 1000);
    }
  });

  // Update BrowserView when window is resized
  authWindow.on('resize', () => {
    if (authWindow && authView) {
      const bounds = authWindow.getBounds();
      authView.setBounds({
        x: 0,
        y: 0,
        width: bounds.width,
        height: bounds.height
      });
    }
  });

  // Clean up when window is closed
  authWindow.on('closed', () => {
    console.log('Auth window closed, restoring other windows');

    // Restore z-order of other windows
    if (settingsWindow) {
      settingsWindow.setAlwaysOnTop(true, 'screen-saver');
    }

    if (mainWindow) {
      mainWindow.setAlwaysOnTop(true, 'screen-saver');
    }

    if (process.platform === 'darwin') {
      // If we're on macOS, hide the dock icon again
      app.dock?.hide();
    }

    // Keep the view state as is

    // If we have a Cloak GPT view, reload it to reflect new login state
    if (chatGPTView) {
      chatGPTView.webContents.reload();
    }

    // Re-enable input capture if the overlay was visible
    if (wasAppVisible && !isCapturingInput && !isCapturingKeystrokes) {
      console.log('Re-enabling input capture after login window closed');
      toggleInputCapture(true);
      registerAllKeyShortcuts();
    }

    // Notify listeners that the auth window has closed
    // This helps settings window update login status
    if (typeof authWindowClosedCallback === 'function') {
      console.log('Triggering auth window closed callback');
      try {
        authWindowClosedCallback();
      } catch (error) {
        console.error('Error in auth window closed callback:', error);
      }
    }

    // Clear the reference
    authWindow = null;
  });

  return authWindow;
}

// Add handler for opening auth window
ipcMain.handle('open-auth-window', () => {
  createAuthWindow();
  return true;
});

// Add handler for checking login status
ipcMain.handle('check-login-status', async () => {
  const result = await isLoggedIntoChatGPT();
  return result;
});

// Create a custom event to notify renderer when auth window is closed
let authWindowClosedCallback: () => void;
ipcMain.handle('register-auth-window-closed-listener', (event) => {
  // Store the webContents to send event to
  const webContents = event.sender;

  // Save the callback function to call when auth window closes
  authWindowClosedCallback = () => {
    if (!webContents.isDestroyed()) {
      webContents.send('auth-window-closed');
    }
  };

  return true;
});

// Add handler for logging out
ipcMain.handle('logout-from-chatgpt', async () => {
  return await logoutFromChatGPT();
});



// Function to check if user is logged into ChatGPT and get user info
async function isLoggedIntoChatGPT(): Promise<{ isLoggedIn: boolean, email?: string, userId?: string, isPro?: boolean }> {
  if (!chatGPTView) return { isLoggedIn: false };

  try {
    // Check if login button exists - if not, user is likely logged in
    const loginButtonExists = await chatGPTView.webContents.executeJavaScript(`
      !!document.querySelector('[data-testid="login-button"]')
    `);

    console.log('Login button exists:', loginButtonExists);
    const isLoggedIn = !loginButtonExists;

    // If user is logged in, try to extract user info
    if (isLoggedIn) {
      try {
        const userInfo = await chatGPTView.webContents.executeJavaScript(`
          (function() {
            try {
              // Find the boot script with the user data
              const script = Array.from(document.querySelectorAll('script[nonce]'))
                .find(s => s.textContent && s.textContent.includes('window.__reactRouterContext.streamController.enqueue'));

              if (!script) {
                console.log('Boot script not found');
                return { found: false };
              }

              // Extract the JSON-ish payload
              const raw = script.textContent;
              if (!raw.includes('window.__reactRouterContext.streamController.enqueue("')) {
                console.log('Expected script content not found');
                return { found: false };
              }

              let bootData;
              try {
                bootData = raw
                  .split('window.__reactRouterContext.streamController.enqueue("')[1]
                  .split('")')[0];
              } catch (err) {
                console.log('Failed to extract boot data:', err);
                return { found: false };
              }

              // Extract user ID and email
              let userId, email;
              try {
                if (bootData.includes('"id\\\\",\\\\"')) {
                  userId = bootData.split('"id\\\\",\\\\"')[1].split('\\\\",')[0];
                } else if (bootData.includes('"id\\",\\"')) {
                  userId = bootData.split('"id\\",\\"')[1].split('\\",')[0];
                }

                if (bootData.includes('"email\\\\",\\\\"')) {
                  email = bootData.split('"email\\\\",\\\\"')[1].split('\\\\"')[0];
                } else if (bootData.includes('"email\\",\\"')) {
                  email = bootData.split('"email\\",\\"')[1].split('\\"')[0];
                }
              } catch (err) {
                console.log('Failed to parse user data:', err);
                return { found: false };
              }

              if (!userId || !email) {
                console.log('Could not extract user info, trying alternative method');

                // Try looking for user menu items that might contain the email
                const userMenu = document.querySelector('[data-testid="user-menu"]');
                if (userMenu) {
                  userMenu.click();

                  // Wait a moment for menu to open
                  setTimeout(() => {
                    const userMenuItem = Array.from(document.querySelectorAll('.menu-item'))
                      .find(item => {
                        const text = item.textContent || '';
                        return text.includes('@') && text.includes('.');
                      });

                    if (userMenuItem) {
                      email = userMenuItem.textContent.trim();
                    }

                    // Close the menu
                    document.body.click();
                  }, 300);
                }
              }

              return {
                found: true,
                userId: userId || 'unknown',
                email: email || 'unknown@email.com'
              };
            } catch (err) {
              console.error('Error in user info extraction:', err);
              return { found: false };
            }
          })()
        `);

        console.log('User info extraction result:', userInfo);

        if (userInfo && userInfo.found) {
                    // Get the user info and check for pro status
          const result: {
            isLoggedIn: boolean;
            userId: string;
            email: string;
            isPro?: boolean;
          } = {
            isLoggedIn: true,
            userId: userInfo.userId,
            email: userInfo.email
          };



          return result;
        }
      } catch (error) {
        console.error('Error extracting user info:', error);
      }

      // Still return logged in status even if we couldn't get the user info
      return { isLoggedIn: true };
    }

    return { isLoggedIn: false };
  } catch (error) {
    console.error('Error checking login status:', error);
    return { isLoggedIn: false };
  }
}

// Function to logout from ChatGPT
async function logoutFromChatGPT(): Promise<boolean> {
  try {
    console.log('Logging out from Cloak GPT...');

    // First execute JavaScript in Cloak GPT view to clear local/session storage and perform client-side logout
    if (chatGPTView) {
      // Execute JavaScript to clear client-side storage and log out
      await chatGPTView.webContents.executeJavaScript(`
        // Clear all client-side storage
        localStorage.clear();

        // Try to find and click any logout button that might exist
        try {
          const logoutButton = document.querySelector('[aria-label="Log out"]') ||
                             document.querySelector('[data-testid="logout-button"]') ||
                             Array.from(document.querySelectorAll('button')).find(btn =>
                               btn.textContent?.toLowerCase().includes('log out') ||
                               btn.textContent?.toLowerCase().includes('logout')
                             );

          if (logoutButton) {
            console.log('Found logout button, clicking it');
            logoutButton.click();
          }
        } catch(e) {
          console.error('Error finding logout button:', e);
        }

        // Try to remove any OAuth tokens from document.cookie
        document.cookie.split(';').forEach(cookie => {
          const [name] = cookie.trim().split('=');
          document.cookie = name + '=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
        });

        console.log('Cleared client-side storage');
        true;
      `).catch(err => {
        console.error('Error executing client-side logout script:', err);
      });
    }

    // Clear all cookies from the session
    console.log('Clearing all cookies from session...');
    await session.defaultSession.clearStorageData({
      storages: ['cookies', 'localstorage', 'cachestorage', 'indexdb', 'shadercache', 'websql', 'serviceworkers']
    });

    // Also specifically clear cookies for Cloak GPT domains for completeness
    const cookieDomainsToDelete = [
      'cloakgpt.com',
      '.cloakgpt.com',
      'auth.openai.com',
      '.auth.openai.com',
      'api.openai.com',
      '.api.openai.com',
      'openai.com',
      '.openai.com',
      'chat.openai.com',
      '.chat.openai.com',
      'platform.openai.com',
      '.platform.openai.com',
      'oaistatic.com',
      '.oaistatic.com',
      'oaiusercontent.com',
      '.oaiusercontent.com'
    ];

    for (const domain of cookieDomainsToDelete) {
      const cookies = await session.defaultSession.cookies.get({ domain });
      console.log(`Found ${cookies.length} cookies for domain ${domain}`);

      for (const cookie of cookies) {
        if (cookie.domain && cookie.name) {
          try {
            // Remove cookie for all url paths
            await session.defaultSession.cookies.remove(
              cookie.domain,
              cookie.name
            );
            console.log(`Deleted cookie: ${cookie.name} from ${cookie.domain}`);
          } catch (err) {
            console.error(`Failed to delete cookie ${cookie.name}:`, err);
          }
        }
      }
    }

    // Perform a hard reload with cache clearing
    if (chatGPTView) {
      console.log('Performing hard reload of Cloak GPT view...');

      // First clear cache
      await chatGPTView.webContents.session.clearCache();

      // Reload with cache bypassing
      chatGPTView.webContents.reloadIgnoringCache();

      // Using a single loadURL with cache clearing for better performance
      setTimeout(async () => {
        if (chatGPTView && chatGPTView.webContents) {
          // Clear session data before reloading to ensure clean state
          await chatGPTView.webContents.session.clearCache();
          await chatGPTView.webContents.session.clearStorageData({
            storages: ['cookies', 'localstorage', 'indexdb']
          });

          // Load ChatGPT directly without the about:blank intermediary
          chatGPTView.webContents.loadURL(CHATGPT_URL);
        }
      }, 500);
    }

    console.log('Logout completed successfully');
    return true;
  } catch (error) {
    console.error('Error logging out:', error);
    return false;
  }
}

// Function to apply cursor settings based on stealthCursorEnabled preference
function applyCursorSettings() {
  if (!chatGPTView) return;

  console.log(`Applying cursor settings - stealth cursor ${stealthCursorEnabled ? 'enabled' : 'disabled'}`);

  // Ensure keyboard events work correctly in both modes
  if (isAppVisible && isCapturingKeystrokes) {
    // Re-register keyboard shortcuts to ensure they're properly set up
    registerAllKeyShortcuts();

    // Make sure Cloak GPT view can receive input
    if (chatGPTView.webContents) {
      chatGPTView.webContents.focus();
    }
  }

  // Apply CSS to show/hide the system cursor and fake cursor
  chatGPTView.webContents.executeJavaScript(`
    (function() {
      // Remove any existing cursor style
      const existingCursorStyle = document.getElementById('cursor-style');
      if (existingCursorStyle) {
        existingCursorStyle.remove();
      }

      // Create new style element
      const style = document.createElement('style');
      style.id = 'cursor-style';

      if (${stealthCursorEnabled}) {
        // Stealth mode - hide system cursor, show fake cursor
        style.textContent = \`
          body {
            cursor: none !important;
          }

          /* Prevent any element from changing the system cursor */
          *, *::before, *::after {
            cursor: none !important;
          }

          /* Target specific cursor types that might appear */
          [style*="cursor"], [style*="cursor:pointer"], a, button, input, textarea, select, [role="button"],
          [role="link"], [role="textbox"], [contenteditable="true"] {
            cursor: none !important;
          }

          /* Make sure fake cursor is visible */
          #fake-cursor {
            display: block !important;
            visibility: visible !important;
            opacity: 1 !important;
          }
        \`

        // Make sure fake cursor exists and is shown
        if (!document.getElementById('fake-cursor')) {
          const fakeCursor = document.createElement('div');
          fakeCursor.id = 'fake-cursor';
          fakeCursor.style.position = 'fixed';
          fakeCursor.style.width = '20px';
          fakeCursor.style.height = '20px';
          fakeCursor.style.backgroundImage = 'url(\\'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20"><polygon points="0,0 16,10 0,20 5,10" fill="%23ffffff" stroke="%23000000" stroke-width="1"/></svg>\\')';
          fakeCursor.style.backgroundRepeat = 'no-repeat';
          fakeCursor.style.backgroundSize = 'contain';
          fakeCursor.style.pointerEvents = 'none';
          fakeCursor.style.zIndex = '9999';
          fakeCursor.style.left = '50%';
          fakeCursor.style.top = '50%';
          fakeCursor.style.visibility = 'visible';
          fakeCursor.style.opacity = '1';

          document.body.appendChild(fakeCursor);
        }

        // Clear any existing cursor check interval
        if (window.cursorCheckInterval) {
          clearInterval(window.cursorCheckInterval);
        }

        // Set up an interval to ensure the cursor is always visible
        window.cursorCheckInterval = setInterval(() => {
          const cursor = document.getElementById('fake-cursor');
          if (!cursor) {
            console.log('Fake cursor was removed, recreating it');
            const newCursor = document.createElement('div');
            newCursor.id = 'fake-cursor';
            newCursor.style.position = 'fixed';
            newCursor.style.width = '20px';
            newCursor.style.height = '20px';
            newCursor.style.backgroundImage = 'url(\\'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20"><polygon points="0,0 16,10 0,20 5,10" fill="%23ffffff" stroke="%23000000" stroke-width="1"/></svg>\\')';
            newCursor.style.backgroundRepeat = 'no-repeat';
            newCursor.style.backgroundSize = 'contain';
            newCursor.style.pointerEvents = 'none';
            newCursor.style.zIndex = '9999';
            newCursor.style.left = '50%';
            newCursor.style.top = '50%';
            newCursor.style.visibility = 'visible';
            newCursor.style.opacity = '1';
            document.body.appendChild(newCursor);
          } else if (cursor.style.display === 'none' || cursor.style.visibility === 'hidden' || cursor.style.opacity === '0') {
            console.log('Fake cursor is hidden, making it visible again');
            cursor.style.display = 'block';
            cursor.style.visibility = 'visible';
            cursor.style.opacity = '1';
            // Ensure it's at the top of the z-index stack
            cursor.style.zIndex = '9999';
          }
        }, 500);

        // Initialize moveFakeCursor function if not already defined
        if (typeof window.moveFakeCursor !== 'function') {
          window.moveFakeCursor = function(x, y) {
            const cursor = document.getElementById('fake-cursor');
            if (cursor) {
              cursor.style.left = x + 'px';
              cursor.style.top = y + 'px';
              // Ensure cursor is visible when moved
              cursor.style.display = 'block';
              cursor.style.visibility = 'visible';
              cursor.style.opacity = '1';
            }
          };
        }

        // Initialize fakeCursorClick function if not already defined
        if (typeof window.fakeCursorClick !== 'function') {
          window.fakeCursorClick = function() {
            const cursor = document.getElementById('fake-cursor');
            if (!cursor) return false;

            const x = parseInt(cursor.style.left);
            const y = parseInt(cursor.style.top);

            // Find element at position and click it
            const element = document.elementFromPoint(x, y);
            if (element) {
              element.click();

              // Visual feedback for click
              const clickEffect = document.createElement('div');
              clickEffect.style.position = 'fixed';
              clickEffect.style.left = (x - 5) + 'px';
              clickEffect.style.top = (y - 5) + 'px';
              clickEffect.style.width = '10px';
              clickEffect.style.height = '10px';
              clickEffect.style.borderRadius = '50%';
              clickEffect.style.backgroundColor = 'rgba(255,255,255,0.7)';
              clickEffect.style.pointerEvents = 'none';
              clickEffect.style.zIndex = '10000';
              clickEffect.style.transition = 'all 0.2s ease-out';

              document.body.appendChild(clickEffect);

              setTimeout(() => {
                clickEffect.style.transform = 'scale(2)';
                clickEffect.style.opacity = '0';
              }, 10);

              setTimeout(() => {
                document.body.removeChild(clickEffect);
              }, 200);

              return true;
            }

            return false;
          };
        }
      } else {
        // Normal mode - show system cursor, hide fake cursor
        style.textContent = \`
          body {
            cursor: default !important;
          }

          /* Allow elements to set their own cursors */
          a, button, [role="button"] {
            cursor: pointer !important;
          }

          input, textarea, [contenteditable="true"], [role="textbox"] {
            cursor: text !important;
          }

          /* Hide fake cursor */
          #fake-cursor {
            display: none !important;
          }
        \`;

        // Clear any existing cursor check interval
        if (window.cursorCheckInterval) {
          clearInterval(window.cursorCheckInterval);
          window.cursorCheckInterval = null;
        }

        // Disable fake cursor functionality
        window.moveFakeCursor = function() { /* Do nothing */ };
        window.fakeCursorClick = function() { /* Do nothing */ };
      }

      // Add the style to the document
      document.head.appendChild(style);

      return true;
    })()
  `).catch(err => {
    console.error('Error applying cursor settings:', err);
  });
}

// Analytics initialization and tracking will be done using the imported modules

// Other existing imports and code...

// Around line 4765, after all the existing IPC handlers
// Add Firebase analytics IPC handlers
ipcMain.handle('initialize-analytics', async () => {
  try {
    // Generate a unique anonymous ID based on machine details
    // This avoids collecting any personally identifiable information
    const machineId = crypto
      .createHash('sha256')
      .update(os.hostname() + os.totalmem() + os.cpus()[0].model)
      .digest('hex')
      .substring(0, 16); // Use just the first 16 chars as ID

    // Initialize analytics
    const result = analytics.initAnalytics();

    console.log('Analytics initialized');

    return true;
  } catch (error) {
    console.error('Error initializing analytics:', error);
    return false;
  }
});

// Track custom events
ipcMain.handle('track-event', async (_event, { eventName, params }) => {
  try {
    console.log(`Event tracked: ${eventName}`, params);
    return true;
  } catch (error) {
    console.error(`Error tracking event ${eventName}:`, error);
    return false;
  }
});

// Set user properties
ipcMain.handle('set-user-property', async (_event, { propertyName, value }) => {
  try {
    console.log(`User property set: ${propertyName} = ${value}`);
    return true;
  } catch (error) {
    console.error(`Error setting user property ${propertyName}:`, error);
    return false;
  }
});

// Set user ID
ipcMain.handle('set-analytics-user-id', async (_event, userId) => {
  try {
    console.log(`Analytics user ID set: ${userId}`);
    return true;
  } catch (error) {
    console.error('Error setting analytics user ID:', error);
    return false;
  }
});

// Note: Main app initialization is handled in the primary app.whenReady() handler above
// This is now just an IPC handler for analytics

// Listen for auth-related window management
ipcMain.on('hide-for-auth', (_event, options = { disableKeyboard: true }) => {
  // Hide windows
  if (mainWindow) {
    mainWindow.hide();
  }
  if (settingsWindow) {
    settingsWindow.hide();
  }

  // Disable keyboard capture if requested
  if (options.disableKeyboard) {
    // Unregister all keyboard shortcuts
    unregisterAllKeyShortcuts();
  }
});

ipcMain.on('show-after-auth', (_event, options = { enableKeyboard: true }) => {
  // Show windows
  if (mainWindow) {
    mainWindow.show();
  }
  if (settingsWindow) {
    settingsWindow.show();
  }

  // Re-enable keyboard capture if requested
  if (options.enableKeyboard) {
    // Register all keyboard shortcuts
    registerAllKeyShortcuts();
  }
});

// Add IPC handlers for auth-related window management
ipcMain.handle('hide-for-auth', () => {
  // Hide windows
  if (mainWindow) {
    mainWindow.hide();
  }
  if (settingsWindow) {
    settingsWindow.hide();
  }

  // Disable keyboard capture
  if (isCapturingInput || isCapturingKeystrokes) {
    console.log('Disabling input capture for auth');
    toggleInputCapture(false);
  }

  // Unregister all keyboard shortcuts
  console.log('Unregistering all keyboard shortcuts for auth');
  unregisterAllKeyShortcuts();

  return true;
});

ipcMain.handle('show-after-auth', () => {
  // Show windows
  if (mainWindow) {
    mainWindow.show();
  }
  if (settingsWindow) {
    settingsWindow.show();
  }

  // Re-enable keyboard capture
  if (!isCapturingInput && !isCapturingKeystrokes) {
    console.log('Re-enabling input capture after auth');
    toggleInputCapture(true);
  }

  // Register all keyboard shortcuts
  console.log('Registering all keyboard shortcuts after auth');
  registerAllKeyShortcuts();

  return true;
});

// Handle opening external links
ipcMain.handle('open-external', async (_event, url: string) => {
  try {
    await shell.openExternal(url);
    return true;
  } catch (error) {
    console.error('Error opening external link:', error);
    return false;
  }
});

