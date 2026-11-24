import { useState, useEffect, useCallback, useRef } from 'react';

export default function useDirectory(path, desktopRoot) {
  const [files, setFiles] = useState([]);
  const [directoryMetadata, setDirectoryMetadata] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const requestIdRef = useRef(0);
  const refreshTimerRef = useRef(null);
  const pathRef = useRef(path);
  pathRef.current = path;

  const load = useCallback(async (targetPath) => {
    const reqId = ++requestIdRef.current;
    if (!targetPath) {
      setFiles([]);
      setDirectoryMetadata(null);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const api = window.electron_desktop_API;
      const res = await api.readDir(targetPath, desktopRoot);
      if (reqId !== requestIdRef.current) return;

      if (!res.success) {
        setError(res.error || 'unknown');
        setFiles([]);
        setDirectoryMetadata(null);
      } else {
        const sorted = [...res.files].sort((a, b) => {
          if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
          return (a.displayName || a.name).localeCompare(
            b.displayName || b.name,
            undefined,
            { sensitivity: 'base' },
          );
        });
        setFiles(sorted.map((file) => ({ ...file, iconUrl: null })));
        setDirectoryMetadata(res.directoryMetadata || null);
        if (typeof api.getFileIcons === 'function' && sorted.length > 0) {
          void api.getFileIcons(sorted.map((file) => file.iconPath || file.id))
            .then((icons) => {
              if (reqId !== requestIdRef.current) return;
              setFiles((current) => current.map((file) => ({
                ...file,
                iconUrl: icons[file.iconPath || file.id] || null,
              })));
            })
            .catch((iconError) => {
              console.error('[desktop] could not load file icons:', iconError);
            });
        }
      }
    } catch (err) {
      if (reqId !== requestIdRef.current) return;
      setError(err?.message || 'unknown');
      setFiles([]);
      setDirectoryMetadata(null);
    } finally {
      if (reqId === requestIdRef.current) setLoading(false);
    }
  }, [desktopRoot]);

  // Первичная загрузка + подписка на fs.watch через main
  useEffect(() => {
    if (!path) {
      setFiles([]);
      return;
    }

    const api = window.electron_desktop_API;

    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }
    load(path);
    api.watchStart(path);

    return () => {
      requestIdRef.current += 1;
      api.watchStop(path);
    };
  }, [path, load]);

  // Слушаем fs:did-change — если наша папка, перезагружаем
  useEffect(() => {
    const api = window.electron_desktop_API;
    const off = api.on('fs:did-change', (msg) => {
      if (!msg || !msg.dir) return;
      if (msg.dir === pathRef.current) {
        if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = setTimeout(() => {
          refreshTimerRef.current = null;
          load(pathRef.current);
        }, 100);
      }
    });
    return () => {
      off();
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    };
  }, [load]);

  const reload = useCallback(() => load(path), [path, load]);

  return { files, directoryMetadata, loading, error, reload };
}