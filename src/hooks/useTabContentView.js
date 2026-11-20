import { useEffect } from 'react';

const HIDDEN_BOUNDS = { x: -10000, y: -10000, width: 1, height: 1 };

function createLifecycleToken() {
  return globalThis.crypto?.randomUUID?.()
    || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function buildViewUrl(app, { desktopId, tabId }) {
  const url = new URL(app.url || app.initialUrl || 'about:blank');
  if (desktopId) url.searchParams.set('desktopId', desktopId);
  if (tabId) url.searchParams.set('tabId', tabId);
  return url.href;
}

export default function useTabContentView(
  viewId,
  app,
  containerRef,
  { desktopId, tabId, parentWindowId } = {},
) {
  useEffect(() => {
    if (!app || !parentWindowId) return undefined;

    const api = window.electron_desktop_API;
    if (!api) {
      console.error('[overview] desktop view API is unavailable');
      return undefined;
    }

    const element = containerRef.current;
    if (!element) return undefined;

    const lifecycleToken = createLifecycleToken();
    const viewUrl = buildViewUrl(app, { desktopId, tabId });
    api.createView({
      id: viewId,
      kind: 'window',
      role: 'overview-tab',
      lifecycleToken,
      url: viewUrl,
      preload: app.preloadPath || null,
      bounds: HIDDEN_BOUNDS,
      parentWindowId,
    });

    let disposed = false;
    let animationFrame = null;
    let lastBounds = null;

    const updateBounds = () => {
      animationFrame = null;
      if (disposed) return;

      const rect = element.getBoundingClientRect();
      const bounds = rect.width <= 1 || rect.height <= 1
        ? HIDDEN_BOUNDS
        : {
          x: Math.round(rect.left),
          y: Math.round(rect.top),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        };

      if (lastBounds
        && lastBounds.x === bounds.x
        && lastBounds.y === bounds.y
        && lastBounds.width === bounds.width
        && lastBounds.height === bounds.height) return;

      lastBounds = bounds;
      api.updateViewBounds({ id: viewId, bounds, lifecycleToken });
    };

    const scheduleBoundsUpdate = () => {
      if (animationFrame !== null) return;
      animationFrame = requestAnimationFrame(updateBounds);
    };
    const observer = new ResizeObserver(scheduleBoundsUpdate);

    observer.observe(element);
    window.addEventListener('resize', scheduleBoundsUpdate);
    window.addEventListener('scroll', scheduleBoundsUpdate, true);
    scheduleBoundsUpdate();

    return () => {
      disposed = true;
      observer.disconnect();
      window.removeEventListener('resize', scheduleBoundsUpdate);
      window.removeEventListener('scroll', scheduleBoundsUpdate, true);
      if (animationFrame !== null) cancelAnimationFrame(animationFrame);
      api.destroyView({ id: viewId, lifecycleToken });
    };
  }, [
    viewId,
    app?.id,
    app?.url,
    app?.initialUrl,
    app?.preloadPath,
    desktopId,
    tabId,
    parentWindowId,
    containerRef,
  ]);
}
