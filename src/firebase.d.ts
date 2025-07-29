declare module 'firebase/app' {
  export function initializeApp(config: any): any;
  export function getApp(): any;
}

declare module 'firebase/analytics' {
  export function getAnalytics(app?: any): any;
  export function logEvent(analyticsInstance: any, eventName: string, eventParams?: Record<string, any>): void;
  export function setUserId(analyticsInstance: any, userId: string): void;
  export function setUserProperties(analyticsInstance: any, properties: Record<string, any>): void;
}