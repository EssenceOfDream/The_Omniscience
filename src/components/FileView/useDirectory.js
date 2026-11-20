import { useState, useEffect, useCallback, useRef } from 'react';

export default function useDirectory(path, desktopRoot) {
  const [files, setFiles] = useState([]);
  const [directoryMetadata, setDirectoryMetadata] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const requestIdRef = useRef(0);
  const pathRef = useRef(path);
  pathRef.current = path;

  const load = useCallback(async (targetPath) => {
    if (!targetPath) {
      setFiles([]);
      setDirectoryMetadata(null);
      return;
    }

    const reqId = ++requestIdRef.current;
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
        setFiles(sorted);
        setDirectoryMetadata(res.directoryMetadata || null);
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

    load(path);
    api.watchStart(path);

    return () => {
      api.watchStop(path);
    };
  }, [path, load]);

  // Слушаем fs:did-change — если наша папка, перезагружаем
  useEffect(() => {
    const api = window.electron_desktop_API;
    const off = api.on('fs:did-change', (msg) => {
      if (!msg || !msg.dir) return;
      if (msg.dir === pathRef.current) {
        // Небольшая задержка — fs.watch иногда стреляет быстрее,
        // чем файловая система успевает применить изменения
        setTimeout(() => load(pathRef.current), 100);
      }
    });
    return off;
  }, [load]);

  const reload = useCallback(() => load(path), [path, load]);

  return { files, directoryMetadata, loading, error, reload };
}