// server/services/formulaService.js — Formula Validation & Trial (Feature 10)
// Supports: arithmetic, percentages, batch size scaling, simple calculus notation

const { query } = require('../db/pool');

/**
 * Evaluate a formula expression with given variables
 * Supports: +, -, *, /, ^, %, sqrt, abs, ceil, floor, round, min, max, log, ln
 *
 * @param {string} expression - "batch_size * 0.05" or "api_weight / total_weight * 100"
 * @param {Object} variables - { batch_size: 500000, api_weight: 100, total_weight: 140 }
 * @returns {Object} { result, steps[], valid, error }
 */
function evaluateFormula(expression, variables = {}) {
  const steps = [];

  try {
    // Step 1: Substitute variables
    let expr = expression.trim();
    steps.push({ step: 'Original', value: expr });

    for (const [key, val] of Object.entries(variables)) {
      const re = new RegExp(`\\b${key}\\b`, 'g');
      expr = expr.replace(re, `(${val})`);
    }
    steps.push({ step: 'Variables substituted', value: expr });

    // Step 2: Replace math functions
    expr = expr
      .replace(/sqrt\s*\(/g, 'Math.sqrt(')
      .replace(/abs\s*\(/g, 'Math.abs(')
      .replace(/ceil\s*\(/g, 'Math.ceil(')
      .replace(/floor\s*\(/g, 'Math.floor(')
      .replace(/round\s*\(/g, 'Math.round(')
      .replace(/min\s*\(/g, 'Math.min(')
      .replace(/max\s*\(/g, 'Math.max(')
      .replace(/log\s*\(/g, 'Math.log10(')
      .replace(/ln\s*\(/g, 'Math.log(')
      .replace(/PI/g, 'Math.PI')
      .replace(/\^/g, '**');
    steps.push({ step: 'Functions resolved', value: expr });

    // Step 3: Security check — only allow math operations
    const safe = /^[\d\s+\-*/().%,Math.sqrtabsceilfloorroundminmaxlog10PIe**]+$/;
    const cleaned = expr.replace(/Math\.\w+/g, '').replace(/[\d\s+\-*/().%,^]+/g, '');
    if (cleaned.length > 0) {
      throw new Error(`Unsafe characters in expression: "${cleaned}"`);
    }

    // Step 4: Evaluate
    const fn = new Function(`"use strict"; return (${expr});`);
    const result = fn();
    steps.push({ step: 'Evaluated', value: result });

    if (typeof result !== 'number' || isNaN(result) || !isFinite(result)) {
      throw new Error(`Result is not a valid number: ${result}`);
    }

    return { result, steps, valid: true, error: null };
  } catch (err) {
    return { result: null, steps, valid: false, error: err.message };
  }
}

/**
 * Parse formula from Excel-like notation
 * "=A1*B1+C1" where A1=batch_size, B1=concentration, C1=overage
 */
function parseExcelFormula(excelExpr, cellMap = {}) {
  let expr = excelExpr.replace(/^=/, '');
  for (const [cell, varName] of Object.entries(cellMap)) {
    expr = expr.replace(new RegExp(cell, 'g'), varName);
  }
  return expr;
}

/**
 * Run a trial: evaluate formula, store result in DB
 */
async function runTrial(formulaId, variables) {
  const fR = await query('SELECT * FROM mbr_formulas WHERE id=$1', [formulaId]);
  if (fR.rows.length === 0) throw new Error('Formula not found');

  const formula = fR.rows[0];
  const result = evaluateFormula(formula.expression, variables);

  // Store trial result
  await query(
    `UPDATE mbr_formulas SET validation_result=$1, last_trial_at=NOW(), updated_at=NOW() WHERE id=$2`,
    [JSON.stringify({ ...result, trial_variables: variables, trial_at: new Date().toISOString() }), formulaId]
  );

  return result;
}

module.exports = { evaluateFormula, parseExcelFormula, runTrial };
