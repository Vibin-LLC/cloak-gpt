// This file initializes Firebase Analytics in the renderer process
// It should be imported in your renderer entry point

// Wait for DOM to be ready
document.addEventListener('DOMContentLoaded', async () => {
  try {
    // Initialize analytics in the renderer process
    const analyticsInitialized = await window.electronAPI.initializeAnalytics();
    console.log('Analytics initialization result:', analyticsInitialized);

    // Track page view
    await window.electronAPI.trackEvent('page_view', {
      page_title: document.title,
      page_location: window.location.href
    });

    // Setup listeners for app visibility
    document.addEventListener('visibilitychange', async () => {
      if (document.visibilityState === 'visible') {
        await window.electronAPI.trackEvent('app_focus');
      } else {
        await window.electronAPI.trackEvent('app_blur');
      }
    });

    console.log('Firebase Analytics initialized in renderer process');
  } catch (error) {
    console.error('Error initializing analytics in renderer:', error);
  }
});

// Export an empty object to make this a module
export default {};