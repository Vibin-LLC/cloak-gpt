import { initializeApp } from 'firebase/app';
import { getAnalytics, logEvent as firebaseLogEvent, setUserId as firebaseSetUserId, setUserProperties as firebaseSetUserProperties } from 'firebase/analytics';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from 'firebase/auth';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { shell } from 'electron';
import 'dotenv/config';

// Your web app's Firebase configuration
// Replace with your actual Firebase config values
// IMPORTANT: You'll need to sign up for Firebase and create a project to get these values
const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY as string,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN as string,
  projectId: process.env.FIREBASE_PROJECT_ID as string,
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET as string,
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID as string,
  appId: process.env.FIREBASE_APP_ID as string,
  measurementId: process.env.FIREBASE_MEASUREMENT_ID as string
};

// Initialize Firebase app
const app = initializeApp(firebaseConfig);

// Initialize Firebase functions with the correct region
const functions = getFunctions(app, 'us-central1');

// Flag to track if we're in the renderer process
const isRenderer = (process && process.type === 'renderer') ||
                  (typeof window !== 'undefined' && typeof window.process === 'undefined');

// Analytics instance - will only be initialized in renderer process
let analytics: any = null;

// Function to initialize analytics (only works in renderer process)
export const initAnalytics = () => {
  // Only initialize in renderer process
  if (isRenderer) {
    try {
      analytics = getAnalytics(app);
      console.log('Firebase Analytics initialized in renderer process');
      return analytics;
    } catch (error) {
      console.error('Failed to initialize Firebase Analytics:', error);
    }
  } else {
    console.log('Analytics can only be fully initialized in renderer process');
  }
  return null;
};

// Track app startup
export const trackAppStarted = () => {
  if (analytics) {
    firebaseLogEvent(analytics, 'app_started');
    return true;
  }
  return false;
};

// Track when the overlay is shown/hidden
export const trackOverlayToggle = (visible: boolean) => {
  if (analytics) {
    firebaseLogEvent(analytics, visible ? 'overlay_shown' : 'overlay_hidden');
    return true;
  }
  return false;
};

// Track when user changes settings
export const trackSettingsChanged = (settingName: string, value: any) => {
  if (analytics) {
    firebaseLogEvent(analytics, 'setting_changed', {
      setting_name: settingName,
      setting_value: value.toString()
    });
    return true;
  }
  return false;
};

// Track feature usage
export const trackFeatureUsed = (featureName: string) => {
  if (analytics) {
    firebaseLogEvent(analytics, 'feature_used', {
      feature_name: featureName
    });
    return true;
  }
  return false;
};

// Set anonymous user ID (can be the machine ID or another unique identifier)
export const setAnonymousUserId = (userId: string) => {
  if (analytics) {
    firebaseSetUserId(analytics, userId);
    return true;
  }
  return false;
};

// General function to log any event
export const logAnalyticsEvent = (eventName: string, params?: Record<string, any>) => {
  if (analytics) {
    firebaseLogEvent(analytics, eventName, params);
    return true;
  }

  // In main process, store events for later
  if (!isRenderer) {
    console.log(`Analytics event queued in main process: ${eventName}`, params);
  }

  return false;
};

// Dummy non-functional versions of the analytics functions for the main process
// These prevent errors when the functions are called from the main process
export const logEvent = (eventName: string, params?: any) => {
  if (isRenderer && analytics) {
    // In renderer process, log the event
    firebaseLogEvent(analytics, eventName, params);
  } else {
    // In main process, store events for later
    console.log(`Analytics event queued in main process: ${eventName}`, params);
  }
};

export const setUserId = (userId: string) => {
  if (isRenderer && analytics) {
    firebaseSetUserId(analytics, userId);
  }
};

export const setUserProperties = (properties: Record<string, any>) => {
  if (isRenderer && analytics) {
    firebaseSetUserProperties(analytics, properties);
  }
};

export default {
  initAnalytics,
  logEvent,
  setUserId,
  setUserProperties
};