import iconv from 'iconv-lite';

export function getDisplaySsid(ssid) {
  if (!/(?:[РС][\u0400-\u04ff]|в[“”„•…€’‘])/.test(ssid)) return ssid;

  const decoded = iconv.decode(iconv.encode(ssid, 'cp1251'), 'utf8');
  return decoded.includes('\uFFFD') ? ssid : decoded;
}
