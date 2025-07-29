// Type definitions for Electron's webview tag
// This adds support for the webview tag in TypeScript

declare namespace JSX {
  interface IntrinsicElements {
    'webview': WebviewHTMLAttributes;
  }
}

interface WebviewHTMLAttributes extends React.HTMLAttributes<HTMLElement> {
  allowpopups?: boolean | string;
  autosize?: boolean | string;
  blinkfeatures?: string;
  disableblinkfeatures?: string;
  disableguestresize?: boolean | string;
  disablewebsecurity?: boolean | string;
  enableblinkfeatures?: string;
  enableremotemodule?: boolean | string;
  httpreferrer?: string;
  nodeintegration?: boolean | string;
  partition?: string;
  plugins?: boolean | string;
  preload?: string;
  src?: string;
  useragent?: string;
  webpreferences?: string;
}