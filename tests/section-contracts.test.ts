import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ASSIGNABLE_PERMISSIONS,
  MAIN_SECTIONS,
  SECTION_CONTRACTS,
  canReadSection,
  isMainSection,
} from '../src/shared/sections.ts';

test('section contracts are complete, unique, and reference assignable permissions', () => {
  assert.deepEqual(Object.keys(SECTION_CONTRACTS), [...MAIN_SECTIONS]);
  assert.equal(new Set(MAIN_SECTIONS).size, MAIN_SECTIONS.length);
  assert.equal(new Set(ASSIGNABLE_PERMISSIONS).size, ASSIGNABLE_PERMISSIONS.length);

  for (const section of MAIN_SECTIONS) {
    const contract = SECTION_CONTRACTS[section];
    assert.ok(contract.title.length > 0);
    if (contract.readPermission) assert.ok(ASSIGNABLE_PERMISSIONS.includes(contract.readPermission));
    for (const permission of contract.writePermissions) {
      assert.ok(ASSIGNABLE_PERMISSIONS.includes(permission));
    }
  }
});

test('shared section guards reject unknown routes and enforce read permission', () => {
  assert.equal(isMainSection('customers'), true);
  assert.equal(isMainSection('unknown-section'), false);
  assert.equal(canReadSection(['companies.read'], 'companies'), true);
  assert.equal(canReadSection(['companies.write'], 'companies'), false);
  assert.equal(canReadSection(['treasury.read'], 'settings'), false);
});
