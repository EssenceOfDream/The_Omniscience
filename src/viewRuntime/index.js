import { useEffect, useState } from 'react';
import { settingsStore } from '../settings/store';

// Кэш значений по path
const cache = new Map();
// path -> Set<setter>
const listeners = new Map();

let bootstrapped = false;

function ensureBootstrap() {
	if (bootstrapped) return;
	bootstrapped = true;

	const api = window.electron_view_API;
	if (!api) {
		console.warn('[viewStore] electron_view_API не найден — view работает вне моста?');
		return;
	}

	api.onStateUpdate(({ path, value }) => {
		cache.set(path, value);
		const fns = listeners.get(path);
		if (fns) for (const fn of fns) fn(value);
	});
}

/**
 * Подписка на срез state shell’а.
 * @param {string} path  напр. 'desktops.<desktopId>.isOverviewOpened'
 * @returns {*} текущее значение (или undefined, пока не пришло)
 */
export function useViewSetting(path) {
	const isTauriSetting = path.startsWith('settings.') && Boolean(window.__TAURI__);
	const settingsPath = path.slice('settings.'.length);
	const [value, setValue] = useState(() => (
		isTauriSetting
			? settingsPath.split('.').reduce((state, key) => (state == null ? state : state[key]), settingsStore.getState())
			: cache.get(path)
	));

	useEffect(() => {
		if (isTauriSetting) {
			const update = () => {
				const next = settingsPath
					.split('.')
					.reduce((state, key) => (state == null ? state : state[key]), settingsStore.getState());
				setValue(next);
			};
			update();
			return settingsStore.subscribe(update);
		}

		ensureBootstrap();

		let fns = listeners.get(path);
		if (!fns) {
			fns = new Set();
			listeners.set(path, fns);
			window.electron_view_API?.subscribe([path]);
		}
		fns.add(setValue);

		if (cache.has(path)) setValue(cache.get(path));

		return () => {
			fns.delete(setValue);
			if (fns.size === 0) {
				listeners.delete(path);
				window.electron_view_API?.unsubscribe([path]);
			}
		};
	}, [isTauriSetting, path, settingsPath]);

	return value;
}

/**
 * Диспатч действия в shell.
 * @param {string} type   имя экшена из windowManager
 * @param {object} payload
 */
export function viewDispatch(type, payload) {
	if (window.__TAURI__ && type === 'updateSetting' && typeof payload?.path === 'string') {
		settingsStore.update(payload.path, payload.value);
		return;
	}
	window.electron_view_API?.dispatch(type, payload);
}

export {
	useProjectRoot,
	isExternalUrl,
	isAbsolutePath,
	toFileUrl,
	resolveLocalPath,
	resolveForDisplay,
} from './paths';