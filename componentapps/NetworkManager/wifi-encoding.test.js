import assert from 'node:assert/strict';
import test from 'node:test';
import { getDisplaySsid } from './wifi-encoding.js';

test('decodes Windows SSIDs that were read with the wrong code page', () => {
  assert.equal(getDisplaySsid('HUAWEI-РћС‚ Р±РѕРіР°'), 'HUAWEI-От бога');
  assert.equal(getDisplaySsid('в“€в•ђв’єв•ђв“„в•ђв“ѓ'), 'Ⓢ═Ⓔ═Ⓞ═Ⓝ');
});

test('preserves ordinary SSIDs and valid Cyrillic names', () => {
  assert.equal(getDisplaySsid('Office-WiFi'), 'Office-WiFi');
  assert.equal(getDisplaySsid('Кириллическая сеть'), 'Кириллическая сеть');
  assert.equal(getDisplaySsid('Рыба'), 'Рыба');
});
