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
  guessCategoryId,
  investmentSummaries,
  monthlyCommitments,
  moveBetweenEnvelopes,
  reconcileBalance,
  saveBucketType,
  deleteBucketType,
  savePlan,
  undoAllocation,
  updateInvestmentValue,
  updateInvestmentHistory,
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
  allocateMonth(state, '2026-09');

  addTransaction(state, {
    date: '2026-09-05',
    description: 'Shirt',
    amountPaise: P(1000),
    direction: 'out',
    kind: 'expense',
    categoryId: 'clothes',
  });
  assert.equal(state.categories.find((c) => c.id === 'clothes').balancePaise, P(3000));

  addIncome(state, 100000, '2026-10-01');
  allocateMonth(state, '2026-10');

  assert.equal(state.categories.find((c) => c.id === 'clothes').balancePaise, P(7000));
});

test('spending overspend reduces the next month available amount', () => {
  const state = funded();
  allocateMonth(state, '2026-09');

  addTransaction(state, {
    date: '2026-09-05',
    description: 'Big clothes purchase',
    amountPaise: P(5000),
    direction: 'out',
    kind: 'expense',
    categoryId: 'clothes',
  });
  assert.equal(state.categories.find((c) => c.id === 'clothes').balancePaise, P(-1000));

  addIncome(state, 100000, '2026-10-01');
  const allocation = allocateMonth(state, '2026-10');
  const clothes = allocation.items.find((item) => item.categoryId === 'clothes');

  assert.equal(clothes.carryPaise, P(-1000));
  assert.equal(clothes.targetPaise, P(4000));
  assert.equal(clothes.availablePaise, P(3000));
  assert.equal(state.categories.find((c) => c.id === 'clothes').balancePaise, P(3000));
});

test('non-rollover spending buckets also carry an overspend', () => {
  const state = funded();
  allocateMonth(state, '2026-09');

  addTransaction(state, {
    date: '2026-09-05',
    description: 'Big grocery run',
    amountPaise: P(13000),
    direction: 'out',
    kind: 'expense',
    categoryId: 'groceries',
  });
  assert.equal(state.categories.find((c) => c.id === 'groceries').balancePaise, P(-1000));

  addIncome(state, 100000, '2026-10-01');
  const allocation = allocateMonth(state, '2026-10');
  const groceries = allocation.items.find((item) => item.categoryId === 'groceries');

  assert.equal(groceries.carryPaise, P(-1000));
  assert.equal(groceries.availablePaise, P(11000));
  assert.equal(state.categories.find((c) => c.id === 'groceries').balancePaise, P(11000));
});

test('fixed bills and loans refill to their full target, not less', () => {
  const state = funded();
  allocateMonth(state, '2026-09');

  addTransaction(state, {
    date: '2026-09-05',
    description: 'Rent plus late fee',
    amountPaise: P(21000),
    direction: 'out',
    kind: 'expense',
    categoryId: 'rent',
  });
  assert.equal(state.categories.find((c) => c.id === 'rent').balancePaise, P(-1000));

  addIncome(state, 100000, '2026-10-01');
  const allocation = allocateMonth(state, '2026-10');
  const rent = allocation.items.find((item) => item.categoryId === 'rent');

  assert.equal(rent.carryPaise, 0);
  assert.equal(rent.availablePaise, P(20000));
  assert.equal(state.categories.find((c) => c.id === 'rent').balancePaise, P(20000));
});

test('rollover envelope respects its cap', () => {
  const state = funded();
  allocateMonth(state, '2026-09');

  moveBetweenEnvelopes(state, {
    period: '2026-09',
    fromCategoryId: 'groceries',
    toCategoryId: 'clothes',
    amountPaise: P(1000),
  });
  assert.equal(state.categories.find((c) => c.id === 'clothes').balancePaise, P(5000));

  addIncome(state, 100000, '2026-10-01');
  allocateMonth(state, '2026-10');

  assert.equal(state.categories.find((c) => c.id === 'clothes').balancePaise, P(8000));
});

