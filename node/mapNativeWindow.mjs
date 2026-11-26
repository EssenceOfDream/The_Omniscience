import path from 'node:path';

export default function (window, icon = null) {
  return {
    id: String(window.id),
    title: window.title || window.processName || 'Окно',
    processName: path.basename(window.imagePath || '').replace(/\.[^.]+$/, '') || null,
    icon,
    pid: Number(window.pid) || null,
    minimized: Boolean(window.minimized),
    maximized: Boolean(window.maximized),
    focused: Boolean(window.focused),
  };
}