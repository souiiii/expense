import test from 'node:test';
import assert from 'node:assert/strict';
import { createState, createDemoState, fitDefaultsToIncome } from '../lib/seed.js';
import {
  AppError,
  addTransaction,
  allocateMonth,
  clientState,
  computeBankBalance,
  computePlan,
  computeUnallocated,
  deleteTransaction,
  moveBetweenEnvelopes,
  reconcileBalance,
  savePlan,
  undoAllocation,
  updateTransaction,
} from '../lib/domain.js';

const P = (rupees) => Math.round(rupees * 100);

function funded({ income = 100000, opening = 100000 } = {}) {
  return createState({
    monthlyIncomePaise: P(income),
    openingBalancePaise: P(opening),
    onboarded: true,
  });
}

function addIncome(state, amountRupees, date) {
  return addTransaction(state, {
    date,
    description: 'Salary',
    amountPaise: P(amountRupees),
    direction: 'in',
    kind: 'income',
  });
}

test('default plan splits fixed commitments first, then flexible percentages', () => {
  const state = funded();
  const plan = computePlan(state);

  assert.equal(plan.incomePaise, P(100000));
  assert.equal(plan.fixedTotalPaise, P(60000));
  assert.equal(plan.flexPoolPaise, P(40000));
  assert.equal(plan.flexPercentTotal, 100);
  assert.equal(plan.totalPaise, P(100000));
  assert.equal(plan.unplannedPaise, 0);

  const targets = new Map(plan.items.map((item) => [item.categoryId, item.targetPaise]));
  assert.equal(targets.get('rent'), P(20000));
  assert.equal(targets.get('invest'), P(15000));
  assert.equal(targets.get('groceries'), P(12000));
  assert.equal(targets.get('clothes'), P(4000));
  assert.equal(targets.get('misc'), P(8000));
});

test('allocation fills envelopes once and preserves the bank invariant', () => {
  const state = funded();
  const allocation = allocateMonth(state, '2026-10');

  assert.equal(computeUnallocated(state), 0);
  assert.equal(computeBankBalance(state), P(100000));
  assert.equal(allocation.fundedPaise, P(100000));
  assert.equal(state.categories.find((c) => c.id === 'rent').balancePaise, P(20000));
  assert.equal(state.categories.find((c) => c.id === 'clothes').balancePaise, P(4000));

  const envelopeTotal = state.categories.reduce((sum, c) => sum + c.balancePaise, 0);
  assert.equal(envelopeTotal, computeBankBalance(state));

  assert.throws(() => allocateMonth(state, '2026-10'), (error) => {
    assert.ok(error instanceof AppError);
    assert.equal(error.code, 'ALREADY_ALLOCATED');
    return true;
  });
});

test('undo allocation restores every envelope and unallocated cash', () => {
  const state = funded();
  const allocation = allocateMonth(state, '2026-10');
  undoAllocation(state, allocation.id);

  assert.equal(state.allocations.length, 0);
  assert.equal(computeUnallocated(state), P(100000));
  assert.ok(state.categories.every((c) => c.balancePaise === 0));
});

test('undo is blocked once spending has been recorded', () => {
  const state = funded();
  const allocation = allocateMonth(state, '2026-10');

  addTransaction(state, {
    date: '2026-10-03',
    description: 'Groceries',
    amountPaise: P(500),
    direction: 'out',
    kind: 'expense',
    categoryId: 'groceries',
  });

  assert.throws(() => undoAllocation(state, allocation.id), (error) => {
    assert.equal(error.code, 'ALLOCATION_LOCKED');
    return true;
  });
  assert.equal(state.allocations.length, 1);
});

test('undo is blocked after moving money between envelopes', () => {
  const state = funded();
  const allocation = allocateMonth(state, '2026-10');

  moveBetweenEnvelopes(state, {
    fromCategoryId: 'groceries',
    toCategoryId: 'clothes',
    amountPaise: P(1000),
  });

  assert.throws(() => undoAllocation(state, allocation.id), (error) => {
    assert.equal(error.code, 'ALLOCATION_LOCKED');
    return true;
  });
});

