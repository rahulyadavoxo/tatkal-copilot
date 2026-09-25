/**
 * Typed re-export of react-native-webview.
 *
 * Packaging bug in react-native-webview v13.17.0: the root index.d.ts
 * declares `class WebView<P = undefined>` with props `WebViewProps & P`,
 * which collapses to `never` — no props typecheck. The runtime value is
 * fine; the real component type lives in lib/WebView.d.ts as
 * FunctionComponent<WebViewProps>. This module re-types the same runtime
 * value (a forwardRef component) so tsc and Metro agree.
 *
 * If a future webview version fixes the root types, delete this shim and
 * import from 'react-native-webview' directly.
 */
import React from 'react';
import { WebView as RNWebView } from 'react-native-webview';
import type { WebViewProps } from 'react-native-webview/lib/WebView';

/** Instance methods the app uses (subset of the real component API). */
export interface WebViewInstance {
  injectJavaScript: (script: string) => void;
  reload: () => void;
  goBack: () => void;
  goForward: () => void;
}

const WebView = RNWebView as unknown as React.ForwardRefExoticComponent<
  WebViewProps & React.RefAttributes<WebViewInstance>
>;

export default WebView;
export type { WebViewProps };
