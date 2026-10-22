import assert from 'node:assert/strict';
import { test } from 'node:test';
import { english } from '../src/client/i18n/english.ts';
import { loadLanguageCatalog, resolveLanguage, translateFor } from '../src/client/i18n/language.ts';
import { serverErrorText } from '../src/client/i18n/serverMessages.ts';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { SECTION_CONTRACTS } from '../src/shared/sections.ts';

await loadLanguageCatalog('en');

test('language preference accepts only supported locales and defaults to Arabic', () => {
  assert.equal(resolveLanguage(null, null), 'ar');
  assert.equal(resolveLanguage(null, 'en'), 'en');
  assert.equal(resolveLanguage('ar', 'en'), 'ar');
  assert.equal(resolveLanguage('en', 'ar'), 'en');
  assert.equal(resolveLanguage('<script>', 'en'), 'en');
  assert.equal(resolveLanguage(null, 'invalid'), 'ar');
});

test('UI localization preserves Arabic text, whitespace and user supplied values', () => {
  assert.equal(translateFor('ar', ' بواسطة '), ' بواسطة ');
  assert.equal(translateFor('en', ' بواسطة '), ' By ');
  assert.equal(
    translateFor('en', 'تم إنشاء كارت {0} وسجله الدائم.', ['محمد {1} <b>']),
    'Card and permanent record created for محمد {1} <b>.',
  );
  assert.equal(translateFor('ar', 'بواسطة {0}', ['John']), 'بواسطة John');
  assert.equal(translateFor('en', 'اسم عميل غير موجود في القاموس'), 'اسم عميل غير موجود في القاموس');
  assert.equal(translateFor('en', 'دخول', [], 'ledger'), 'Inflow');
  assert.equal(translateFor('en', 'دخول'), 'Sign in');
  assert.equal(translateFor('en', '__proto__'), '__proto__');
  assert.equal(translateFor('en', 'constructor'), 'constructor');
});

test('every catalog entry preserves the original interpolation tokens', () => {
  const tokens = (value: string) => [...value.matchAll(/\{\d+\}/g)].map((match) => match[0]).sort();
  for (const [arabic, translated] of Object.entries(english)) {
    assert.ok(translated.trim(), arabic);
    assert.deepEqual(tokens(translated), tokens(arabic), arabic);
  }
});

test('every source UI translation key and shared section title has an English entry', () => {
  let translatedCalls = 0;
  const walk = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'i18n') walk(path);
        continue;
      }
      if (!/\.tsx?$/.test(entry.name)) continue;
      const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
      const visit = (node: ts.Node) => {
        if (
          ts.isCallExpression(node) &&
          ts.isIdentifier(node.expression) &&
          node.expression.text === 'uiText'
        ) {
          const key = node.arguments[0];
          const context = node.arguments[2];
          if (key && ts.isStringLiteral(key)) {
            const normalized = key.text.trim().replace(/\s+/g, ' ');
            const lookup =
              context && ts.isStringLiteral(context) ? `${normalized}|${context.text}` : normalized;
            assert.ok(Object.hasOwn(english, lookup), `${path}: ${lookup}`);
            translatedCalls++;
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
  };
  walk('src/client');
  assert.ok(translatedCalls > 1000);
  for (const section of Object.values(SECTION_CONTRACTS)) assert.ok(Object.hasOwn(english, section.title));
});

test('API errors localize by code while preserving Arabic and unknown English messages', () => {
  assert.equal(serverErrorText('INVALID_CREDENTIALS', 'رسالة الخادم', 'ar'), 'رسالة الخادم');
  assert.equal(
    serverErrorText('INVALID_CREDENTIALS', 'رسالة الخادم', 'en'),
    'Incorrect username or password.',
  );
  assert.equal(serverErrorText('NEW_CODE', 'An error', 'en'), 'An error');
  assert.match(serverErrorText('NEW_CODE', 'رسالة جديدة', 'en'), /NEW_CODE/);
  assert.match(serverErrorText('RESTORE_CONFIRMATION', 'استعادة', 'en'), /استعادة/);
});