test('non-rollover envelope resets to target and sweeps the excess', () => {
  const state = funded();
  allocateMonth(state, '2026-09');

  moveBetweenEnvelopes(state, {
    period: '2026-09',
    fromCategoryId: 'emergency',
    toCategoryId: 'groceries',
    amountPaise: P(3000),
  });
  assert.equal(state.categories.find((c) => c.id === 'groceries').balancePaise, P(15000));

  addIncome(state, 100000, '2026-10-01');
  allocateMonth(state, '2026-10');

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

test('a fixed rollover bucket cannot have a Max below its monthly amount', () => {
  const state = funded();
  const payload = {
    monthlyIncomePaise: P(100000),
    paydayDay: 1,
    surplusCategoryId: 'emergency',
    categories: state.categories.map((category) => ({ ...category })),
  };
  const invest = payload.categories.find((category) => category.id === 'invest');
  invest.capPaise = P(1000);

  assert.throws(() => savePlan(state, payload), (error) => error.code === 'INVALID_CAP');
});

test('money can be moved from Not divided into a bucket and back', () => {
  const state = funded();
  allocateMonth(state, '2026-10');
  assert.equal(computeUnallocated(state), 0);

  addIncome(state, 5000, new Date().toLocaleDateString('en-CA'));
  assert.equal(computeUnallocated(state), P(5000));

  moveBetweenEnvelopes(state, {
    fromCategoryId: null,
    toCategoryId: 'clothes',
    amountPaise: P(2000),
  });
  assert.equal(computeUnallocated(state), P(3000));
  assert.equal(state.categories.find((category) => category.id === 'clothes').balancePaise, P(6000));

  moveBetweenEnvelopes(state, {
    fromCategoryId: 'clothes',
    toCategoryId: null,
    amountPaise: P(500),
  });
  assert.equal(computeUnallocated(state), P(3500));
  assert.equal(state.categories.find((category) => category.id === 'clothes').balancePaise, P(5500));
});

test('moving more than Not divided offers is rejected', () => {
  const state = funded();
  assert.throws(
    () =>
      moveBetweenEnvelopes(state, {
        fromCategoryId: null,
        toCategoryId: 'groceries',
        amountPaise: P(100001),
      }),
    (error) => error.code === 'INSUFFICIENT_UNALLOCATED'
  );
});

test('future-dated transactions are rejected', () => {
  const state = funded();
  assert.throws(
    () =>
      addTransaction(state, {
        date: '2099-01-01',
        description: 'Future salary',
        amountPaise: P(1000),
        direction: 'in',
        kind: 'income',
      }),
    (error) => error.code === 'INVALID_DATE'
  );
});

test('auto-categorisation falls back to a renamed investment bucket', () => {
  const state = funded();
  const payload = {
    monthlyIncomePaise: P(100000),
    paydayDay: 1,
    surplusCategoryId: 'emergency',
    categories: state.categories
      .filter((category) => category.id !== 'invest')
      .map((category) => ({ ...category }))
      .concat([
        {
          kind: 'fixed',
          type: 'investment',
          name: 'PPF',
          targetPaise: P(15000),
          percent: 0,
          rollover: true,
          capPaise: null,
          icon: '🏦',
          color: '#123456',
        },
      ]),
  };
  savePlan(state, payload);
  const ppf = state.categories.find((category) => category.name === 'PPF');
  assert.equal(guessCategoryId(state, 'Mutual fund SIP', 'out'), ppf.id);
});

test('surplus cannot be sent to a bill or spending bucket', () => {
  const state = funded();
  const payload = {
    monthlyIncomePaise: P(100000),
    paydayDay: 1,
    surplusCategoryId: 'groceries',
    categories: state.categories.map((category) => ({ ...category })),
  };
  savePlan(state, payload);
  assert.equal(state.settings.surplusCategoryId, 'emergency');
});

test('impossible calendar dates are rejected', () => {
  const state = funded();
  assert.throws(
    () =>
      addTransaction(state, {
        date: '2026-02-31',
        description: 'Impossible date',
        amountPaise: P(100),
        direction: 'out',
        kind: 'expense',
        categoryId: 'groceries',
      }),
    (error) => error.code === 'INVALID_DATE'
  );
});

test('monthly ticks use this month activity, not bucket balances', () => {
  const state = funded();
  allocateMonth(state, '2026-10');

  let status = new Map(
    monthlyCommitments(state, '2026-10').map((item) => [item.categoryId, item])
  );
  assert.equal(status.get('rent').status, 'due');
  assert.equal(status.get('loan').status, 'due');
  assert.equal(status.get('invest').status, 'due');
  assert.equal(status.get('emergency').status, 'done');
  assert.equal(status.has('groceries'), false);

  addTransaction(state, {
    date: '2026-10-05',
    description: 'Rent paid',
    amountPaise: P(20000),
    direction: 'out',
    kind: 'expense',
    categoryId: 'rent',
  });
  const investPayment = addTransaction(state, {
    date: '2026-10-06',
    description: 'SIP',
    amountPaise: P(15000),
    direction: 'out',
    kind: 'transfer',
    categoryId: 'invest',
  });
  addTransaction(state, {
    date: '2026-10-07',
    description: 'EMI',
    amountPaise: P(12000),
    direction: 'out',
    kind: 'transfer',
    categoryId: 'loan',
  });

  status = new Map(monthlyCommitments(state, '2026-10').map((item) => [item.categoryId, item]));
  assert.equal(status.get('rent').status, 'done');
  assert.equal(status.get('invest').status, 'done');
  assert.equal(status.get('loan').status, 'done');
  assert.equal(state.categories.find((category) => category.id === 'invest').balancePaise, 0);

  addTransaction(state, {
    date: '2026-10-08',
    description: 'Rent refund',
    amountPaise: P(5000),
    direction: 'in',
    kind: 'expense',
    categoryId: 'rent',
  });
  status = new Map(monthlyCommitments(state, '2026-10').map((item) => [item.categoryId, item]));
  assert.equal(status.get('rent').status, 'partial');
  assert.equal(status.get('rent').paidPaise, P(15000));

  deleteTransaction(state, investPayment.id);
  status = new Map(monthlyCommitments(state, '2026-10').map((item) => [item.categoryId, item]));
  assert.equal(status.get('invest').status, 'due');
});

test('a later month does not tick the current month', () => {
  const state = funded();
  allocateMonth(state, '2026-10');
  addTransaction(state, {
    date: '2026-10-05',
    description: 'October rent',
    amountPaise: P(20000),
    direction: 'out',
    kind: 'expense',
    categoryId: 'rent',
  });
  const before = new Map(
    monthlyCommitments(state, '2026-10').map((item) => [item.categoryId, item])
  );
  assert.equal(before.get('rent').status, 'done');
  const next = new Map(
    monthlyCommitments(state, '2026-11').map((item) => [item.categoryId, item])
  );
  assert.equal(next.get('rent').status, 'due');
});

test('savings funded by the division tick, new buckets after division do not', () => {
  const state = funded();
  allocateMonth(state, '2026-10');

  let status = new Map(
    monthlyCommitments(state, '2026-10').map((item) => [item.categoryId, item])
  );
  assert.equal(status.get('emergency').status, 'done');
  assert.equal(status.get('emergency').fundedByDivision, true);

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
  savePlan(state, payload);
  const ppf = state.categories.find((category) => category.name === 'PPF');

  status = new Map(monthlyCommitments(state, '2026-10').map((item) => [item.categoryId, item]));
  assert.equal(status.get(ppf.id).status, 'not-in-division');
  assert.equal(status.get(ppf.id).inDivision, false);

  addTransaction(state, {
    date: '2026-10-10',
    description: 'PPF investment',
    amountPaise: P(5000),
    direction: 'out',
    kind: 'transfer',
    categoryId: ppf.id,
  });
  status = new Map(monthlyCommitments(state, '2026-10').map((item) => [item.categoryId, item]));
  assert.equal(status.get(ppf.id).status, 'done');
});

test('monthly ticks handle overpayment and refunded buckets', () => {
  const state = funded();
  allocateMonth(state, '2026-10');

  addTransaction(state, {
    date: '2026-10-05',
    description: 'Rent overpayment',
    amountPaise: P(25000),
    direction: 'out',
    kind: 'expense',
    categoryId: 'rent',
  });
  let status = new Map(
    monthlyCommitments(state, '2026-10').map((item) => [item.categoryId, item])
  );
  assert.equal(status.get('rent').status, 'done');
  assert.equal(status.get('rent').extraPaise, P(5000));

  addTransaction(state, {
    date: '2026-10-06',
    description: 'Large rent refund',
    amountPaise: P(30000),
    direction: 'in',
    kind: 'expense',
    categoryId: 'rent',
  });
  status = new Map(monthlyCommitments(state, '2026-10').map((item) => [item.categoryId, item]));
  assert.equal(status.get('rent').status, 'refunded');
  assert.equal(status.get('rent').paidPaise, P(-5000));
});

test('an investment withdrawal does not undo the month investment tick', () => {
  const state = funded();
  allocateMonth(state, '2026-10');

  addTransaction(state, {
    date: '2026-10-05',
    description: 'SIP',
    amountPaise: P(15000),
    direction: 'out',
    kind: 'transfer',
    categoryId: 'invest',
  });
  addTransaction(state, {
    date: '2026-10-06',
    description: 'Redemption',
    amountPaise: P(20000),
    direction: 'in',
    kind: 'transfer',
    categoryId: 'invest',
  });

  let status = new Map(
    monthlyCommitments(state, '2026-10').map((item) => [item.categoryId, item])
  );
  assert.equal(status.get('invest').status, 'done');
  assert.equal(status.get('invest').paidPaise, P(15000));

  const withdrawalOnly = funded();
  allocateMonth(withdrawalOnly, '2026-10');
  addTransaction(withdrawalOnly, {
    date: '2026-10-07',
    description: 'Redemption only',
    amountPaise: P(22000),
    direction: 'in',
    kind: 'transfer',
    categoryId: 'invest',
  });
  status = new Map(
    monthlyCommitments(withdrawalOnly, '2026-10').map((item) => [item.categoryId, item])
  );
  assert.equal(status.get('invest').status, 'due');
  assert.equal(status.get('invest').paidPaise, 0);
});

test('investment summary tracks put in, took out, worth and gain', () => {
  const state = funded();
  updateInvestmentHistory(state, 'invest', 0);
  addTransaction(state, {
    date: '2026-10-01',
    description: 'First SIP',
    amountPaise: P(12000),
    direction: 'out',
    kind: 'transfer',
    categoryId: 'invest',
  });
  addTransaction(state, {
    date: '2026-10-02',
    description: 'Second SIP',
    amountPaise: P(8000),
    direction: 'out',
    kind: 'transfer',
    categoryId: 'invest',
  });
  addTransaction(state, {
    date: '2026-10-03',
    description: 'Redemption',
    amountPaise: P(22000),
    direction: 'in',
    kind: 'transfer',
    categoryId: 'invest',
  });

  let investment = investmentSummaries(state).find((item) => item.categoryId === 'invest');
  assert.equal(investment.putInPaise, P(20000));
  assert.equal(investment.tookOutPaise, P(22000));
  assert.equal(investment.worthPaise, null);
  assert.equal(investment.hasCostBasis, true);
  assert.equal(investment.gainPaise, null);

  updateInvestmentValue(state, 'invest', 0);
  investment = investmentSummaries(state).find((item) => item.categoryId === 'invest');
  assert.equal(investment.worthPaise, 0);
  assert.equal(investment.gainPaise, P(2000));

  updateInvestmentValue(state, 'invest', P(22000));
  investment = investmentSummaries(state).find((item) => item.categoryId === 'invest');
  assert.equal(investment.gainPaise, P(24000));

  assert.throws(
    () => updateInvestmentValue(state, 'rent', 0),
    (error) => error.code === 'INVALID_TYPE'
  );

  const view = clientState(state, '2026-10');
  assert.equal(view.derived.investments[0].gainPaise, P(24000));
});

test('investment gain is not guessed without a recorded contribution', () => {
  const state = funded();
  updateInvestmentValue(state, 'invest', P(16000));

  let investment = investmentSummaries(state).find((item) => item.categoryId === 'invest');
  assert.equal(investment.putInPaise, 0);
  assert.equal(investment.worthPaise, P(16000));
  assert.equal(investment.hasCostBasis, false);
  assert.equal(investment.gainPaise, null);

  addTransaction(state, {
    date: '2026-10-03',
    description: 'Old investment withdrawal',
    amountPaise: P(22000),
    direction: 'in',
    kind: 'transfer',
    categoryId: 'invest',
  });
  investment = investmentSummaries(state).find((item) => item.categoryId === 'invest');
  assert.equal(investment.tookOutPaise, P(22000));
  assert.equal(investment.gainPaise, null);
  assert.equal(investment.worthStale, true);

  updateInvestmentValue(state, 'invest', null);
  investment = investmentSummaries(state).find((item) => item.categoryId === 'invest');
  assert.equal(investment.worthPaise, null);
  assert.equal(investment.gainPaise, null);
  assert.equal(investment.worthStale, false);
});

test('investment gain hides after a movement until worth is updated', () => {
  const state = funded();
  updateInvestmentHistory(state, 'invest', 0);
  addTransaction(state, {
    date: '2026-10-01',
    description: 'SIP',
    amountPaise: P(20000),
    direction: 'out',
    kind: 'transfer',
    categoryId: 'invest',
  });
  updateInvestmentValue(state, 'invest', P(22000));

  let investment = investmentSummaries(state).find((item) => item.categoryId === 'invest');
  assert.equal(investment.worthStale, false);
  assert.equal(investment.gainPaise, P(2000));

  addTransaction(state, {
    date: '2026-10-02',
    description: 'Partial withdrawal',
    amountPaise: P(5000),
    direction: 'in',
    kind: 'transfer',
    categoryId: 'invest',
  });
  investment = investmentSummaries(state).find((item) => item.categoryId === 'invest');
  assert.equal(investment.worthStale, true);
  assert.equal(investment.gainPaise, null);

  updateInvestmentValue(state, 'invest', P(17000));
  investment = investmentSummaries(state).find((item) => item.categoryId === 'invest');
  assert.equal(investment.worthStale, false);
  assert.equal(investment.gainPaise, P(2000));
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
  const demoInvestment = view.derived.investments.find((item) => item.categoryId === 'invest');
  assert.equal(demoInvestment.worthStale, false);
  assert.equal(demoInvestment.gainPaise, P(1000));
});

test('bucket types can be added, configured with rules, hold multiple buckets, and be removed', () => {
  const state = funded();
  assert.equal(state.bucketTypes.length, 5);

  const customBt = saveBucketType(state, {
    name: 'Long-Term Portfolios',
    description: 'Retirement and gold holdings',
    behavior: 'investment',
    defaultRollover: true,
    defaultCapPaise: P(50000),
    priority: 4,
    allowSurplus: true,
    icon: '🪙',
    color: '#a8842f',
  });
  assert.ok(customBt.id.startsWith('bt_'));
  assert.equal(state.bucketTypes.length, 6);

  const payload = {
    monthlyIncomePaise: P(100000),
    paydayDay: 1,
    surplusCategoryId: 'emergency',
    categories: state.categories.map((c) => ({ ...c })).concat([
      {
        kind: 'fixed',
        type: 'investment',
        bucketTypeId: customBt.id,
        name: 'Gold ETF',
        targetPaise: P(5000),
        percent: 0,
        rollover: customBt.defaultRollover,
        capPaise: customBt.defaultCapPaise,
        icon: '🪙',
        color: '#a8842f',
      },
      {
        kind: 'fixed',
        type: 'investment',
        bucketTypeId: 'investment',
        name: 'PPF Account',
        targetPaise: P(5000),
        percent: 0,
        rollover: true,
        capPaise: null,
        icon: '🏦',
        color: '#23735f',
      },
    ]),
  };
  savePlan(state, payload);

  const view = clientState(state);
  assert.equal(view.derived.investments.length, 3);
  const gold = view.categories.find((c) => c.name === 'Gold ETF');
  assert.equal(gold.bucketTypeId, customBt.id);
  assert.equal(gold.capPaise, P(50000));

  saveBucketType(state, {
    id: customBt.id,
    name: 'Long-Term Portfolios',
    behavior: 'investment',
    defaultRollover: false,
    defaultCapPaise: P(60000),
    applyToExisting: true,
  });
  assert.equal(state.categories.find((c) => c.name === 'Gold ETF').rollover, false);
  assert.equal(state.categories.find((c) => c.name === 'Gold ETF').capPaise, P(60000));

  deleteBucketType(state, customBt.id);
  assert.equal(state.bucketTypes.some((bt) => bt.id === customBt.id), false);
  assert.equal(state.categories.find((c) => c.name === 'Gold ETF').archived, true);
});
