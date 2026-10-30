import { randomUUID } from 'node:crypto';
import {
  addTransaction,
  allocateMonth,
  dateInMonth,
  isoNow,
  periodOf,
  todayString,
  updateInvestmentValue,
  updateInvestmentHistory,
} from './domain.js';

export function defaultBucketTypes() {
  return [
    {
      id: 'bill',
      name: 'Bills & Utilities',
      description: 'Rent, electricity, broadband, and fixed monthly bills.',
      kind: 'fixed',
      behavior: 'bill',
      defaultRollover: false,
      defaultCapPaise: null,
      defaultDueDay: null,
      allowSurplus: false,
      priority: 1,
      icon: '🏠',
      color: '#b4643c',
      sortOrder: 0,
    },
    {
      id: 'loan',
      name: 'Loans & EMIs',
      description: 'EMIs and fixed monthly repayments to lenders.',
      kind: 'fixed',
      behavior: 'loan',
      defaultRollover: false,
      defaultCapPaise: null,
      defaultDueDay: null,
      allowSurplus: true,
      priority: 1,
      icon: '🏦',
      color: '#7d6a9e',
      sortOrder: 1,
    },
    {
      id: 'saving',
      name: 'Savings Goals',
      description: 'Emergency fund and cash reserves kept in your bank.',
      kind: 'fixed',
      behavior: 'saving',
      defaultRollover: true,
      defaultCapPaise: null,
      defaultDueDay: null,
      allowSurplus: true,
      priority: 3,
      icon: '🛡️',
      color: '#3f6b8e',
      sortOrder: 2,
    },
    {
      id: 'investment',
      name: 'Investments',
      description: 'SIPs, PPF, stocks, gold, and holdings tracked separately from bank cash.',
      kind: 'fixed',
      behavior: 'investment',
      defaultRollover: true,
      defaultCapPaise: null,
      defaultDueDay: null,
      allowSurplus: true,
      priority: 4,
      icon: '📈',
      color: '#23735f',
      sortOrder: 3,
    },
    {
      id: 'spending',
      name: 'Everyday Spending',
      description: 'What is left after fixed commitments, split by percentage.',
      kind: 'flex',
      behavior: 'spending',
      defaultRollover: false,
      defaultCapPaise: null,
      defaultDueDay: null,
      allowSurplus: false,
      priority: 2,
      icon: '🛒',
      color: '#6c8a45',
      sortOrder: 4,
    },
  ];
}

export function defaultCategories() {
  return [
    {
      id: 'rent',
      name: 'Rent',
      kind: 'fixed',
      type: 'bill',
      targetPaise: 2000000,
      percent: 0,
      rollover: false,
      capPaise: null,
      icon: '🏠',
      color: '#b4643c',
      balancePaise: 0,
      archived: false,
      sortOrder: 0,
    },
    {
      id: 'loan',
      name: 'Loan EMI',
      kind: 'fixed',
      type: 'loan',
      targetPaise: 1200000,
      percent: 0,
      rollover: false,
      capPaise: null,
      icon: '🏦',
      color: '#7d6a9e',
      balancePaise: 0,
      archived: false,
      sortOrder: 1,
    },
    {
      id: 'invest',
      name: 'Invest',
      kind: 'fixed',
      type: 'investment',
      historyComplete: false,
      currentValuePaise: null,
      targetPaise: 1500000,
      percent: 0,
      rollover: true,
      capPaise: 3000000,
      icon: '📈',
      color: '#23735f',
      balancePaise: 0,
      archived: false,
      sortOrder: 2,
    },
    {
      id: 'emergency',
      name: 'Emergency',
      kind: 'fixed',
      type: 'saving',
      targetPaise: 1300000,
      percent: 0,
      rollover: true,
      capPaise: null,
      icon: '🛡️',
      color: '#3f6b8e',
      balancePaise: 0,
      archived: false,
      sortOrder: 3,
    },
    {
      id: 'groceries',
      name: 'Groceries',
      kind: 'flex',
      type: 'spending',
      targetPaise: 0,
      percent: 30,
      rollover: false,
      capPaise: null,
      icon: '🛒',
      color: '#6c8a45',
      balancePaise: 0,
      archived: false,
      sortOrder: 4,
    },
    {
      id: 'transport',
      name: 'Transport',
      kind: 'flex',
      type: 'spending',
      targetPaise: 0,
      percent: 10,
      rollover: false,
      capPaise: null,
      icon: '🚌',
      color: '#a8842f',
      balancePaise: 0,
      archived: false,
      sortOrder: 5,
    },
    {
      id: 'clothes',
      name: 'Clothes',
      kind: 'flex',
      type: 'spending',
      targetPaise: 0,
      percent: 10,
      rollover: true,
      capPaise: 800000,
      icon: '👕',
      color: '#b05f70',
      balancePaise: 0,
      archived: false,
      sortOrder: 6,
    },
    {
      id: 'electronics',
      name: 'Electronics',
      kind: 'flex',
      type: 'spending',
      targetPaise: 0,
      percent: 12.5,
      rollover: true,
      capPaise: 1000000,
      icon: '💻',
      color: '#567797',
      balancePaise: 0,
      archived: false,
      sortOrder: 7,
    },
    {
      id: 'fun',
      name: 'Fun',
      kind: 'flex',
      type: 'spending',
      targetPaise: 0,
      percent: 17.5,
      rollover: false,
      capPaise: null,
      icon: '🎬',
      color: '#c27642',
      balancePaise: 0,
      archived: false,
      sortOrder: 8,
    },
    {
      id: 'misc',
      name: 'Misc',
      kind: 'flex',
      type: 'spending',
      targetPaise: 0,
      percent: 20,
      rollover: false,
      capPaise: null,
      icon: '🧾',
      color: '#8a8376',
      balancePaise: 0,
      archived: false,
      sortOrder: 9,
    },
  ];
}

