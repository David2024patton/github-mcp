import { describe, expect, it } from 'vitest';
import { WRITE_SPECS, writeSpec, specReadQuery, inverseDocument, inputTypeName, specInput } from '../../src/github/graphql-writes.js';
import { githubGraphqlSchema, inspectGraphql } from '../../src/github/graphql-schema.js';
import { curatedGraphqlMutation } from '../../src/github/mutation-classes.js';

const schema = githubGraphqlSchema();
const fieldsOf = (mutation) => schema.getMutationType().getFields()[mutation];
const inputFields = (mutation) => {
  const arg = fieldsOf(mutation).args.find((a) => a.name === 'input');
  let type = arg.type;
  while (type.ofType) type = type.ofType;
  return type.getFields();
};
const isIdField = (field) => {
  let type = field.type;
  while (type.ofType) type = type.ofType;
  return type.name === 'ID';
};

// ID inputs a spec refuses on purpose because ownership of those nodes cannot be proven (team members are users).
const REFUSED_ON_PURPOSE = { updateTeamReviewAssignment: ['excludedTeamMemberIds'], updateProjectV2DraftIssue: ['assigneeIds'] };

describe('Y-2 GraphQL write specs (WU-Y2a)', () => {
  it('has at least 24 reviewed mutations', () => {
    expect(WRITE_SPECS.size).toBeGreaterThanOrEqual(24);
  });

  for (const [mutation, spec] of WRITE_SPECS) {
    describe(mutation, () => {
      it('is a real mutation whose input fields match the spec exactly', () => {
        expect(fieldsOf(mutation), 'mutation exists in the pinned schema').toBeTruthy();
        const fields = inputFields(mutation);
        for (const key of Object.keys(spec.ids)) {
          expect(fields[key], `${key} is an input field`).toBeTruthy();
          expect(isIdField(fields[key]), `${key} is ID typed`).toBe(true);
          expect(spec.ids[key].length).toBeGreaterThan(0);
        }
        for (const key of spec.changes) {
          expect(fields[key], `${key} is an input field`).toBeTruthy();
        }
        // Every ID-typed input must be covered, otherwise the write is refused for an unknown ID and the spec is dead.
        for (const [key, field] of Object.entries(fields)) {
          if (isIdField(field) && !REFUSED_ON_PURPOSE[mutation]?.includes(key)) expect(Object.hasOwn(spec.ids, key), `${key} ID is covered`).toBe(true);
        }
        expect(Object.hasOwn(spec.ids, spec.primary)).toBe(true);
      });

      it('has a valid scope, a read selection the schema accepts and a complete mark set', () => {
        expect(['repo', 'org']).toContain(spec.scope);
        expect(() => inspectGraphql(specReadQuery(spec).replace('$id: ID!', '$id: ID!'), { id: 'X' }, 'query')).not.toThrow();
        expect(Object.keys(spec.cls).sort()).toEqual(['accessWidening', 'destructive', 'notifies']);
        expect(typeof spec.verify).toBe('function');
        if (spec.deleted) {
          expect(spec.verify({}, null, {})).toBe(true);
          expect(spec.verify({}, { id: 'still-there' }, {})).toBe(false);
        } else {
          expect(typeof spec.already).toBe('function');
        }
      });

      it('is not also owned by a specialised tool, and says how to undo when it has no inverse', () => {
        expect(curatedGraphqlMutation(mutation)).toBeNull();
        if (!spec.inverse) expect(spec.undoHint, 'plain-English opposite').toMatch(/\w+ \w+/);
        if (spec.cls.destructive) expect(spec.inverse).toBeNull();
      });
    });
  }

  it('every inverse mutation is itself a reviewed spec (an undo goes through the same guards)', () => {
    const sample = {
      issueId: 'I', issueCommentId: 'C', lockableId: 'L', subjectId: 'S', discussionId: 'D', id: 'X', commentId: 'DC',
      pullRequestId: 'P', linkedBranchId: 'LB', categoryId: 'CAT', title: 't', body: 'b', enabled: true, lockReason: 'SPAM', classifier: 'SPAM'
    };
    const before = {
      isPinned: true, locked: true, activeLockReason: 'SPAM', isMinimized: true, minimizedReason: 'spam', closed: true, stateReason: 'RESOLVED',
      title: 'old', body: 'old body', category: { id: 'CAT0' }, isAnswer: true, isDraft: true,
      linkedBranches: { nodes: [] }, reviewRequestDelegationEnabled: true, reviewRequestDelegationAlgorithm: 'ROUND_ROBIN'
    };
    const after = { ...before, linkedBranches: { nodes: [{ id: 'LB9', ref: { name: 'n' } }] } };
    for (const [mutation, spec] of WRITE_SPECS) {
      if (!spec.inverse) continue;
      const input = Object.fromEntries([...Object.keys(spec.ids), ...spec.changes].map((k) => [k, sample[k] ?? 'x']));
      const made = spec.inverse(input, before, after);
      if (!made) continue;
      expect(WRITE_SPECS.has(made.mutation), `${mutation} undo uses ${made.mutation}`).toBe(true);
      expect(inverseDocument(made.mutation)).toContain(`$input: ${inputTypeName(made.mutation)}!`);
      expect(() => inspectGraphql(inverseDocument(made.mutation), { input: made.input }, 'mutation')).not.toThrow();
    }
  });

  it('refuses inputs a spec does not cover and mutations without a spec', () => {
    const spec = writeSpec('pinIssue');
    expect(() => specInput(spec, 'pinIssue', { issueId: 'I', surprise: 1 }, [{ name: 'issueId', value: 'I' }])).toThrow(/not covered/);
    expect(() => specInput(spec, 'pinIssue', { issueId: 'I', other: 'x' }, [{ name: 'issueId', value: 'I' }, { name: 'other', value: 'x' }])).toThrow();
    expect(() => specInput(spec, 'pinIssue', {}, [])).toThrow(/needs issueId/);
    const team = writeSpec('updateTeamReviewAssignment');
    expect(() => specInput(team, 'updateTeamReviewAssignment', { id: 'T', enabled: true, excludedTeamMemberIds: ['U'] }, [{ name: 'id', value: 'T' }, { name: 'excludedTeamMemberIds', value: 'U' }])).toThrow(/not covered/);
    expect(writeSpec('addAssigneesToAssignable')).toBeNull();
    expect(writeSpec('mergePullRequest')).toBeNull();
  });

  it('the read-only selections never contain a mutation or credential-like field', () => {
    for (const spec of WRITE_SPECS.values()) expect(spec.before).not.toMatch(/mutation|token|secret|password/i);
  });
});