test('insufficient funds aborts allocation without changing anything', () => {
  const state = funded({ opening: 50000 });

  assert.throws(() => allocateMonth(state, '2026-10'), (error) => {
    assert.equal(error.code, 'INSUFFICIENT_FUNDS');
    assert.equal(error.details.shortfallPaise, P(50000));
    return true;
  });

  assert.equal(state.allocations.length, 0);
  assert.ok(state.categories.every((c) => c.balancePaise === 0));
  assert.equal(computeUnallocated(state), P(50000));
});

test('rollover envelope keeps its leftover and adds the new month target', () => {
  const state = funded();
  allocateMonth(state, '2026-10');

  addTransaction(state, {
    date: '2026-10-05',
    description: 'Shirt',
    amountPaise: P(1000),
    direction: 'out',
    kind: 'expense',
    categoryId: 'clothes',
  });
  assert.equal(state.categories.find((c) => c.id === 'clothes').balancePaise, P(3000));

  addIncome(state, 100000, '2026-11-01');
  allocateMonth(state, '2026-11');

  assert.equal(state.categories.find((c) => c.id === 'clothes').balancePaise, P(7000));
});

test('rollover envelope respects its cap', () => {
  const state = funded();
  allocateMonth(state, '2026-10');

  moveBetweenEnvelopes(state, {
    fromCategoryId: 'groceries',
    toCategoryId: 'clothes',
    amountPaise: P(1000),
  });
  assert.equal(state.categories.find((c) => c.id === 'clothes').balancePaise, P(5000));

  addIncome(state, 100000, '2026-11-01');
  allocateMonth(state, '2026-11');

  assert.equal(state.categories.find((c) => c.id === 'clothes').balancePaise, P(8000));
});

test('non-rollover envelope resets to target and sweeps the excess', () => {
  const state = funded();
  allocateMonth(state, '2026-10');

  moveBetweenEnvelopes(state, {
    fromCategoryId: 'emergency',
    toCategoryId: 'groceries',
    amountPaise: P(3000),
  });
  assert.equal(state.categories.find((c) => c.id === 'groceries').balancePaise, P(15000));

  addIncome(state, 100000, '2026-11-01');
  allocateMonth(state, '2026-11');

  assert.equal(state.categories.find((c) => c.id === 'groceries').balancePaise, P(12000));
});

test('a raise grows the flexible pool proportionally', () => {
  const state = funded({ income: 120000, opening: 120000 });
  const plan = computePlan(state);

  assert.equal(plan.flexPoolPaise, P(60000));
  assert.equal(plan.totalPaise, P(120000));

  allocateMonth(state, '2026-10');
  assert.equal(computeUnallocated(state), 0);
  assert.equal(state.categories.find((c) => c.id === 'groceries').balancePaise, P(18000));
  assert.equal(state.categories.find((c) => c.id === 'emergency').balancePaise, P(13000));
});

test('money beyond a fully fixed plan is swept to the surplus envelope', () => {
  const state = funded({ income: 120000, opening: 120000 });
  const flexTargets = {
    groceries: P(12000),
    transport: P(4000),
    clothes: P(4000),
    electronics: P(5000),
    fun: P(7000),
    misc: P(8000),
  };
  for (const category of state.categories) {
    if (category.kind === 'flex') {
      category.kind = 'fixed';
      category.percent = 0;
      category.targetPaise = flexTargets[category.id];
    }
  }

  allocateMonth(state, '2026-10');

  assert.equal(computeUnallocated(state), 0);
  assert.equal(state.categories.find((c) => c.id === 'emergency').balancePaise, P(33000));
});

