const RECEIPT_REQUIRED_FROM = 25;
const FINANCE_REVIEW_FROM = 500;
const MAX_EXPENSE_AMOUNT = 10000;
const VAT_RATES = new Set([0, 6, 12, 21]);

function apiError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function hasPermission(actor, permission) {
  return actor.permissions?.includes("*") || actor.permissions?.includes(permission);
}

function hasReceipt(expense) {
  return !!(expense.receiptFileId || expense.fileId || expense.receiptUrl || expense.attachmentId || expense.hasReceipt);
}

function normalizeVat(expense) {
  const amount = roundMoney(expense.amount);
  const vatRate = expense.vatRate == null || expense.vatRate === "" ? null : Number(expense.vatRate);
  const vatAmount = expense.vatAmount == null || expense.vatAmount === "" ? null : roundMoney(expense.vatAmount);

  if (amount <= 0) throw apiError("Onkostbedrag moet groter zijn dan 0");
  if (amount > MAX_EXPENSE_AMOUNT) throw apiError(`Onkostbedrag mag maximaal € ${MAX_EXPENSE_AMOUNT} zijn zonder manuele finance flow`, 422);
  if (vatRate != null && !VAT_RATES.has(vatRate)) throw apiError("BTW-tarief moet 0%, 6%, 12% of 21% zijn");
  if (vatAmount != null && vatAmount > amount) throw apiError("BTW-bedrag mag niet hoger zijn dan het totaalbedrag");

  return { amount, vatRate, vatAmount };
}

function applyExpenseDefaults(payload, existing = null) {
  const merged = { ...(existing || {}), ...(payload || {}) };
  const vat = normalizeVat(merged);
  const next = { ...payload, ...vat };
  const currentStatus = merged.status || "submitted";

  if (payload.status === "approved" && existing?.status !== "approved") {
    throw apiError("Gebruik de approval endpoint om onkosten goed te keuren", 409);
  }

  if (!existing) {
    next.status = payload.status && payload.status !== "approved"
      ? payload.status
      : (vat.amount >= RECEIPT_REQUIRED_FROM && !hasReceipt(merged) ? "needs_receipt" : "submitted");
    next.submittedAt = payload.submittedAt || new Date().toISOString();
  } else if (currentStatus === "needs_receipt" && hasReceipt({ ...merged, ...payload })) {
    next.status = payload.status || "submitted";
  }

  if (vat.amount >= FINANCE_REVIEW_FROM && currentStatus !== "approved") {
    next.requiresFinanceReview = true;
  }

  return next;
}

function validateExpenseForApproval(expense, actor) {
  if (expense.status === "approved") throw apiError("Onkost is al goedgekeurd", 409);
  if (expense.status === "rejected") throw apiError("Afgewezen onkost moet eerst opnieuw ingediend worden", 409);
  if (expense.userId && expense.userId === actor.id && actor.role !== "super_admin") {
    throw apiError("Eigen onkosten kunnen niet door dezelfde gebruiker worden goedgekeurd", 403);
  }

  const vat = normalizeVat(expense);
  if (vat.amount >= RECEIPT_REQUIRED_FROM && !hasReceipt(expense)) {
    throw apiError(`Bon of bewijsstuk is verplicht vanaf € ${RECEIPT_REQUIRED_FROM}`, 422);
  }
  if (vat.amount >= FINANCE_REVIEW_FROM && !hasPermission(actor, "billing")) {
    throw apiError(`Onkosten vanaf € ${FINANCE_REVIEW_FROM} vereisen finance-rechten`, 403);
  }

  return {
    ...vat,
    status: "approved",
    approvedBy: actor.email,
    approvedAt: new Date().toISOString(),
    requiresFinanceReview: false
  };
}

function expenseInsights(expenses) {
  const totals = {
    submitted: 0,
    approved: 0,
    needsReceipt: 0,
    needsFinanceReview: 0,
    rejected: 0
  };
  let submittedTotal = 0;
  let approvedTotal = 0;
  let missingReceiptTotal = 0;

  for (const expense of expenses) {
    const amount = roundMoney(expense.amount);
    if (expense.status === "approved") {
      totals.approved += 1;
      approvedTotal += amount;
    } else if (expense.status === "rejected") {
      totals.rejected += 1;
    } else {
      totals.submitted += 1;
      submittedTotal += amount;
    }
    if (expense.status === "needs_receipt" || (amount >= RECEIPT_REQUIRED_FROM && !hasReceipt(expense))) {
      totals.needsReceipt += 1;
      missingReceiptTotal += amount;
    }
    if (expense.requiresFinanceReview || amount >= FINANCE_REVIEW_FROM) totals.needsFinanceReview += 1;
  }

  return {
    policy: {
      receiptRequiredFrom: RECEIPT_REQUIRED_FROM,
      financeReviewFrom: FINANCE_REVIEW_FROM,
      maxExpenseAmount: MAX_EXPENSE_AMOUNT,
      vatRates: Array.from(VAT_RATES)
    },
    counts: totals,
    submittedTotal: roundMoney(submittedTotal),
    approvedTotal: roundMoney(approvedTotal),
    missingReceiptTotal: roundMoney(missingReceiptTotal),
    approvalReady: totals.needsReceipt === 0 && totals.needsFinanceReview === 0
  };
}

module.exports = { applyExpenseDefaults, validateExpenseForApproval, expenseInsights };
