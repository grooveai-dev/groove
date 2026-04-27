// FSL-1.1-Apache-2.0 — see LICENSE

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PIIScrubber } from '../../client/scrubber.js';

const scrubber = new PIIScrubber();

describe('PIIScrubber', () => {
  it('scrubs PEM private keys', () => {
    const input = '-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIB...\n-----END RSA PRIVATE KEY-----';
    assert.equal(scrubber.scrub(input), '[PRIVATE_KEY]');
  });

  it('scrubs AWS access keys', () => {
    const input = 'key is AKIAIOSFODNN7EXAMPLE here';
    assert.equal(scrubber.scrub(input), 'key is [AWS_KEY] here');
  });

  it('scrubs Bearer tokens', () => {
    const input = 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9';
    assert.equal(scrubber.scrub(input), 'Authorization: [API_KEY]');
  });

  it('scrubs sk_/pk_ prefixed keys', () => {
    const input = 'apikey: sk_test_51HQdMnAbcDefGhIjKlMn';
    assert.equal(scrubber.scrub(input), 'apikey: [API_KEY]');
  });

  it('scrubs valid credit cards with Luhn check', () => {
    const input = 'card: 4111 1111 1111 1111';
    assert.equal(scrubber.scrub(input), 'card: [CREDIT_CARD]');
  });

  it('does not scrub random 16-digit numbers failing Luhn', () => {
    const input = 'number: 1234 5678 9012 3456';
    assert.equal(scrubber.scrub(input), 'number: 1234 5678 9012 3456');
  });

  it('scrubs SSNs', () => {
    const input = 'ssn: 123-45-6789';
    assert.equal(scrubber.scrub(input), 'ssn: [SSN]');
  });

  it('scrubs email addresses', () => {
    const input = 'contact user@example.com for info';
    assert.equal(scrubber.scrub(input), 'contact [EMAIL] for info');
  });

  it('scrubs IPv6 addresses', () => {
    const input = 'server at 2001:0db8:85a3:0000:0000:8a2e:0370:7334';
    assert.equal(scrubber.scrub(input), 'server at [IP]');
  });

  it('scrubs IPv4 addresses', () => {
    const input = 'connect to 192.168.1.100';
    assert.equal(scrubber.scrub(input), 'connect to [IP]');
  });

  it('scrubs phone numbers', () => {
    const input = 'call (555) 123-4567';
    assert.equal(scrubber.scrub(input), 'call [PHONE]');
  });

  it('scrubs URLs with token/key/secret params', () => {
    const input = 'visit https://api.example.com/data?token=abc123&other=val';
    assert.equal(scrubber.scrub(input), 'visit [REDACTED_URL]&other=val');
  });

  it('scrubs long hex strings (40+ chars)', () => {
    const hex = 'a'.repeat(40);
    const input = `hash: ${hex}`;
    assert.equal(scrubber.scrub(input), 'hash: [API_KEY]');
  });

  it('scrubs home directory paths preserving relative path', () => {
    const input = 'file at /Users/john/Documents/secret.txt';
    assert.equal(scrubber.scrub(input), 'file at ~/Documents/secret.txt');
  });

  it('scrubs URL-encoded emails', () => {
    const input = 'param=ryan%40motovizion.com&next=home';
    assert.equal(scrubber.scrub(input), 'param=[EMAIL]&next=home');
  });

  it('scrubs international phone numbers', () => {
    const input = 'call +44 20 7946 0958 for help';
    assert.equal(scrubber.scrub(input), 'call [PHONE] for help');
  });

  it('scrubs JWT tokens without Bearer prefix', () => {
    const input = 'token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
    const result = scrubber.scrub(input);
    assert.ok(result.includes('[API_KEY]'));
    assert.ok(!result.includes('eyJhbGciOi'));
  });

  it('scrubs file paths preserving relative path', () => {
    const input = 'reading /home/alice/project/secret.key now';
    const result = scrubber.scrub(input);
    assert.equal(result, 'reading ~/project/secret.key now');
    assert.ok(!result.includes('/home/alice'));
  });

  it('scrubs base64 encoded secrets', () => {
    const b64 = 'YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXoxMjM0NTY3ODk=';
    const input = `secret: ${b64} done`;
    const result = scrubber.scrub(input);
    assert.ok(result.includes('[API_KEY]'));
    assert.ok(!result.includes(b64));
  });

  it('passes through non-PII content unchanged', () => {
    const input = 'This is a normal sentence about coding in JavaScript.';
    assert.equal(scrubber.scrub(input), input);
  });

  it('handles null/undefined input gracefully', () => {
    assert.equal(scrubber.scrub(null), null);
    assert.equal(scrubber.scrub(undefined), undefined);
    assert.equal(scrubber.scrub(''), '');
  });

  it('scrubs Windows home paths preserving relative path', () => {
    const input = 'file at C:\\Users\\bob\\Desktop\\project\\app.js';
    assert.equal(scrubber.scrub(input), 'file at ~\\Desktop\\project\\app.js');
  });

  it('scrubs home path with no trailing path', () => {
    const input = 'cd /Users/john';
    assert.equal(scrubber.scrub(input), 'cd ~');
  });

  it('does not scrub CSS pseudo-elements as IPv6', () => {
    const input = '.hero-icon::before { content: ""; }';
    assert.equal(scrubber.scrub(input), input);
  });

  it('still scrubs IPv6 loopback ::1', () => {
    const input = 'listening on ::1 port 3000';
    assert.equal(scrubber.scrub(input), 'listening on [IP] port 3000');
  });

  it('does not scrub file paths as base64 secrets', () => {
    const input = '/home/user/project/groove/packages/gui/src/views/settings.jsx';
    const result = scrubber.scrub(input);
    assert.ok(!result.includes('[API_KEY]'), `expected no [API_KEY] in: ${result}`);
  });

  it('still scrubs real base64 secrets without slashes', () => {
    const b64 = 'YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXoxMjM0NTY3ODk';
    const input = `key: ${b64} end`;
    const result = scrubber.scrub(input);
    assert.ok(result.includes('[API_KEY]'), `expected [API_KEY] in: ${result}`);
    assert.ok(!result.includes(b64));
  });

  it('patterns do not interfere with each other', () => {
    const input = 'user@example.com called 555-123-4567 from 192.168.1.1';
    const result = scrubber.scrub(input);
    assert.ok(result.includes('[EMAIL]'));
    assert.ok(result.includes('[PHONE]'));
    assert.ok(result.includes('[IP]'));
    assert.ok(!result.includes('user@example.com'));
    assert.ok(!result.includes('192.168.1.1'));
  });
});
