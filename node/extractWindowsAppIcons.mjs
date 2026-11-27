import getWindowsAppIconHost from './getWindowsAppIconHost.mjs';

export default async function (requests, context = {}) {
  if (requests.length === 0) return new Map();
  if (typeof context.extractWindowsAppIcons === 'function') {
    return context.extractWindowsAppIcons(requests);
  }
  const entries = await getWindowsAppIconHost(context).request(requests);
  return new Map(entries.map((entry) => [entry.id, entry]));
}