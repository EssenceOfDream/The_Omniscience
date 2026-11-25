(() => {
  const extensions = __OMNI_EXTENSION_CONFIG__;
  const executors = __OMNI_EXTENSION_EXECUTORS__;
  const target = __OMNI_TARGET__;
  if (document.__omniExtensionsInitialized) return;
  document.__omniExtensionsInitialized = true;

  const invoke = window.__TAURI__?.core?.invoke;

  function matches(pattern, href) {
    let url;
    try {
      url = new URL(href);
    } catch {
      return false;
    }
    if (pattern === '<all_urls>') {
      return ['http:', 'https:', 'file:', 'ftp:', 'tauri:', 'asset:'].includes(url.protocol);
    }

    const match = pattern.match(/^([^:]+):\/\/([^/]*)(\/.*)$/);
    if (!match) return false;
    const schemeMatches = match[1] === '*'
      ? ['http:', 'https:'].includes(url.protocol)
      : url.protocol === `${match[1]}:`;
    if (!schemeMatches) return false;

    const host = match[2].toLowerCase();
    const hostname = url.hostname.toLowerCase();
    if (host && host !== '*') {
      if (host.startsWith('*.')) {
        const suffix = host.slice(2);
        if (hostname !== suffix && !hostname.endsWith(`.${suffix}`)) return false;
      } else if (hostname !== host) {
        return false;
      }
    }

    const pathPattern = new RegExp(
      `^${match[3].replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`,
    );
    return pathPattern.test(url.pathname);
  }

  function eventFor(listeners) {
    return {
      addListener(listener) {
        if (typeof listener === 'function') listeners.add(listener);
      },
      removeListener(listener) {
        listeners.delete(listener);
      },
      hasListener(listener) {
        return listeners.has(listener);
      },
    };
  }

  function makeApi(id) {
    const storageListeners = new Set();
    const messageListeners = new Set();
    const fallbackKey = `__omniscience_extension_storage__${id}`;
    const fallbackRead = () => {
      try {
        return JSON.parse(localStorage.getItem(fallbackKey) || '{}');
      } catch {
        return {};
      }
    };
    const notifyStorageChanged = (changes) => {
      for (const listener of storageListeners) {
        try {
          listener(changes, 'local');
        } catch (error) {
          console.error('[extensions] storage listener failed:', error);
        }
      }
    };

    if (target === 'shell' || target === 'componentapps') {
      if (window.__TAURI__?.event?.listen) {
        window.__TAURI__.event.listen('extension-storage-changed', ({ payload }) => {
          if (payload?.extensionId === id) notifyStorageChanged(payload.changes);
        }).catch((error) =>
          console.error('[extensions] storage event subscription failed:', error));
      }
    }

    window.addEventListener('__omniscience_extension_storage_changed__', ({ detail }) => {
      if (detail?.extensionId === id) notifyStorageChanged(detail.changes);
    });

    const readStorage = (keys) => invoke
      ? invoke('extension_storage_get', {
        extensionId: id,
        keys: keys ?? null,
      })
      : Promise.resolve(readFallbackStorage(keys));

    const writeStorage = (payload) => {
      if (invoke) {
        return invoke('extension_storage_set', {
          extensionId: id,
          items: payload.items || {},
          removeKeys: payload.removeKeys || [],
          clear: payload.clear === true,
        });
      }
      const previous = fallbackRead();
      const updated = payload.clear ? {} : { ...previous, ...(payload.items || {}) };
      for (const key of payload.removeKeys || []) delete updated[key];
      const changes = {};
      const changedKeys = new Set([
        ...Object.keys(payload.items || {}),
        ...(payload.removeKeys || []),
        ...(payload.clear ? Object.keys(previous) : []),
      ]);
      for (const key of changedKeys) {
        if (Object.hasOwn(previous, key)) changes[key] = { oldValue: previous[key] };
        if (Object.hasOwn(updated, key)) {
          changes[key] = { ...changes[key], newValue: updated[key] };
        }
      }
      localStorage.setItem(fallbackKey, JSON.stringify(updated));
      notifyStorageChanged(changes);
      return Promise.resolve();
    };

    function readFallbackStorage(keys) {
      const values = fallbackRead();
      if (keys == null) return values;
      if (typeof keys === 'string') {
        return Object.hasOwn(values, keys) ? { [keys]: values[keys] } : {};
      }
      if (Array.isArray(keys)) {
        return Object.fromEntries(keys
          .filter((key) => Object.hasOwn(values, key))
          .map((key) => [key, values[key]]));
      }
      if (typeof keys === 'object') {
        return Object.fromEntries(Object.entries(keys)
          .map(([key, fallback]) => [key, Object.hasOwn(values, key) ? values[key] : fallback]));
      }
      return {};
    }

    const runtime = {
      id,
      getURL(path = '') {
        const cleanPath = String(path).replace(/^\/+/, '');
        const encodedPath = cleanPath.split('/').map(encodeURIComponent).join('/');
        let basePath = `/extensions/${encodeURIComponent(id)}/`;
        const extensionPath = location.pathname.match(/^(.*\/extensions\/([^/]+)\/)/);
        if (extensionPath) {
          try {
            if (decodeURIComponent(extensionPath[2]) === id) basePath = extensionPath[1];
          } catch {}
        }
        return `${location.origin}${basePath}${encodedPath}`;
      },
      onMessage: eventFor(messageListeners),
      sendMessage(message, callback) {
        let response;
        for (const listener of messageListeners) {
          let replied = false;
          try {
            listener(message, {}, (value) => {
              if (!replied) {
                response = value;
                replied = true;
              }
            });
          } catch (error) {
            console.error('[extensions] runtime message listener failed:', error);
          }
        }
        if (typeof callback === 'function') callback(response);
        return Promise.resolve(response);
      },
    };
    const local = {
      get(keys, callback) {
        const promise = readStorage(keys);
        if (typeof callback === 'function') {
          promise.then(callback).catch((error) =>
            console.error('[extensions] storage get failed:', error));
        }
        return promise;
      },
      set(items, callback) {
        const promise = writeStorage({ items });
        if (typeof callback === 'function') {
          promise.then(() => callback()).catch((error) =>
            console.error('[extensions] storage set failed:', error));
        }
        return promise;
      },
      remove(keys, callback) {
        const promise = writeStorage({ removeKeys: Array.isArray(keys) ? keys : [keys] });
        if (typeof callback === 'function') {
          promise.then(() => callback()).catch((error) =>
            console.error('[extensions] storage remove failed:', error));
        }
        return promise;
      },
      clear(callback) {
        const promise = writeStorage({ clear: true });
        if (typeof callback === 'function') {
          promise.then(() => callback()).catch((error) =>
            console.error('[extensions] storage clear failed:', error));
        }
        return promise;
      },
    };

    return { runtime, storage: { local, onChanged: eventFor(storageListeners) } };
  }

  const pageExtension = location.pathname.match(/(?:^|\/)extensions\/([^/]+)\//);
  if (pageExtension) {
    const extensionId = decodeURIComponent(pageExtension[1]);
    window.chrome = window.chrome || {};
    Object.assign(window.chrome, makeApi(extensionId));
  }

  const isExtensionPage = Boolean(pageExtension);
  for (const [extensionIndex, extension] of extensions.entries()) {
    if (extension.targets?.[target] !== true) continue;
    const api = makeApi(extension.id);

    const runEntry = (section, entry, entryIndex) => {
      if (!entry.matches.some((pattern) => matches(pattern, location.href))) return;
      for (const css of entry.css || []) {
        const style = document.createElement('style');
        style.dataset.omniExtension = extension.id;
        style.textContent = css;
        const appendStyle = () => {
          const parent = document.head || document.documentElement;
          if (!parent) return false;
          const nonce = document.querySelector('script[nonce]')?.nonce;
          if (nonce) style.nonce = nonce;
          parent.appendChild(style);
          return true;
        };
        if (!appendStyle()) {
          const observer = new MutationObserver(() => {
            if (appendStyle()) observer.disconnect();
          });
          observer.observe(document, { childList: true, subtree: true });
        }
      }
      const execute = executors[extensionIndex]?.[section]?.[entryIndex];
      if (typeof execute !== 'function') {
        console.error(`[extensions] ${section} executor is unavailable:`, extension.id, entryIndex);
        return;
      }
      const chromeApi = window.chrome || {};
      Object.assign(chromeApi, api);
      window.chrome = chromeApi;
      try {
        execute.call(window, chromeApi);
      } catch (error) {
        console.error(`[extensions] ${section} script failed:`, extension.id, error);
      }
    }

    for (const [entryIndex, entry] of (extension.preloads || []).entries()) {
      runEntry('preloads', entry, entryIndex);
    }

    if (isExtensionPage) continue;
    for (const [entryIndex, entry] of (extension.contentScripts || []).entries()) {
      const run = () => runEntry('contentScripts', entry, entryIndex);
      if (entry.runAt === 'document_start') {
        run();
      } else if (entry.runAt === 'document_end') {
        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', run, { once: true });
        } else {
          run();
        }
      } else if (document.readyState === 'complete') {
        setTimeout(run, 0);
      } else {
        window.addEventListener('load', run, { once: true });
      }
    }
  }
})();
