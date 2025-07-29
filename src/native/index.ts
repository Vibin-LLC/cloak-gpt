import * as path from 'path';
import * as fs from 'fs';

// Fallback implementation that logs instead of performing actions
const fallbackModule = {
  setWindowHiddenFromCapture: (windowId: number) => {
    console.log('Fallback: setWindowHiddenFromCapture', windowId);
  },
  hideAndLockCursor: (x: number, y: number) => {
    console.log('Fallback: hideAndLockCursor', x, y);
  },
  restoreCursor: () => {
    console.log('Fallback: restoreCursor');
  }
};

// Try to load the native module, but provide fallbacks if it fails
let cursorModule: any = fallbackModule;

// Only try to load the native module if we're not in a test environment
if (process.env.NODE_ENV !== 'test') {
  // Try different possible paths for the native module
  const possiblePaths = [
    path.join(__dirname, '../../build/Release/cursor.node'),
    path.join(__dirname, '../build/Release/cursor.node'),
    path.join(__dirname, './build/Release/cursor.node'),
    path.resolve(process.cwd(), 'build/Release/cursor.node'),
    path.resolve(process.cwd(), './build/Release/cursor.node')
  ];

  for (const modulePath of possiblePaths) {
    try {
      if (fs.existsSync(modulePath)) {
        cursorModule = require(modulePath);
        console.log(`Successfully loaded native module from: ${modulePath}`);
        break;
      }
    } catch (err) {
      // Continue trying other paths
      console.log(`Failed to load from ${modulePath}:`, err);
    }
  }

  if (cursorModule === fallbackModule) {
    console.warn('Native cursor module could not be loaded. Using fallback implementation.');
    console.warn('The app will work, but cursor hiding and screen capture protection features will be limited.');
    console.warn('Available paths checked:', possiblePaths);
  }
}

// Export a cleaned-up interface to the native functionality
export const cursors = {
  /**
   * Set a window to be hidden from screen capture
   * @param windowId The native window ID/handle
   */
  setWindowHiddenFromCapture: (windowId: number): void => {
    cursorModule.setWindowHiddenFromCapture(windowId);
  },

  /**
   * Hide the system cursor and lock it to a specific position
   * @param x The X coordinate to lock the cursor to
   * @param y The Y coordinate to lock the cursor to
   */
  hideAndLockCursor: (x: number, y: number): void => {
    cursorModule.hideAndLockCursor(x, y);
  },

  /**
   * Restore the system cursor and unlock it
   */
  restoreCursor: (): void => {
    cursorModule.restoreCursor();
  }
};