test('expense, refund, update and delete keep the ledger consistent', () => {
  const state = funded();
  allocateMonth(state, '2026-10');

  const expense = addTransaction(state, {
    date: '2026-10-04',
    description: 'Rent paid',
    amountPaise: P(20000),
    direction: 'out',
    kind: 'expense',
    categoryId: 'rent',
  });
  assert.equal(state.categories.find((c) => c.id === 'rent').balancePaise, 0);
  assert.equal(computeBankBalance(state), P(80000));

  addTransaction(state, {
    date: '2026-10-06',
    description: 'Rent refund',
    amountPaise: P(2000),
    direction: 'in',
    kind: 'expense',
    categoryId: 'rent',
  });
  assert.equal(state.categories.find((c) => c.id === 'rent').balancePaise, P(2000));

  updateTransaction(state, expense.id, {
    amountPaise: P(18000),
  });
  assert.equal(state.categories.find((c) => c.id === 'rent').balancePaise, P(4000));

  deleteTransaction(state, expense.id);
  assert.equal(state.categories.find((c) => c.id === 'rent').balancePaise, P(22000));

  const envelopes = state.categories.reduce((sum, c) => sum + c.balancePaise, 0);
  assert.equal(envelopes + computeUnallocated(state), computeBankBalance(state));
});

test('reconciliation records an adjustment and matches the real balance', () => {
  const state = funded();
  allocateMonth(state, '2026-10');

  const adjustment = reconcileBalance(state, P(100500));
  assert.ok(adjustment);
  assert.equal(computeBankBalance(state), P(100500));
  assert.equal(computeUnallocated(state), P(500));

  assert.equal(reconcileBalance(state, P(100500)), null);
});

test('moving money between envelopes cannot overdraw the source', () => {
  const state = funded();
  allocateMonth(state, '2026-10');

  moveBetweenEnvelopes(state, {
    fromCategoryId: 'groceries',
    toCategoryId: 'clothes',
    amountPaise: P(2000),
  });
  assert.equal(state.categories.find((c) => c.id === 'groceries').balancePaise, P(10000));
  assert.equal(state.categories.find((c) => c.id === 'clothes').balancePaise, P(6000));

  assert.throws(
    () =>
      moveBetweenEnvelopes(state, {
        fromCategoryId: 'groceries',
        toCategoryId: 'clothes',
        amountPaise: P(11000),
      }),
    (error) => error.code === 'INSUFFICIENT_ENVELOPE'
  );
});

test('plan rejects percentages that do not add up to 100', () => {
  const state = funded();
  const payload = {
    monthlyIncomePaise: P(100000),
    paydayDay: 1,
    surplusCategoryId: 'emergency',
    categories: state.categories.map((c) => ({ ...c })),
  };
  payload.categories.find((c) => c.id === 'groceries').percent = 25;

  assert.throws(() => savePlan(state, payload), (error) => error.code === 'FLEX_PERCENT');
});

test('plan cannot remove an envelope that still holds money', () => {
  const state = funded();
  allocateMonth(state, '2026-10');

  const payload = {
    monthlyIncomePaise: P(100000),
    paydayDay: 1,
    surplusCategoryId: 'emergency',
    categories: state.categories
      .filter((c) => !c.archived && c.id !== 'rent')
      .map((c) => ({ ...c })),
  };

  assert.throws(() => savePlan(state, payload), (error) => error.code === 'CATEGORY_HAS_BALANCE');
});

test('plan adds a new envelope and archives an empty one', () => {
  const state = funded();
  const before = state.categories.length;

  const payload = {
    monthlyIncomePaise: P(100000),
    paydayDay: 5,
    surplusCategoryId: 'emergency',
    categories: state.categories
      .filter((c) => !c.archived && c.id !== 'misc')
      .map((c) => ({ ...c }))
      .concat([
        {
          kind: 'flex',
          name: 'Gadgets',
          percent: 8,
          rollover: true,
          capPaise: P(8000),
          icon: '🎧',
          color: '#123456',
        },
      ]),
  };
  // Misc was 20%; give its 20% to the new envelope plus 12% elsewhere.
  payload.categories.find((c) => c.id === 'groceries').percent = 42;

  const result = savePlan(state, payload);
  assert.equal(result.flexPercentTotal, 100);
  assert.equal(state.categories.length, before + 1);
  assert.equal(state.categories.find((c) => c.id === 'misc').archived, true);
  assert.ok(state.categories.find((c) => c.name === 'Gadgets'));
  assert.equal(state.settings.paydayDay, 5);
});

