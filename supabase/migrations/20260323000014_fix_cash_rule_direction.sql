UPDATE gocash.transaction_rules
SET
  delta_platform_mult = -1,
  delta_cash_amount_mult = 1
WHERE transaction_type = 'Cash In'
  AND delta_platform_mult = 1
  AND delta_cash_amount_mult = -1
  AND delta_cash_mult = 1;

UPDATE gocash.transaction_rules
SET
  delta_platform_mult = 1,
  delta_cash_amount_mult = -1
WHERE transaction_type = 'Cash Out'
  AND delta_platform_mult = -1
  AND delta_cash_amount_mult = 1
  AND delta_cash_mult = 1;
