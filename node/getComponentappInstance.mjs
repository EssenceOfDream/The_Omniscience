export default function (payload) {
  return typeof payload?.windowId === 'string' && payload.windowId
    ? payload.windowId
    : `component-${payload?.appId || 'unknown'}`;
}