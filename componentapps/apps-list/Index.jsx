import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';

if (window.parent !== window
  && window.location.pathname.endsWith('/componentapps/apps-list/index.html')
  && window.parent.__OMNI_TAURI_OVERVIEW_API__) {
  const bridge = window.parent.__OMNI_TAURI_OVERVIEW_API__;
  window.electron_desktop_API = bridge.desktop;
  window.electron_view_API = bridge.view;
  document.documentElement.style.setProperty('background', 'transparent', 'important');
  document.body.style.setProperty('background', 'transparent', 'important');
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App
      windowId={window.__APP_WINDOW_ID__}
      desktopId={new URLSearchParams(window.location.search).get('desktopId') || ''}
    />
  </React.StrictMode>
);