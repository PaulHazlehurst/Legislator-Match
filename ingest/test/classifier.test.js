import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyBill } from '../../shared/classifier.js';
import { validate, decide, RESPONSE_SCHEMA, buildUserMessage } from '../lib/ai-classify.js';

const c = (title, subjects = [], description = '') => classifyBill({ title, subjects, description });

test('v1 regressions are fixed', () => {
  assert.equal(c('Limited Line Credit Insurance - Qualification of Applicants', ['Insurance - Other than Health', 'Insurance', 'Job Training']).topic, 'insurance-financial');
  assert.equal(c('Regulated Firearms - Seven-Day Waiting Period - Exceptions', ['Public Safety', 'Guns']).topic, 'firearms');
  assert.equal(c('Property Tax - Exemption - Glenstone Foundation, Inc.', ['Taxes - Property']).topic, 'taxation');
  assert.equal(c('Cosmetology Licensure Compact', ['Business Occupations and Professions', 'Education']).topic, 'business-regulation');
});

test('generic heading defers to the specific segment', () => {
  assert.equal(c('Criminal Law - Firearms - Exception to Trespass Prohibition', ['Criminal Law - Substantive Crimes']).topic, 'firearms');
  assert.equal(c('Real Property - Condominiums - Assessments', ['Real Property', 'Condominiums']).topic, 'housing');
});

test('local bills keep their policy area and are flagged local', () => {
  const r = c("Prince George's County - Alcoholic Beverages - Class B Licenses PG 321-26", ['Alcoholic Beverages - Local Bills']);
  assert.equal(r.topic, 'alcohol-licensing'); assert.equal(r.subtopic, 'local-licenses'); assert.equal(r.significance, 'local');
  assert.equal(c('Baltimore County - Sheriff - Salary', ['Courts and Court Personnel - Local']).topic, 'local-government');
});

test('commemoratives follow their subject and are ceremonial', () => {
  const r = c('General Provisions - Commemorative Month - Maryland Native Plant Month', ['State Government - Agencies, Offices, and Officials', 'Agriculture']);
  assert.equal(r.topic, 'environment'); assert.equal(r.significance, 'ceremonial');
  assert.equal(c('Overdose Awareness Day', ['State Government - Agencies, Offices, and Officials', 'Awareness and Outreach']).topic, 'health');
  assert.equal(c('Korean American Day', ['State Government - Agencies, Offices, and Officials']).topic, 'government-admin');
});

test('title-backed secondary topics', () => {
  const r = c('Income Tax - Credit for Employers of Eligible Apprentices - Alterations', ['Taxes - Income']);
  assert.equal(r.topic, 'taxation'); assert.equal(r.secondary, 'workforce');
});

test('every result carries evidence and a confidence', () => {
  const r = c('Health Insurance - Coverage for Calcium Score Testing', ['Health - Insurance']);
  assert.equal(r.topic, 'health'); assert.equal(r.subtopic, 'health-insurance-medicaid');
  assert.ok(['high', 'medium', 'low'].includes(r.confidence)); assert.ok(r.evidence.length > 0);
});

test('empty input does not throw', () => {
  assert.equal(classifyBill({ title: '' }).topic, null);
});

test('AI answers are validated against the taxonomy', () => {
  assert.equal(validate({ topic: 'not-a-topic' }), null);
  assert.deepEqual(validate({ topic: 'health', subtopic: 'income-tax', secondary: 'health', confidence: 'high' }),
    { topic: 'health', subtopic: null, secondary: null, confidence: 'high' });
});

test('AI may only overrule the rules when confident or among candidates', () => {
  const rules = { topic: 'transportation', subtopic: 'vehicle-law', secondary: null, confidence: 'low', scores: { transportation: 7, 'business-regulation': 3 }, evidence: [] };
  assert.equal(decide(rules, { topic: 'business-regulation', subtopic: null, secondary: null, confidence: 'low' }).topic, 'business-regulation');
  assert.equal(decide(rules, { topic: 'agriculture', subtopic: null, secondary: null, confidence: 'low' }).topic, 'transportation');
  assert.equal(decide(rules, { topic: 'agriculture', subtopic: null, secondary: null, confidence: 'high' }).topic, 'agriculture');
  assert.equal(decide(rules, null).topic, 'transportation');
});

test('prompt payload and schema are well formed', () => {
  const msg = buildUserMessage([{ id: 1, title: 'X', subjects: ['A'], rules: { scores: { health: 3 } } }]);
  assert.match(msg, /"candidates"/);
  assert.ok(RESPONSE_SCHEMA.properties.results.items.properties.topic.enum.includes('housing'));
});