export function createState({
  monthlyIncomePaise = 10000000,
  openingBalancePaise = 0,
  onboarded = false,
} = {}) {
  return {
    version: 1,
    settings: {
      currency: 'INR',
      monthlyIncomePaise,
      paydayDay: 1,
      openingBalancePaise,
      surplusCategoryId: 'emergency',
      ingestToken: randomUUID().replace(/-/g, ''),
      onboarded,
      planConfirmed: onboarded,
      createdAt: isoNow(),
    },
    bucketTypes: defaultBucketTypes(),
    categories: defaultCategories(),
    transactions: [],
    allocations: [],
    moves: [],
  };
}

/**
 * If the person's salary is below the seeded ₹1L template, shrink the fixed
 * commitments so the starting plan is still workable. The percentages adapt by
 * themselves because they split whatever remains after fixed commitments.
 */
export function fitDefaultsToIncome(state) {
  const fixed = state.categories.filter((c) => c.kind === 'fixed');
  const fixedTotal = fixed.reduce((sum, c) => sum + c.targetPaise, 0);
  const income = state.settings.monthlyIncomePaise;
  if (fixedTotal <= income) return false;

  const targetFixed = Math.floor(income * 0.6);
  const scale = targetFixed / fixedTotal;
  for (const category of fixed) {
    category.targetPaise = Math.max(0, Math.round(category.targetPaise * scale));
  }

  let total = fixed.reduce((sum, c) => sum + c.targetPaise, 0);
  if (total > targetFixed) {
    const largest = [...fixed].sort((a, b) => b.targetPaise - a.targetPaise)[0];
    largest.targetPaise -= total - targetFixed;
  }
  return true;
}

const DEMO_EXPENSES = [
  { day: 2, description: 'Rent — landlord', amountPaise: 2000000, kind: 'expense', categoryId: 'rent' },
  { day: 3, description: 'Mutual fund SIP', amountPaise: 1500000, kind: 'transfer', categoryId: 'invest' },
  { day: 5, description: 'BigBasket', amountPaise: 324000, kind: 'expense', categoryId: 'groceries' },
  { day: 7, description: 'Swiggy', amountPaise: 48600, kind: 'expense', categoryId: 'fun' },
  { day: 9, description: 'Myntra', amountPaise: 179900, kind: 'expense', categoryId: 'clothes' },
  { day: 12, description: 'Petrol', amountPaise: 120000, kind: 'expense', categoryId: 'transport' },
  { day: 15, description: 'Electricity bill', amountPaise: 185000, kind: 'expense', categoryId: 'misc' },
  { day: 18, description: 'Netflix', amountPaise: 64900, kind: 'expense', categoryId: 'fun' },
  { day: 21, description: 'Pharmacy', amountPaise: 74000, kind: 'expense', categoryId: 'misc' },
  { day: 24, description: 'Uber', amountPaise: 32000, kind: 'expense', categoryId: 'transport' },
  { day: 27, description: 'Amazon', amountPaise: 249900, kind: 'expense', categoryId: 'electronics' },
];

export function createDemoState() {
  const state = createState({
    monthlyIncomePaise: 10000000,
    openingBalancePaise: 0,
    onboarded: true,
  });
  const invest = state.categories.find((category) => category.id === 'invest');
  if (invest) invest.currentValuePaise = 1600000;
  const period = periodOf();
  const today = Number(todayString().slice(8, 10));

  addTransaction(state, {
    date: dateInMonth(period, 1),
    description: 'Salary — Acme Corp',
    amountPaise: 10000000,
    direction: 'in',
    kind: 'income',
    source: 'demo',
  });

  allocateMonth(state, period);

  for (const expense of DEMO_EXPENSES) {
    if (expense.day > today) continue;
    addTransaction(state, {
      ...expense,
      date: dateInMonth(period, expense.day),
      direction: 'out',
      source: 'demo',
    });
  }

  if (invest) {
    updateInvestmentHistory(state, 'invest', 0);
    updateInvestmentValue(state, 'invest', 1600000);
  }
  return state;
}
