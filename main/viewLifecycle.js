function liveWindow(window) {
    return window && !window.isDestroyed() ? window : null;
}

export function resolveViewParent(parentWindowId, {
    mainWindow,
    topbarWindow,
    getWindowById,
}) {
    if (!parentWindowId) return liveWindow(mainWindow);
    if (parentWindowId === 'main') return liveWindow(mainWindow);
    if (parentWindowId === 'topbar') return liveWindow(topbarWindow);
    return liveWindow(getWindowById(parentWindowId));
}

export function getViewIdsForParentWindowInstance(views, parentWindow, role = null, excludeId = null) {
    return Object.entries(views)
        .filter(([id, entry]) => entry.parentWindow === parentWindow
            && (!role || entry.role === role)
            && id !== excludeId)
        .map(([id]) => id);
}

export function getOverviewSiblingViewIds(views, parentWindow, activeViewId) {
    return getViewIdsForParentWindowInstance(
        views,
        parentWindow,
        null,
        activeViewId,
    );
}
