import test from 'node:test';
import assert from 'node:assert/strict';
import { extractLinkCodeFromSearch, consumeUrlLinkCode } from '../src/services/linkCodeFromUrl.js';

test('extracts and uppercases the code from a QR link query string, stripping it', () => {
  const result = extractLinkCodeFromSearch('?code=ab12cd34');
  assert.equal(result.code, 'AB12CD34');
  assert.equal(result.nextSearch, '');
});

test('keeps other query params when removing the code', () => {
  const result = extractLinkCodeFromSearch('?utm=kakao&code=ab12cd34');
  assert.equal(result.code, 'AB12CD34');
  assert.equal(result.nextSearch, '?utm=kakao');
});

test('returns a null code and leaves the search string untouched when there is no code param', () => {
  const result = extractLinkCodeFromSearch('?utm=kakao');
  assert.equal(result.code, null);
  assert.equal(result.nextSearch, '?utm=kakao');
});

test('returns a null code for an empty or missing search string', () => {
  assert.equal(extractLinkCodeFromSearch('').code, null);
  assert.equal(extractLinkCodeFromSearch(undefined).code, null);
});

test('consumeUrlLinkCode reads the code once and rewrites the URL without it', () => {
  const calls = [];
  const win = {
    location: { search: '?code=ab12cd34', pathname: '/', hash: '' },
    history: { replaceState: (...args) => calls.push(args) },
  };
  const code = consumeUrlLinkCode(win);
  assert.equal(code, 'AB12CD34');
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], [null, '', '/']);
});

test('consumeUrlLinkCode preserves other params and the hash when rewriting the URL', () => {
  const calls = [];
  const win = {
    location: { search: '?utm=kakao&code=ab12cd34', pathname: '/app', hash: '#diary' },
    history: { replaceState: (...args) => calls.push(args) },
  };
  const code = consumeUrlLinkCode(win);
  assert.equal(code, 'AB12CD34');
  assert.deepEqual(calls[0], [null, '', '/app?utm=kakao#diary']);
});

test('consumeUrlLinkCode returns null without touching history when there is no code', () => {
  const calls = [];
  const win = {
    location: { search: '', pathname: '/', hash: '' },
    history: { replaceState: (...args) => calls.push(args) },
  };
  const code = consumeUrlLinkCode(win);
  assert.equal(code, null);
  assert.equal(calls.length, 0);
});

test('consumeUrlLinkCode returns null when there is no window-like object (SSR)', () => {
  assert.equal(consumeUrlLinkCode(undefined), null);
  assert.equal(consumeUrlLinkCode({}), null);
});