test('low income scales the seeded fixed commitments', () => {
  const state = createState({ monthlyIncomePaise: P(50000), onboarded: false });
  const changed = fitDefaultsToIncome(state);
  assert.equal(changed, true);

  const fixed = state.categories
    .filter((c) => c.kind === 'fixed')
    .reduce((sum, c) => sum + c.targetPaise, 0);
  assert.ok(fixed <= P(30000));
  assert.ok(fixed > 0);
});

test('categories have display types for bills, savings, investments, loans and spending', () => {
  const state = funded();
  const typeOf = (id) => state.categories.find((category) => category.id === id).type;
  assert.equal(typeOf('rent'), 'bill');
  assert.equal(typeOf('loan'), 'loan');
  assert.equal(typeOf('invest'), 'investment');
  assert.equal(typeOf('emergency'), 'saving');
  assert.equal(typeOf('groceries'), 'spending');
});

test('a type only accepts the right movement', () => {
  const state = funded();
  allocateMonth(state, '2026-10');

  assert.throws(
    () =>
      addTransaction(state, {
        date: '2026-10-05',
        description: 'Trying to spend from an investment',
        amountPaise: P(100),
        direction: 'out',
        kind: 'expense',
        categoryId: 'invest',
      }),
    (error) => error.code === 'TYPE_MISMATCH'
  );

  assert.throws(
    () =>
      addTransaction(state, {
        date: '2026-10-05',
        description: 'Trying to transfer to groceries',
        amountPaise: P(100),
        direction: 'out',
        kind: 'transfer',
        categoryId: 'groceries',
      }),
    (error) => error.code === 'TYPE_MISMATCH'
  );

  const payment = addTransaction(state, {
    date: '2026-10-05',
    description: 'Loan payment',
    amountPaise: P(12000),
    direction: 'out',
    kind: 'transfer',
    categoryId: 'loan',
  });
  assert.equal(payment.kind, 'transfer');
  assert.equal(state.categories.find((category) => category.id === 'loan').balancePaise, 0);
});

test('multiple investments can coexist with their own amounts', () => {
  const state = funded();
  const payload = {
    monthlyIncomePaise: P(100000),
    paydayDay: 1,
    surplusCategoryId: 'emergency',
    categories: state.categories.map((category) => ({ ...category })).concat([
      {
        kind: 'fixed',
        type: 'investment',
        name: 'PPF',
        targetPaise: P(5000),
        percent: 0,
        rollover: true,
        capPaise: null,
        icon: '🏦',
        color: '#123456',
      },
    ]),
  };

  const result = savePlan(state, payload);
  const investments = state.categories.filter(
    (category) => !category.archived && category.type === 'investment'
  );
  assert.equal(investments.length, 2);
  assert.equal(result.incomePaise, P(100000));
  assert.equal(
    investments.reduce((sum, category) => sum + category.targetPaise, 0),
    P(20000)
  );
});

test('demo state is internally consistent', () => {
  const state = createDemoState();
  const envelopes = state.categories.reduce((sum, c) => sum + c.balancePaise, 0);
  assert.equal(envelopes + computeUnallocated(state), computeBankBalance(state));
  assert.equal(state.allocations.length, 1);
  assert.equal(computeUnallocated(state), 0);

  const view = clientState(state);
  assert.equal(view.derived.setupRequired, false);
  assert.ok(view.derived.summary.spentPaise >= 0);
  assert.ok(view.derived.plan.totalPaise <= view.derived.plan.incomePaise);
});
