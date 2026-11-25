import { useState, useEffect } from 'react';

const URL_RE = /^(https?|data|blob|file):\/\//i;
const ABS_RE = /^([a-zA-Z]:[\\/]|\/)/;

let _cachedRoot = null;
let _pendingRoot = null;

export function useProjectRoot() {
	const [root, setRoot] = useState(_cachedRoot);
	useEffect(() => {
		if (_cachedRoot !== null) { setRoot(_cachedRoot); return; }
		let alive = true;
		fetchProjectRoot().then((r) => { if (alive) setRoot(r); });
		return () => { alive = false; };
	}, []);
	return root;
}

export function isExternalUrl(path) {
	return URL_RE.test(String(path || ''));
}

export function isAbsolutePath(path) {
	return ABS_RE.test(String(path || ''));
}

/**
 * Локальный путь → file:// URL. Внешние URL пропускаем как есть.
 */
export function toFileUrl(path) {
	if (!path) return path;
	if (URL_RE.test(path)) return path;
	const p = String(path).replace(/\\/g, '/');
	if (p.startsWith('//')) {
		const [host, ...segments] = p.slice(2).split('/');
		return `file://${host}/${segments.map(encodeURIComponent).join('/')}`;
	}
	const segments = p.split('/').map((segment) => (
		/^[a-zA-Z]:$/.test(segment) ? segment : encodeURIComponent(segment)
	));
	if (!p.startsWith('/')) segments.unshift('');
	return `file://${segments.join('/')}`;
}

/**
 * Относительный локальный путь → абсолютный (от projectRoot).
 * Внешние URL и абсолютные пути возвращает как есть.
 */
export function resolveLocalPath(path, projectRoot) {
	if (!path) return path;
	if (isExternalUrl(path)) return path;
	if (isAbsolutePath(path)) return path;
	if (!projectRoot) return path;

	const sep = projectRoot.includes('\\') ? '\\' : '/';
	const rootClean = projectRoot.replace(/[\\/]+$/, '');
	const relParts = String(path)
		.replace(/\\/g, '/')
		.replace(/^\.\//, '')
		.split('/')
		.filter((p) => p && p !== '.');

	const parts = rootClean.replace(/\\/g, '/').split('/');
	for (const p of relParts) {
		if (p === '..') parts.pop();
		else parts.push(p);
	}
	return parts.join(sep);
}

/**
 * Готовый хелпер: resolve + file://. Возвращает строку, пригодную для src/url().
 */
export function resolveForDisplay(path, projectRoot) {
	if (!path) return path;
	if (isExternalUrl(path)) return path;
	if (window.__TAURI__ && String(path).startsWith('public/')) {
		return `/${String(path).slice('public/'.length)}`;
	}
	if (!isAbsolutePath(path)) {
		path = resolveLocalPath(path, projectRoot) || path;
	}
	if (isAbsolutePath(path) && window.__TAURI__?.core?.convertFileSrc) {
		return window.__TAURI__.core.convertFileSrc(path);
	}
	return toFileUrl(path);
}

export function fetchProjectRoot() {
  if (_cachedRoot !== null) return Promise.resolve(_cachedRoot);
  if (!_pendingRoot) {
    // В componentapps доступен electron_view_API,
    // в shell — electron_desktop_API. Работает и там, и там.
    const api = window.electron_view_API || window.electron_desktop_API;
    _pendingRoot = (api?.getProjectRoot?.() || Promise.resolve(''))
      .then((r) => { _cachedRoot = r || ''; return _cachedRoot; })
      .catch(() => { _cachedRoot = ''; return ''; });
  }
  return _pendingRoot;
}